// Every member action: build the exact message (shared with the relayer and bot via scripts/lib/sign.ts),
// have the wallet sign it, and hand it to the relayer. Members never send a transaction.
import { decodeEventLog, parseUnits, type Address, type TransactionReceipt } from "viem";
import { actionTypes, circleDomain, joinNonce, nowSec, payNonce, permitTypes, receiveTypes, tusd8Domain, vrs } from "../../scripts/lib/sign";
import { CHOP_FOR } from "../lib/chop";
import { aevum, esc, FACTORY, factoryAbi, fmt, publicClient, short, TUSD8 } from "../lib/chain";
import { faucet, Friendly, relay } from "./api";
import { balanceOf, circleNonce, factoryNonce, rememberCreated, tokenNonce, type Circle } from "./data";
import { runAction, type Ctx } from "./sheet";
import { displayName, setDisplayName, type Wallet } from "./wallet";

const WINDOW = 1800n; // signatures live 30 minutes (the relayer accepts at most 1 hour)
const bytes = (s: string) => new TextEncoder().encode(s).length;
const val = (f: HTMLFormElement, n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? "";
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const dur = (s: number) => (s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? "" : "s"}` : s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? "" : "s"}` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);
export { dur };

export const OPEN_TYPES = {
  OpenCircle: [
    { name: "organiser", type: "address" },
    { name: "share", type: "uint256" },
    { name: "size", type: "uint8" },
    { name: "joinWindow", type: "uint32" },
    { name: "roundLength", type: "uint32" },
    { name: "graceLength", type: "uint32" },
    { name: "payeeDelay", type: "uint32" },
    { name: "maxDiscountBps", type: "uint16" },
    { name: "feeBps", type: "uint16" },
    { name: "quorumBps", type: "uint16" },
    { name: "securityBps", type: "uint16" },
    { name: "name", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type OpenParams = {
  share: bigint; size: number; joinWindow: number; roundLength: number; graceLength: number; payeeDelay: number;
  maxDiscountBps: number; feeBps: number; quorumBps: number; securityBps: number; name: string;
};

export const PRACTICE_PARAMS = (name: string): OpenParams => ({
  share: 10000n, size: 3, joinWindow: 3600, roundLength: 120, graceLength: 900, payeeDelay: 300,
  maxDiscountBps: 3000, feeBps: 100, quorumBps: 6000, securityBps: 5000, name: `Practice · ${name}`,
});

/** Make sure the member holds `need` tUSD8, topping up from the starter faucet once if not. */
async function ensureFunds(ctx: Ctx, w: Wallet, need: bigint) {
  const bal = await balanceOf(w.address);
  if (bal >= need) return;
  const l = ctx.line(`Getting 0.03 test tUSD8 from the starter faucet (you have ${fmt(bal)})`);
  let hash;
  try {
    ({ hash } = await faucet(w.address));
  } catch (e) {
    l.fail();
    throw new Friendly(`You need ${fmt(need)} tUSD8 for this. ${(e as Error).message}`);
  }
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1500 });
  l.done("Got 0.03 test tUSD8 from the faucet");
}

const signReceive = (w: Wallet, to: Address, value: bigint, nonce: `0x${string}`) => {
  const validBefore = nowSec() + WINDOW;
  return w
    .sign({ domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization", message: { from: w.address, to, value, validAfter: 0n, validBefore, nonce } } as never)
    .then((sig) => ({ validAfter: 0n, validBefore, ...vrs(sig) }));
};

type ActionName = keyof typeof actionTypes;
async function signAction(w: Wallet, circle: Address, primaryType: ActionName, extra: Record<string, unknown>) {
  const deadline = nowSec() + WINDOW;
  const nonce = await circleNonce(circle, w.address);
  const sig = await w.sign({ domain: circleDomain(circle), types: actionTypes, primaryType, message: { member: w.address, nonce, deadline, ...extra } } as never);
  return { deadline, sig };
}

function joinRun(c: { address: Address; share: bigint }, w: Wallet, payeeName: string, payout: Address) {
  return async (ctx: Ctx) => {
    await ensureFunds(ctx, w, c.share);
    const auth = await ctx.sign(`pledge ${fmt(c.share)} tUSD8 to join`, CHOP_FOR.join, () =>
      signReceive(w, c.address, c.share, joinNonce(c.address, w.address, payout, payeeName)),
    );
    await ctx.submit("your pledge", () => relay(c.address, "joinWithAuthorization", [w.address, payeeName, payout, auth]));
  };
}

const nameField = (label: string, value: string, hint = "") =>
  `<label class="field"><span>${esc(label)}</span><input name="payee" maxlength="32" autocomplete="nickname" value="${esc(value)}" placeholder="e.g. Mei" required>${hint ? `<small>${hint}</small>` : ""}</label>`;
const checkName = (n: string) => (!n ? "Please enter a name." : bytes(n) > 32 ? "Names can be at most 32 bytes." : null);

// ---------------------------------------------------------------- practice circle (the 2-minute demo)

export function startPractice(w: Wallet, onCircle: (a: Address) => void) {
  let circle: Address | null = null;
  runAction({
    title: "Start a practice circle",
    lead: `You open a 3-seat circle of <b>0.01 tUSD8</b> a round with 2-minute rounds, then join it. <b>Ah Ming and Kitty</b>, two friendly bots, take the other seats within about 30 seconds and play along: they pay, bid now and then, and approve. Two chops, no gas.`,
    form: nameField("Your name in the circle", displayName(), "Shown on your seat and as your payee name."),
    chops: [CHOP_FOR.open, CHOP_FOR.join],
    confirm: "Open and join",
    doneLabel: "Go to my circle",
    validate: (f) => checkName(val(f, "payee")),
    run: async (ctx, f) => {
      const name = val(f, "payee");
      setDisplayName(name);
      const p = PRACTICE_PARAMS(name.length > 40 ? name.slice(0, 40) : name);
      await ensureFunds(ctx, w, p.share);
      if (!circle) {
        const rc = await openRun(ctx, w, p);
        circle = createdFrom(rc);
      }
      await joinRun({ address: circle, share: p.share }, w, name, w.address)(ctx);
      ctx.note(`Ah Ming and Kitty are on their way. They join within about 30 seconds.`);
    },
    onDone: () => circle && onCircle(circle),
  });
}

function createdFrom(rc: TransactionReceipt): Address {
  for (const l of rc.logs) {
    try {
      const d = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics as never });
      if (d.eventName === "CircleCreated") {
        const a = (d.args as { circle: Address }).circle;
        rememberCreated(a, rc.blockNumber);
        return a;
      }
    } catch { /* not ours */ }
  }
  throw new Friendly("The circle was opened but its address wasn't found in the receipt. Check “Recent circles”.");
}

async function openRun(ctx: Ctx, w: Wallet, p: OpenParams) {
  const deadline = nowSec() + WINDOW;
  const nonce = await factoryNonce(FACTORY, w.address);
  const sig = await ctx.sign(`open “${p.name}”`, CHOP_FOR.open, () =>
    w.sign({
      domain: { name: "Biu Wui Factory", version: "1", chainId: aevum.id, verifyingContract: FACTORY },
      types: OPEN_TYPES,
      primaryType: "OpenCircle",
      message: { organiser: w.address, ...p, nonce, deadline },
    } as never),
  );
  return ctx.submit("open the circle", () => relay(FACTORY, "createCircleWithSig", [{ token: TUSD8, ...p }, w.address, deadline, sig]));
}

// ---------------------------------------------------------------- open a real circle

export function openCircle(w: Wallet, p: OpenParams, onCircle: (a: Address) => void) {
  let circle: Address | null = null;
  runAction({
    title: "Open this circle",
    lead: "You sign the circle's rules once. They can never change after it opens, not even by you. You are not a member until you join (next step).",
    rows: [
      ["Name", esc(p.name)],
      ["Share a round", `${fmt(p.share)} tUSD8`],
      ["Members", String(p.size)],
      ["Pot each round", `${fmt(p.share * BigInt(p.size))} tUSD8`],
      ["Rounds of bidding", dur(p.roundLength)],
      ["Max discount · fee", `${p.maxDiscountBps / 100}% · ${p.feeBps / 100}%`],
    ],
    chops: [CHOP_FOR.open],
    confirm: "Sign and open",
    doneLabel: "Go to the circle",
    run: async (ctx) => {
      if (!circle) circle = createdFrom(await openRun(ctx, w, p));
    },
    onDone: () => circle && onCircle(circle),
  });
}

// ---------------------------------------------------------------- member actions in a circle

export type Refresh = () => void;

export function join(c: Circle, w: Wallet, refresh: Refresh) {
  runAction({
    title: "Join with a pledge",
    lead: `You pay your first share now. If the circle isn't full by its deadline, <b>every pledge comes back in full</b>. You can also leave before it fills.`,
    rows: [["Pledge", `${fmt(c.share)} tUSD8`], ["Circle", esc(c.name)]],
    form:
      nameField("Payee name", displayName(), "Members see this name before they approve your pot.") +
      `<label class="field"><span>Payee address</span><input name="payout" value="${w.address}" spellcheck="false" autocomplete="off"><small>Your pot, dividends and refunds can only go here. Changing it later waits ${dur(c.payeeDelay)}, visible to all.</small></label>`,
    chops: [CHOP_FOR.join],
    confirm: "Sign the pledge",
    validate: (f) => checkName(val(f, "payee")) ?? (isAddr(val(f, "payout")) ? null : "The payee address doesn't look right."),
    run: async (ctx, f) => {
      setDisplayName(val(f, "payee"));
      await joinRun(c, w, val(f, "payee"), val(f, "payout") as Address)(ctx);
    },
    after: refresh,
  });
}

export function pay(c: Circle, w: Wallet, refresh: Refresh) {
  runAction({
    title: `Pay round ${c.round}`,
    rows: [["Your share", `${fmt(c.share)} tUSD8`], ["Into", esc(c.name)], ["Gas you pay", "0 — the relayer pays"]],
    lead: "Your signature can only move exactly one share, into this circle, for this round.",
    chops: [CHOP_FOR.pay],
    confirm: "Sign the payment",
    run: async (ctx) => {
      await ensureFunds(ctx, w, c.share);
      const auth = await ctx.sign(`pay ${fmt(c.share)} tUSD8 for round ${c.round}`, CHOP_FOR.pay, () => signReceive(w, c.address, c.share, payNonce(c.address, w.address, c.round)));
      await ctx.submit("your payment", () => relay(c.address, "payWithAuthorization", [w.address, auth]));
    },
    after: refresh,
  });
}

export function bid(c: Circle, w: Wallet, refresh: Refresh) {
  const best = c.rd?.bestDiscount ?? 0n;
  const pot = c.share * BigInt(c.size);
  const step = 1000n; // 0.001 tUSD8
  const min = best + step > c.maxDiscount ? c.maxDiscount : best + step;
  runAction({
    title: `Bid a discount for round ${c.round}`,
    lead: `The highest discount wins this round's pot of <b>${fmt(pot)} tUSD8</b>. The discount (less the organiser's ${c.feeBps / 100}% fee) is shared by everyone as a dividend.`,
    rows: [["Best bid so far", best > 0n ? `${fmt(best)} tUSD8` : "none yet"], ["Highest allowed", `${fmt(c.maxDiscount)} tUSD8 (${c.maxDiscountBps / 100}%)`]],
    form: `<label class="field"><span>Your discount (tUSD8)</span><input name="discount" inputmode="decimal" value="${fmt(min, 3)}" autocomplete="off"><small id="bid-hint">Must be more than ${fmt(best)} and at most ${fmt(c.maxDiscount)}.</small></label>`,
    chops: [CHOP_FOR.bid],
    confirm: "Sign the bid",
    validate: (f) => {
      let d: bigint;
      try { d = parseUnits(val(f, "discount") || "0", 6); } catch { return "Enter an amount like 0.002."; }
      if (d <= best) return `Your bid must be higher than ${fmt(best)}.`;
      if (d > c.maxDiscount) return `At most ${fmt(c.maxDiscount)} in this circle.`;
      return null;
    },
    run: async (ctx, f) => {
      const d = parseUnits(val(f, "discount"), 6);
      const { deadline, sig } = await ctx.sign(`bid ${fmt(d)} tUSD8`, CHOP_FOR.bid, () => signAction(w, c.address, "Bid", { round: c.round, discount: d }));
      await ctx.submit("your bid", () => relay(c.address, "bidWithSig", [w.address, d, deadline, sig]));
    },
    after: refresh,
  });
}

export function approve(c: Circle, w: Wallet, refresh: Refresh, payeeName: string) {
  const rd = c.rd!;
  const q = c.quote;
  runAction({
    title: `Approve the release of round ${c.round}`,
    lead: `Check who gets the pot. The payee was <b>fixed when the auction closed</b>; a later change can't touch this pot.`,
    rows: [
      ["Pot goes to", `<b>${esc(payeeName)}</b> · ${short(rd.payTo)}`],
      ["Winner's discount", `${fmt(rd.discount)} tUSD8`],
      ...(q ? ([["Paid out now", `${fmt(q.payout)} tUSD8`], ["Held as security", `${fmt(q.securityHeld)} tUSD8`], ["Dividend to all", `${fmt(q.dividend)} tUSD8`]] as [string, string][]) : []),
      ["Approvals", `${rd.approvals} of ${c.quorumNeeded} needed`],
    ],
    chops: [CHOP_FOR.approve],
    confirm: "Sign the approval",
    run: async (ctx) => {
      const { deadline, sig } = await ctx.sign(`approve round ${c.round}`, CHOP_FOR.approve, () => signAction(w, c.address, "ApproveRelease", { round: c.round }));
      await ctx.submit("your approval", () => relay(c.address, "approveReleaseWithSig", [w.address, deadline, sig]));
    },
    after: refresh,
  });
}

export function standingOrder(c: Circle, w: Wallet, refresh: Refresh) {
  const me = c.members.find((m) => m.address.toLowerCase() === w.address.toLowerCase());
  const left = Math.max(1, c.size - Number(c.round) + (me?.paid ? 0 : 1));
  runAction({
    title: "Set a standing order",
    lead: "Let the circle collect your share each round, so you never miss one. It can only ever take <b>one share a round</b>, at most the rounds you choose, until the date you choose. Revoke any time.",
    rows: [["Share", `${fmt(c.share)} tUSD8`]],
    form: `<div class="field-row"><label class="field"><span>Rounds (max ${c.size})</span><input name="rounds" type="number" min="1" max="${c.size}" value="${Math.min(left, c.size)}" inputmode="numeric"></label>
      <label class="field"><span>Expires in (days)</span><input name="days" type="number" min="1" max="365" value="7" inputmode="numeric"></label></div>
      <p class="fine">You sign twice: the order itself, and a tUSD8 permit for exactly share × rounds, usable only by this circle.</p>`,
    chops: [CHOP_FOR.order, CHOP_FOR.permit],
    confirm: "Sign both",
    validate: (f) => {
      const r = Number(val(f, "rounds"));
      const d = Number(val(f, "days"));
      if (!Number.isInteger(r) || r < 1 || r > c.size) return `Rounds must be 1 to ${c.size}.`;
      if (!(d >= 1 && d <= 365)) return "Expiry must be 1 to 365 days.";
      return null;
    },
    run: async (ctx, f) => {
      const rounds = Number(val(f, "rounds"));
      const expiresAt = nowSec() + BigInt(Math.round(Number(val(f, "days")) * 86400));
      const order = await ctx.sign(`standing order, ${rounds} round${rounds > 1 ? "s" : ""}`, CHOP_FOR.order, () => signAction(w, c.address, "StandingOrder", { maxRounds: BigInt(rounds), expiresAt }));
      const pNonce = await tokenNonce(w.address);
      const permit = await ctx.sign(`permit ${fmt(c.share * BigInt(rounds))} tUSD8 for this circle`, CHOP_FOR.permit, () =>
        w.sign({ domain: tusd8Domain(), types: permitTypes, primaryType: "Permit", message: { owner: w.address, spender: c.address, value: c.share * BigInt(rounds), nonce: pNonce, deadline: order.deadline } } as never),
      );
      await ctx.submit("your standing order", () =>
        relay(c.address, "setStandingOrderWithSig", [w.address, rounds, expiresAt, order.deadline, order.sig, { deadline: order.deadline, ...vrs(permit) }]),
      );
    },
    after: refresh,
  });
}

function simpleSigned(c: Circle, w: Wallet, refresh: Refresh, o: { title: string; lead: string; chop: string; type: "RevokeStandingOrder" | "CancelPayeeChange" | "Leave"; fn: string; what: string }) {
  runAction({
    title: o.title,
    lead: o.lead,
    chops: [o.chop],
    confirm: "Sign",
    run: async (ctx) => {
      const { deadline, sig } = await ctx.sign(o.what, o.chop, () => signAction(w, c.address, o.type, {}));
      await ctx.submit(o.what, () => relay(c.address, o.fn, [w.address, deadline, sig]));
    },
    after: refresh,
  });
}

export const revokeOrder = (c: Circle, w: Wallet, r: Refresh) =>
  simpleSigned(c, w, r, { title: "Revoke your standing order", lead: "The circle stops collecting your share. You can still pay each round yourself.", chop: CHOP_FOR.revoke, type: "RevokeStandingOrder", fn: "revokeStandingOrderWithSig", what: "revoke the standing order" });
export const cancelPayee = (c: Circle, w: Wallet, r: Refresh) =>
  simpleSigned(c, w, r, { title: "Cancel the pending payee change", lead: "Your payee stays as it is. If you didn't ask for this change, your key may be stolen: cancel it, and tell the circle.", chop: CHOP_FOR.cancelPayee, type: "CancelPayeeChange", fn: "cancelPayeeChangeWithSig", what: "cancel the payee change" });
export const leave = (c: Circle, w: Wallet, r: Refresh) =>
  simpleSigned(c, w, r, { title: "Leave this circle", lead: `You can leave until the circle is full. Your pledge of <b>${fmt(c.share)} tUSD8</b> goes back to your payee.`, chop: CHOP_FOR.leave, type: "Leave", fn: "leaveWithSig", what: "leave the circle" });

export function changePayee(c: Circle, w: Wallet, refresh: Refresh) {
  const me = c.members.find((m) => m.address.toLowerCase() === w.address.toLowerCase());
  runAction({
    title: "Change your payee",
    lead: `The change waits <b>${dur(c.payeeDelay)}</b> before it takes effect. Every member sees it meanwhile, and you can cancel it with one signature. A pot already closed keeps its payee.`,
    rows: me ? [["Payee now", `${esc(me.payeeName)} · ${short(me.payee)}`]] : [],
    form:
      nameField("New payee name", me?.payeeName ?? displayName()) +
      `<label class="field"><span>New payee address</span><input name="payout" value="${me?.payee ?? w.address}" spellcheck="false" autocomplete="off"></label>`,
    chops: [CHOP_FOR.payee],
    confirm: "Sign the request",
    validate: (f) => checkName(val(f, "payee")) ?? (isAddr(val(f, "payout")) ? null : "The address doesn't look right."),
    run: async (ctx, f) => {
      const name = val(f, "payee");
      const payout = val(f, "payout") as Address;
      const { deadline, sig } = await ctx.sign("request a payee change", CHOP_FOR.payee, () => signAction(w, c.address, "ChangePayee", { payout, name }));
      await ctx.submit("your payee change", () => relay(c.address, "requestPayeeChangeWithSig", [w.address, payout, name, deadline, sig]));
    },
    after: refresh,
  });
}

/** Anyone-can-call steps: no signature, the rules decide. The relayer still pays the gas. */
export function anyone(c: Circle, refresh: Refresh, o: { title: string; lead: string; fn: string; args?: unknown[]; rows?: [string, string][] }) {
  runAction({
    title: o.title,
    lead: o.lead,
    rows: o.rows,
    gasless: false,
    confirm: "Submit (free)",
    run: async (ctx) => {
      await ctx.submit(o.title.toLowerCase(), () => relay(c.address, o.fn, o.args ?? []));
    },
    after: refresh,
  });
}
