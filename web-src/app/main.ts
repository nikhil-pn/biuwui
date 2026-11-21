/**
 * Sovereign, the app. A visitor makes a test wallet (or connects theirs), opens or joins a circle, and plays it
 * round by round. Members only sign; the relayer pays every gas fee. The chain is the only state.
 */
import type { Address, Hex } from "viem";
import * as A from "../lib/actions.ts";
import { NET } from "../lib/aevum.ts";
import { burner, hasInjected, injected, newKey, onAccountsChanged, type Wallet } from "../lib/wallet.ts";
import { BOTS, PEOPLE } from "../../web/js/config.js";
import { ICON, renderFeed, usd } from "../../web/js/feed.js";
import { createRing, mountFlowDemo } from "../../web/js/ring.js";
import { esc, friendly, openSheet, progressIn, toast, type Sheet } from "./ui.ts";

const SITE = "https://sovereign.exprmnts.fun";
const ZERO = "0x0000000000000000000000000000000000000000";
const PHASES = ["Filling up", "Running", "Complete", "Dissolved", "Did not fill"];

// ---------------------------------------------------------------- mode: live (real testnet use) or demo (guided, with bots)

type Mode = "live" | "demo";
const params = new URLSearchParams(location.search);
const joinParam = params.get("join");
const MODE: Mode = joinParam ? "live" : ((params.get("mode") as Mode | null) ?? (localStorage.getItem("sovereign.mode") as Mode | null) ?? "live") === "demo" ? "demo" : "live";
localStorage.setItem("sovereign.mode", MODE);
const DEMO = MODE === "demo";
document.body.classList.add(DEMO ? "mode-demo" : "mode-live");

function switchMode(to: Mode) {
  localStorage.setItem("sovereign.mode", to);
  location.href = location.pathname;
}

// ---------------------------------------------------------------- saved state (this device only, one wallet per mode)

interface Saved {
  /** The test wallet's key (testnet only), when this mode uses one. */
  pk?: Hex;
  wallet?: "burner" | "injected";
  /** The name members see on your seat and payee. */
  name?: string;
  circles: Address[];
  current?: Address;
}
const KEY = DEMO ? "sovereign.demo.v1" : "sovereign.live.v1";
const saved: Saved = { circles: [], ...(JSON.parse(localStorage.getItem(KEY) ?? "null") ?? {}) };
const save = () => localStorage.setItem(KEY, JSON.stringify(saved));

let w: Wallet | null = null;
const $ = (id: string) => document.getElementById(id)!;

const money = (v: bigint) => {
  const [whole, d] = usd(v).slice(1).split(".");
  return `$${whole}<span class="dec">.${d}</span>`;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
/** "You", a bot's name, or the payee name the member chose when they joined. */
const nameOf = (a: string) => {
  if (w && same(a, w.address)) return "You";
  const bot = (PEOPLE as Record<string, string>)[a.toLowerCase()];
  if (bot) return bot;
  const i = snap?.members.findIndex((m) => same(m, a)) ?? -1;
  return i >= 0 && snap!.state[i]?.payee.name ? snap!.state[i].payee.name : short(a);
};
/** 1:05 · 3h 20m · 2d 4h */
function left(sec: number): string {
  if (sec <= 0) return "time's up";
  if (sec < 3600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} left`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m left`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h left`;
}
/** "2 minutes", "1 hour", "2 days" */
function dur(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400} day${sec === 86400 ? "" : "s"}`;
  if (sec % 3600 === 0) return `${sec / 3600} hour${sec === 3600 ? "" : "s"}`;
  if (sec % 60 === 0) return `${sec / 60} minute${sec === 60 ? "" : "s"}`;
  return `${sec} seconds`;
}
const explorerTx = (h: string) => `${NET.explorer}/tx/${h}`;
const txLink = (h: string, label = "View on explorer") => `<a href="${explorerTx(h)}" target="_blank" rel="noopener">${label} ↗</a>`;
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const svg = (d: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TICK = svg('<path d="M5 12.5 10 17l9-10"/>').replace('stroke-width="2"', 'stroke-width="3"');
const CROSS = svg('<path d="M6 6l12 12M18 6 6 18"/>').replace('stroke-width="2"', 'stroke-width="3"');
const MI = {
  how: ICON.open,
  shield: ICON.shield,
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>'),
  plus: ICON.plus,
  live: svg('<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>'),
  demo: svg('<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>'),
  ok: ICON.ok,
  down: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  repeat: ICON.repeat,
  lock: ICON.lock,
  leave: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>'),
  out: ICON.out,
  link: svg('<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>'),
  circle: ICON.open,
};

// ---------------------------------------------------------------- what the chain says now

type MemberState = Awaited<ReturnType<typeof A.memberState>>[number];

interface Snap {
  bal: bigint;
  circle?: Address;
  info?: A.CircleInfo;
  phase: number;
  members: Address[];
  state: MemberState[];
  round: number;
  r?: A.RoundView;
  quote?: { payout: bigint; fee: bigint; dividend: bigint; securityHeld: bigint };
  paid: boolean[];
  approved: boolean[];
  won: boolean[];
  needed: number;
  owed: bigint;
  stalled: boolean;
}
let snap: Snap | null = null;
let prev: Snap | null = null;

async function load(): Promise<Snap | null> {
  if (!w) return null;
  const me = w.address;
  const bal = await A.tokenBalance(me);
  const s: Snap = { bal, phase: -1, members: [], state: [], round: 0, paid: [], approved: [], won: [], needed: 2, owed: 0n, stalled: false };
  const c = saved.current;
  if (!c) return s;
  s.circle = c;
  const [info, members, round, needed, stalled] = await Promise.all([
    A.circleInfo(c),
    A.read<Address[]>(c, "members"),
    A.read<bigint>(c, "currentRound"),
    A.read<number>(c, "quorumNeeded"),
    A.read<boolean>(c, "isStalled"),
  ]);
  const state = await A.memberState(c, [...members], round);
  Object.assign(s, {
    info,
    phase: info.phase,
    members: [...members],
    state,
    round: Number(round),
    needed: Number(needed),
    stalled,
    paid: state.map((m) => m.paid),
    approved: state.map((m) => m.approved),
    won: state.map((m) => m.won),
  });
  const i = meIdx(s);
  if (i >= 0) s.owed = state[i].owed;
  if (s.round >= 1) {
    const [r, q] = await Promise.all([
      A.read<A.RoundView>(c, "getRound", [round]),
      A.read<readonly [bigint, bigint, bigint, bigint]>(c, "quotePayout", [round]).catch(() => null),
    ]);
    s.r = r;
    if (q) s.quote = { payout: q[0], fee: q[1], dividend: q[2], securityHeld: q[3] };
  }
  return s;
}

const meIdx = (s: Snap) => s.members.findIndex((m) => w && same(m, w.address));
const ready = (s: Snap) => !DEMO || s.bal > 0n || saved.circles.length > 0;
const isBot = (a: string) => BOTS.includes(a.toLowerCase());

// ---------------------------------------------------------------- the next step

interface Next {
  key: string;
  kicker: string;
  title: string;
  body: string;
  actions: string;
}

function nextStep(s: Snap): Next {
  const t = nowSec();
  const i = meIdx(s);
  const r = s.r;
  const size = s.info?.size ?? 3;
  const share = s.info?.share ?? 10000n;
  const timer = (end: bigint | number) => `<span class="timer" data-end="${end}"></span>`;
  if (!ready(s))
    return { key: "setup", kicker: "Almost there", title: "Get free test money", body: "Sovereign sends your wallet 0.03 test dollars, enough for a practice circle. You never need gas.", actions: `<button class="btn-primary" data-act="setup">Get test money</button>` };
  if (!s.circle || (s.phase >= 2 && s.owed === 0n))
    return DEMO
      ? { key: `start:${s.circle ?? ""}:${s.phase}`, kicker: s.phase >= 2 ? "Circle complete" : "Get started", title: s.phase >= 2 ? "Start another practice circle" : "Start a practice circle", body: "You and two friends, Ah Ming and Kitty (they're bots), each put in $0.01 a round for 3 two-minute rounds. Bid for the pot, or wait your turn.", actions: `<button class="btn-primary" data-act="start">Start a circle</button>` }
      : { key: `start:${s.circle ?? ""}:${s.phase}`, kicker: s.phase >= 2 ? "Circle complete" : "Get started", title: s.phase >= 2 ? "Open another circle" : "Open a circle, or join one", body: "Set the name, each member's share, how many members and how long each round's bidding lasts. Then invite your friends with a link. Got an invite link? Open it and you'll join.", actions: `<button class="btn-primary" data-act="start">Open a circle</button>` };
  const info = s.info!;
  if (s.phase === 0) {
    if (Number(t) > info.joinBy)
      return { key: "unfilled", kicker: "Did not fill", title: "Joining has closed", body: "The circle didn't fill by its deadline. Cancel it and every pledge goes back in full, to each member's payee.", actions: `<button class="btn-primary" data-act="cancelUnfilled">Cancel and refund</button>` };
    if (i < 0)
      return { key: "notin", kicker: info.name, title: `Join · ${s.members.length} of ${size} so far`, body: `Pledge your first ${usd(share)} share to take a seat. If the circle doesn't fill, every pledge comes back.`, actions: `<button class="btn-primary" data-act="join">Join with a pledge</button>` };
    return DEMO
      ? { key: `forming:${s.members.length}`, kicker: "Starting", title: `Waiting for friends · ${s.members.length} of ${size}`, body: "Ah Ming and Kitty are joining. Each one signs a pledge, and our secretary submits it.", actions: `<span class="spinner"></span>` }
      : { key: `forming:${s.members.length}`, kicker: info.name, title: `Invite friends · ${s.members.length} of ${size} joined`, body: `Round 1 starts when all ${size} members have joined. Joining closes in ${left(info.joinBy - Number(t)).replace(" left", "")}; if the circle isn't full by then, every pledge comes back.`, actions: `<button class="btn-primary" data-act="invite">Share invite link</button>${timer(info.joinBy)}` };
  }
  if (s.stalled)
    return { key: "stalled", kicker: "Circle stuck", title: "This circle can't go on", body: "A round ran out of time and nobody finished it. Dissolve the circle and what's left goes back to every member's payee, in proportion to what each put in minus what each took out.", actions: `<button class="btn-primary" data-act="dissolve">Dissolve and refund</button>` };
  if (s.phase >= 2)
    return { key: `withdraw:${s.owed}`, kicker: PHASES[s.phase], title: `${usd(s.owed)} is waiting for you`, body: "Your security and your share of the discounts. It goes only to your payee. Our secretary sends it shortly, or send it now.", actions: `<button class="btn-primary" data-act="withdraw">Pay out ${usd(s.owed)}</button>` };
  if (i < 0) return { key: "watch", kicker: info.name, title: "You're watching this circle", body: "You're not a member of this circle, so there's nothing for you to sign.", actions: "" };
  if (!r) return { key: "wait", kicker: "", title: "Loading…", body: "", actions: "" };
  const iWin = r.closed && same(r.winner, s.members[i]);
  const round = `${DEMO ? "" : `${info.name} · `}Round ${s.round} of ${size}`;
  const stepper = `<div class="stepper glass"><button data-bid="-1" aria-label="Less">−</button><span id="bid-val"></span><button data-bid="1" aria-label="More">+</button></div>`;
  if (!r.closed && t <= r.bidEnd) {
    if (!s.paid[i])
      return { key: `pay:${s.round}`, kicker: round, title: `Pay your ${usd(share)} for this round`, body: s.won[i] ? "You already took a pot, so you keep paying your share. If you don't, the security held from your pot covers it." : "Everyone pays in first. Then whoever needs the money most can bid for it. You sign; the relayer pays the gas.", actions: `<button class="btn-primary" data-act="pay">Pay ${usd(share)}</button>${s.state[i].order.active ? "" : `<button class="btn-glass" data-act="order">Pay every round</button>`}${timer(r.bidEnd)}` };
    if (!s.won[i] && r.bestBidder === ZERO)
      return { key: `bid:${s.round}`, kicker: round, title: "Want the pot first?", body: "Bid the discount you'd accept. The biggest discount wins, and the discount is shared with everyone. Or just wait: with no bids, the earliest member who hasn't won takes it.", actions: `${stepper}<button class="btn-primary" data-act="bid">Bid</button>${timer(r.bidEnd)}` };
    const lead = r.bestBidder !== ZERO ? `${nameOf(r.bestBidder)} ${nameOf(r.bestBidder) === "You" ? "lead" : "leads"} with a ${usd(r.bestDiscount)} discount.` : "";
    const canOutbid = !s.won[i] && !same(r.bestBidder, s.members[i]);
    return { key: `waitbid:${s.round}:${r.bestBidder}:${r.bestDiscount}`, kicker: round, title: "You're paid in. Bidding is open.", body: `${lead} The auction closes when the timer runs out.`, actions: canOutbid ? `${stepper}<button class="btn-glass" data-act="bid">Outbid</button>${timer(r.bidEnd)}` : timer(r.bidEnd) };
  }
  if (!r.closed)
    return { key: `close:${s.round}`, kicker: round, title: "Bidding is over", body: DEMO ? "Anyone can close the auction now. Our secretary does it within seconds if you don't." : "Anyone can close the auction now. That picks this round's winner and locks their payee.", actions: `<button class="btn-primary" data-act="close">Close the auction</button>` };
  if (!r.released) {
    const who = nameOf(r.winner);
    const potLine = `${usd(r.collected - r.discount)} after a ${usd(r.discount)} discount, to ${iWin ? "your" : `${who}'s`} locked payee`;
    if (r.approvals < s.needed && !s.approved[i])
      return { key: `approve:${s.round}:${r.approvals}`, kicker: round, title: iWin ? "You won the pot!" : `${who} wins this round`, body: `${potLine}. A quorum must approve the release: ${r.approvals} of ${s.needed} so far.`, actions: `<button class="btn-primary" data-act="approve">Approve release</button>` };
    if (r.approvals >= s.needed)
      return { key: `release:${s.round}`, kicker: round, title: iWin ? "Collect your pot" : "Ready to release", body: `${potLine}. Approved ${r.approvals} of ${s.needed}. Anyone can release it now, and it can go nowhere but the locked payee.`, actions: `<button class="btn-primary" data-act="release">Release the pot</button>` };
    return { key: `waitrel:${s.round}:${r.approvals}`, kicker: round, title: iWin ? "Waiting for approvals" : "You approved. Waiting for the others", body: `Approved ${r.approvals} of ${s.needed}. ${potLine}.`, actions: !DEMO ? `<button class="btn-glass" data-act="invite">Remind the circle</button>` : `<span class="spinner"></span>` };
  }
  return { key: `between:${s.round}`, kicker: round, title: "Next round is starting", body: "", actions: `<span class="spinner"></span>` };
}

/** A payee change waiting to take effect: shown to every member, with a cancel button for its owner. */
function payeeWarning(s: Snap): string {
  const k = s.state.findIndex((m) => m.pending);
  if (k < 0) return "";
  const p = s.state[k].pending!;
  const mine = w && same(s.members[k], w.address);
  const who = nameOf(s.members[k]);
  return `<p class="kicker">Payee change pending</p><h2>${mine ? "Your" : `${esc(who)}'s`} pot would go to ${esc(p.name)}</h2>
    <p>New address <code>${short(p.address)}</code>. It takes effect in <span class="timer inline" data-end="${p.effectiveAt}"></span>, and every member sees it meanwhile. ${mine ? "If you didn't ask for this, your key may be stolen: cancel it now." : `If ${esc(who)} didn't ask for this, tell them to cancel it.`} A pot already closed keeps its payee.</p>
    ${mine ? `<div class="next-actions"><button class="btn-primary" data-act="cancelPayee">Cancel the change</button></div>` : ""}`;
}

// ---------------------------------------------------------------- screens

let tab: "home" | "activity" | "members" = "home";
let ring: ReturnType<typeof createRing> | null = null;
let nextKey = "";

const WALLET_ART = (kind: string, id = "") =>
  `<div class="wallet"><div class="wcard silver"></div><div class="wcard gold"><span class="brand">Sovereign</span><span class="kind"${id ? ` id="${id}"` : ""}>${kind}</span></div><div class="pocket"><span class="stitch"></span><span class="clasp"></span></div></div>`;

function renderWelcome() {
  document.body.dataset.screen = "welcome";
  $("screen").innerHTML = `
    <section class="welcome">
      <div class="wallet-art" aria-hidden="true">${WALLET_ART("Circle")}</div>
      <p class="mode-tag ${DEMO ? "demo" : "live"}">${DEMO ? "Demo mode · bots and free test money" : "Live · QDay Aevum testnet"}</p>
      <h1>Save together.<br>Bid for the pot.</h1>
      <ul class="points">
        ${DEMO
          ? `<li class="glass"><b>Pay in</b> $0.01 a round with two bot friends</li>
        <li class="glass"><b>Bid for the pot</b>, or take it when it's your turn</li>
        <li class="glass"><b>Just sign</b>: you never need gas, and pots only go to your locked payee</li>`
          : `<li class="glass"><b>Open a circle</b>: you set the name, the share, the members and the bidding time</li>
        <li class="glass"><b>Invite friends</b> with a link; everyone joins with their own wallet</li>
        <li class="glass"><b>Every action is a signature</b>; the relayer pays the gas on the testnet</li>`}
      </ul>
      <button class="btn-primary block" data-act="create">${DEMO ? "Create my wallet" : "Make a test wallet"}</button>
      ${DEMO || !hasInjected() ? "" : '<button class="btn-glass block" data-act="connect">Connect my wallet</button>'}
      <button class="btn-glass block" data-act="how">How it works</button>
      <p class="fine">${DEMO ? "Sovereign hands you free test money and two bots play with you. Nothing real is at stake." : `A test wallet lives in this browser. You can also connect MetaMask or Rabby; it adds the Aevum network for you. Just looking? <button class="link inline" data-act="to-demo">Try demo mode</button>`}</p>
    </section>`;
}

function renderShell() {
  document.body.dataset.screen = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".dock-btn")) b.classList.toggle("active", b.dataset.tab === tab);
  if (tab === "home") {
    $("screen").innerHTML = `
      <section class="home">
        <div class="col-a">
        <div class="bal" style="grid-area:bal">
          <p class="label">Your test dollars</p>
          <div class="bal-row"><p class="num big" id="h-bal">$0<span class="dec">.00</span></p><span class="chip glass" id="h-gas">No gas needed</span></div>
        </div>
        <div class="wallet-art" style="grid-area:wallet" aria-hidden="true">${WALLET_ART("Circle", "h-kind")}</div>
        <article class="mini glass" style="grid-area:moves" id="h-moves" hidden>
          <header><h2>Your moves</h2></header>
          <nav class="menu" id="h-menu"></nav>
        </article>
        <article class="mini glass" style="grid-area:act">
          <header><h2>Recent activity</h2><button class="link" data-tab-go="activity">See all</button></header>
          <ul class="feed mini" id="h-feed"><li class="empty">Nothing yet.</li></ul>
        </article>
        </div>
        <div class="col-b">
        <article class="next warn glass sheen" style="grid-area:warn" id="h-warn" hidden></article>
        <article class="next glass sheen" style="grid-area:next" id="h-next"></article>
        <article class="ring-card glass" style="grid-area:ring">
          <header><h2 id="h-ring-title">Your circle</h2><span class="live-dot" title="Live on QDay Aevum testnet"></span></header>
          <div class="ring-wrap"><div id="h-ring"></div></div>
          <p class="ring-legend"><span class="lg paid"></span>paid <span class="lg win"></span>wins the pot <span class="lg tick"></span>approved</p>
        </article>
        </div>
      </section>`;
    ring = createRing($("h-ring"));
    nextKey = "";
    warnKey = "";
    movesKey = "";
  } else if (tab === "activity") {
    $("screen").innerHTML = `<section class="page-pane"><h1>Activity</h1><p class="sub">Every line is a transaction on the QDay Aevum testnet. Members paid no gas for any of them.</p><ul class="feed glass" id="a-feed"><li class="empty">Your circle's activity shows here.</li></ul></section>`;
    ring = null;
  } else {
    $("screen").innerHTML = `<section class="page-pane"><h1>Members</h1><p class="sub">Everyone joined with a signed pledge and named a payee. A pot can only go to that payee.</p><ul class="people-list" id="m-list"><li class="empty glass">Start a circle to see its members.</li></ul><button class="btn-primary block" id="m-invite" data-act="invite" hidden>Invite friends</button></section>`;
    ring = null;
  }
}

let warnKey = "";
let movesKey = "";

function draw() {
  if (!w) return renderWelcome();
  if (document.body.dataset.screen === "welcome" || !document.querySelector(".home, .page-pane")) renderShell();
  const s = snap;
  $("pill-name").textContent = saved.current ? (s?.info ? s.info.name : `Circle ${Math.max(1, saved.circles.indexOf(saved.current) + 1)}`) : "No circle";
  if (!s) return;

  if (tab === "home") {
    $("h-bal").innerHTML = money(s.bal);
    $("h-gas").textContent = w.kind === "burner" ? "No gas needed" : "No gas needed · your wallet";
    $("h-kind").textContent = PHASES[s.phase] ?? "Circle";
    const n = nextStep(s);
    if (n.key !== nextKey) {
      nextKey = n.key;
      $("h-next").innerHTML = `<p class="kicker">${esc(n.kicker)}</p><h2>${esc(n.title)}</h2>${n.body ? `<p>${esc(n.body)}</p>` : ""}<div class="next-actions">${n.actions}</div>`;
      bidVal = 0n;
      showBid();
      tickTimers();
    }
    const warn = payeeWarning(s);
    if (warn !== warnKey) {
      warnKey = warn;
      $("h-warn").innerHTML = warn;
      $("h-warn").hidden = !warn;
      tickTimers();
    }
    drawMoves(s);
    drawRing(s);
    void drawMiniFeed();
  } else if (tab === "activity") void drawActivity();
  else drawMembers(s);
}

/** Moves a member can make any time: standing order, payee, leave, pay out, invite. */
function drawMoves(s: Snap) {
  const i = meIdx(s);
  const el = document.getElementById("h-moves");
  if (!el) return;
  if (i < 0 || !s.info) {
    el.hidden = true;
    return;
  }
  const me = s.state[i];
  const row = (act: string, icon: string, text: string, sub = "") => `<button data-act="${act}"><span class="mi">${icon}</span><span class="mv">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><i>›</i></button>`;
  const items: string[] = [];
  if (s.phase <= 1) {
    items.push(me.order.active ? row("revokeOrder", MI.repeat, "Standing order on", `${me.order.used} of ${me.order.maxRounds} rounds`) : row("order", MI.repeat, "Pay every round automatically"));
    items.push(me.pending ? row("cancelPayee", MI.lock, "Cancel payee change", `to ${me.pending.name}`) : row("payee", MI.lock, `Payee: ${me.payee.name}`, short(me.payee.address)));
  }
  if (s.phase === 0) items.push(row("leave", MI.leave, "Leave and get my pledge back"));
  if (s.phase === 0 && !DEMO) items.push(row("invite", MI.link, "Invite friends"));
  if (me.owed > 0n) items.push(row("withdraw", MI.out, `Pay out ${usd(me.owed)}`, "to your payee"));
  items.push(`<a href="${NET.explorer}/address/${s.circle}" target="_blank" rel="noopener"><span class="mi">${MI.circle}</span>This circle on the explorer<i>↗</i></a>`);
  const html = items.join("");
  if (html !== movesKey) {
    movesKey = html;
    $("h-menu").innerHTML = html;
  }
  el.hidden = false;
}

function drawRing(s: Snap) {
  if (!ring) return;
  const members = s.members.length ? s.members : w ? [w.address] : [];
  const r = s.r;
  const view = members.map((m, i) => ({
    name: nameOf(m),
    me: nameOf(m) === "You",
    paid: Boolean(s.paid[i]),
    winner: Boolean(r?.closed && same(r.winner, m) && !r.released),
    approved: Boolean(s.approved[i]),
    bid: r && !r.closed && same(r.bestBidder, m) ? `−${usd(r.bestDiscount)}` : null,
  }));
  const seats = s.info?.size ?? 3;
  while (view.length < seats && s.phase <= 0) view.push({ name: "open seat", me: false, paid: false, winner: false, approved: false, bid: null });
  const pot = r ? (r.released ? 0n : r.collected) : s.info ? s.info.share * BigInt(s.members.length) : 0n;
  const label = !s.circle ? "no circle yet" : s.phase === 0 ? `${s.members.length} of ${seats} pledged` : s.phase >= 2 ? PHASES[s.phase].toLowerCase() : `round ${s.round} of ${seats}`;
  ring.set({ pot: money(pot), label, members: view, potGlow: Boolean(r && !r.closed && s.paid.every(Boolean)) });
  $("h-ring-title").textContent = s.circle ? (s.phase >= 2 ? `Circle ${PHASES[s.phase].toLowerCase()}` : s.phase === 0 ? "Your circle is filling up" : `Round ${s.round} of ${seats}`) : "Your circle";

  // Coins move when the chain changes: payments into the pot, a payout out of it.
  if (prev && prev.circle === s.circle && r) {
    if (prev.round === s.round) {
      s.paid.forEach((p, i) => p && !prev!.paid[i] && ring!.coin(i, "pot"));
    } else if (prev.r && !prev.r.released && s.round > prev.round) {
      const wi = prev.members.findIndex((m) => same(m, prev!.r!.winner));
      if (wi >= 0) ring.coin("pot", wi, 3);
    }
  }
}

async function drawMiniFeed() {
  if (!saved.current || !document.getElementById("h-feed")) return;
  await renderFeed([{ address: saved.current, name: "your circle" }], snap?.needed ?? 2, "h-feed", 4);
}

async function drawActivity() {
  if (!saved.current) return;
  await renderFeed([{ address: saved.current, name: "your circle" }], snap?.needed ?? 2, "a-feed", 40);
}

function drawMembers(s: Snap) {
  if (!s.members.length) return;
  const inv = document.getElementById("m-invite");
  if (inv) inv.hidden = DEMO || s.phase !== 0 || meIdx(s) < 0;
  $("m-list").innerHTML = s.members
    .map((m, i) => {
      const nm = nameOf(m);
      const st = s.state[i];
      const status = s.phase === 0 ? "pledged" : s.won[i] ? "has taken the pot" : "waiting for their turn";
      const payee = `pays out to ${st.payee.name} · ${short(st.payee.address)}`;
      const pend = st.pending ? ` · <b class="warn-text">changing to ${esc(st.pending.name)}</b>` : "";
      const order = st.order.active ? " · standing order" : "";
      return `<li class="glass"><span class="pav${nm === "You" ? " me" : ""}">${esc(nm === "You" ? "You" : nm[0])}</span><span class="pname">${esc(nm)}${isBot(m) ? " <em>bot</em>" : ""}<small>${status}${order} · ${esc(payee)}${pend}</small></span><span class="tag${s.paid[i] || s.phase === 0 ? " green" : ""}">${s.phase === 0 ? "pledged" : s.paid[i] ? "paid" : "not yet"}</span></li>`;
    })
    .join("");
}

// ---------------------------------------------------------------- flows

/** Wallet-style confirm sheet, then the steps of `run` ticking off, then `done`. */
function confirmTx(o: {
  title: string;
  lead?: string;
  rows: [string, string][];
  form?: string;
  cta: string;
  validate?: (body: HTMLElement) => string | null;
  run: (p: ReturnType<typeof progressIn>, body: HTMLElement) => Promise<string | void>;
  done: (tx?: string) => string;
  after?: () => void;
}) {
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">Confirm with your wallet</p>
      <h2>${o.title}</h2>
      ${o.lead ? `<p class="lead">${o.lead}</p>` : ""}
      <dl class="rows glass">${o.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>
      ${o.form ?? ""}
      <div class="tx-progress" hidden></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>${o.cta}</button></div>
    </div>`);
  sh.body.querySelector("[data-go]")!.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const bad = o.validate?.(sh.body);
    if (bad) return toast(bad, "err");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner light"></span> Working…`;
    const pEl = sh.body.querySelector<HTMLElement>(".tx-progress")!;
    pEl.hidden = false;
    try {
      const tx = await o.run(progressIn(pEl), sh.body);
      sh.body.querySelector(".tx-actions")!.innerHTML = `<div class="done-msg">${o.done(tx ?? undefined)}</div><button class="btn-glass block" data-close>Done</button>`;
      sh.body.querySelector("[data-close]")!.addEventListener("click", () => {
        sh.close();
        o.after?.();
      });
      await refresh();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Try again";
      toast(friendly(err), "err", 6000);
    }
  });
  return sh;
}

const gasRow: [string, string] = ["Gas you pay", "none <span class=\"muted\">(the relayer pays)</span>"];
const scopeRow = (c: string): [string, string] => ["Can move", `only your share, into ${esc(c)}`];

async function withStep<T>(p: ReturnType<typeof progressIn>, text: string, fn: () => Promise<T>, note?: (v: T) => string): Promise<T> {
  const s = p.step(text);
  try {
    const v = await fn();
    s.done(note ? note(v) : undefined);
    return v;
  } catch (e) {
    s.fail();
    throw e;
  }
}

/** Sign on this device (or in the browser wallet), then the relayer submits it and pays the gas. */
async function signAndSend(p: ReturnType<typeof progressIn>, what: string, sign: () => Promise<A.Call>) {
  const call = await withStep(p, `Signing ${what}${w!.kind === "burner" ? " on this device" : " in your wallet"}`, sign, () => "no gas");
  return withStep(p, "The relayer submits it and pays the gas", () => A.submit(call), (r) => txLink(r.tx, "tx"));
}

/** Make sure the wallet holds `need`; top it up once from the starter faucet if not. */
async function ensureFunds(p: ReturnType<typeof progressIn>, need: bigint) {
  const bal = await A.tokenBalance(w!.address);
  if (bal >= need) return;
  await withStep(p, `Getting free test money (you have ${usd(bal)})`, () => A.faucet(w!.address), (h) => `${txLink(h, "$0.03")}`).catch((e) => {
    throw new Error(`You need ${usd(need)} for this. ${friendly(e)}`);
  });
}

function useWallet(next: Wallet, kind: "burner" | "injected") {
  w = next;
  (PEOPLE as Record<string, string>)[next.address.toLowerCase()] = "You";
  saved.wallet = kind;
  save();
  tab = "home";
  renderShell();
}

/** Demo: a test wallet on this device, then free test money from the starter faucet. */
function setupFlow() {
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">Your wallet</p>
      <h2>Set up your wallet</h2>
      <p class="lead">Sovereign makes a test wallet in this browser. It only ever signs; our relayer sends every transaction and pays the gas, so you never need a gas token.</p>
      <div class="tx-progress"></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>${w ? "Continue" : "Create my wallet"}</button></div>
    </div>`);
  const go = sh.body.querySelector<HTMLButtonElement>("[data-go]")!;
  go.addEventListener("click", async () => {
    go.disabled = true;
    go.innerHTML = `<span class="spinner light"></span> Setting up…`;
    const p = progressIn(sh.body.querySelector(".tx-progress")!);
    try {
      if (!w) {
        await withStep(p, "Making your wallet on this device", async () => {
          saved.pk = newKey();
          useWallet(burner(saved.pk), "burner");
        }, () => short(w!.address));
      } else p.step("Your wallet is on this device").done();
      if ((await A.tokenBalance(w!.address)) === 0n) {
        await withStep(p, "Getting free test money", () => A.faucet(w!.address), (h) => txLink(h, "$0.03"));
      } else p.step("Test money is in your wallet").done();
      sh.body.querySelector(".tx-actions")!.innerHTML = `<div class="done-msg">You're ready. Next: start a practice circle.</div><button class="btn-primary block" data-next>Start a circle</button>`;
      sh.body.querySelector("[data-next]")!.addEventListener("click", () => {
        sh.close();
        startFlow();
      });
      await refresh();
    } catch (e) {
      go.disabled = false;
      go.textContent = "Try again";
      toast(friendly(e), "err", 6000);
      await refresh();
    }
  });
  if (!w) go.click();
}

/** Live: make a test wallet here. */
async function createWalletLive() {
  saved.pk = newKey();
  useWallet(burner(saved.pk), "burner");
  await refresh();
  toast("Your test wallet is ready", "ok");
  if (pendingJoin) void joinFlow(pendingJoin);
}

async function connectFlow() {
  try {
    const x = await injected(true);
    if (!x) return toast("Your wallet didn't share an address.", "err");
    useWallet(x, "injected");
    await refresh();
    toast("Wallet connected · Aevum added", "ok");
    if (pendingJoin) void joinFlow(pendingJoin);
  } catch (e) {
    toast(friendly(e), "err", 6000);
  }
}

// ---------------------------------------------------------------- invites (live)

const inviteUrl = (c: string) => `${location.origin}/?join=${c}`;

function inviteSheet() {
  const c = saved.current;
  const info = snap?.info;
  if (!c || !info) return;
  const url = inviteUrl(c);
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">Invite friends</p>
      <h2>${esc(info.name)}</h2>
      <p class="lead">${snap!.members.length} of ${info.size} have joined. Send this link; your friend makes a wallet or connects theirs, and joins with a signed pledge. No gas.</p>
      <div class="addr-box glass"><span class="kicker">Invite link</span><code>${esc(url)}</code></div>
      <dl class="rows glass"><div><dt>Each pays</dt><dd>${usd(info.share)} a round</dd></div><div><dt>Members</dt><dd>${info.size}</dd></div><div><dt>Pot each round</dt><dd>${usd(info.share * BigInt(info.size))}</dd></div><div><dt>Joining closes</dt><dd>${new Date(info.joinBy * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd></div></dl>
      <div class="tx-actions">
        ${"share" in navigator ? '<button class="btn-primary block" data-share>Share link</button>' : ""}
        <button class="btn-glass block" data-copy>Copy link</button>
      </div>
    </div>`);
  const text = `Join my savings circle "${info.name}" on Sovereign: ${usd(info.share)} a round, ${info.size} members. Bid for the pot; nobody can run off with it.`;
  sh.body.querySelector("[data-share]")?.addEventListener("click", () => void navigator.share?.({ title: "Sovereign", text, url }).catch(() => {}));
  sh.body.querySelector("[data-copy]")!.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(url);
    toast("Invite link copied", "ok", 1800);
  });
}

const payeeForm = (name: string, addr: string, delay?: number) => `
  <label class="fl">Payee name<input class="field" id="f-name" maxlength="32" value="${esc(name)}" autocomplete="nickname" placeholder="e.g. Mei"></label>
  <label class="fl">Payee address<input class="field mono" id="f-addr" value="${esc(addr)}" spellcheck="false" autocomplete="off"></label>
  <p class="fine">Your pot, dividends and refunds can only go here. Members see the name before they approve.${delay ? ` A later change waits ${dur(delay)}, visible to everyone.` : ""}</p>`;
const val = (body: HTMLElement, id: string) => (body.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim();
const bytes = (s: string) => new TextEncoder().encode(s).length;
const checkPayee = (body: HTMLElement) => {
  const n = val(body, "f-name");
  if (!n) return "Give your payee a name.";
  if (bytes(n) > 32) return "Names can be at most 32 bytes.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(val(body, "f-addr"))) return "That payee address doesn't look right.";
  return null;
};

/** Join a circle (from an invite link or the home screen): a signed pledge of one share. */
async function joinFlow(c: string) {
  pendingJoin = c;
  if (!(await A.isSovereignCircle(c).catch(() => false))) {
    pendingJoin = null;
    history.replaceState(null, "", location.pathname);
    return toast("That invite link doesn't point to a Sovereign circle.", "err", 6000);
  }
  if (!w) {
    toast("First make a test wallet or connect yours, then you'll join the circle.", "info", 5000);
    return;
  }
  const info = await A.circleInfo(c as Address);
  const members = await A.read<Address[]>(c as Address, "members");
  const already = members.some((m) => same(m, w!.address));
  const done = () => {
    pendingJoin = null;
    history.replaceState(null, "", location.pathname);
    saved.circles = [...saved.circles.filter((x) => x !== c), c as Address];
    saved.current = c as Address;
    save();
    prev = null;
  };
  if (already) {
    done();
    toast(`You're already in ${info.name}`, "ok");
    return refresh();
  }
  if (info.phase !== 0 || info.memberCount >= info.size || Date.now() / 1000 > info.joinBy) {
    done();
    await refresh();
    return toast(`${info.name} is full or has already started.`, "err", 6000);
  }
  confirmTx({
    title: `Join ${esc(info.name)}`,
    lead: `Opened by ${short(info.organiser)}. ${info.memberCount} of ${info.size} have joined. Joining is a pledge: you pay your first share now, and if the circle doesn't fill, every pledge comes back in full.`,
    rows: [
      ["You pay", `${usd(info.share)} a round`],
      ["For", `${info.size} rounds · ${usd(info.share * BigInt(info.size))} in total`],
      ["Bidding each round", dur(info.roundLength)],
      ["Discount cap", `${info.maxDiscountBps / 100}% of the pot`],
      ["Organiser fee", `${info.feeBps / 100}% of the pot, from discounts only`],
      ["Your test dollars", money(snap?.bal ?? 0n)],
      gasRow,
    ],
    form: payeeForm(saved.name ?? "", w.address, info.payeeDelay),
    cta: "Sign the pledge",
    validate: checkPayee,
    run: async (p, body) => {
      const name = val(body, "f-name");
      saved.name = name;
      save();
      await ensureFunds(p, info.share);
      const r = await signAndSend(p, `your ${usd(info.share)} pledge`, () => A.signJoin(w!, c as Address, info.share, name, val(body, "f-addr") as Address));
      done();
      return r.tx;
    },
    done: () => `You're in ${esc(info.name)}.`,
  });
}

const CADENCES: [number, string, string][] = [
  [120, "2 min", "test"],
  [600, "10 min", "test"],
  [3600, "1 hour", ""],
  [86400, "1 day", ""],
  [604800, "1 week", ""],
];
const SHARES: [number, string][] = [[0.01, "$0.01"], [0.1, "$0.10"], [1, "$1"], [10, "$10"]];

/** Live: the organiser fixes the terms (name, share, members, bidding time, discount cap, fee), joins, then invites. */
function createFlow() {
  const f = { name: "Family hui", share: 0.01, size: 4, round: 600, cap: 3000, fee: 100 };
  const seg = (key: string, opts: [number, string, string?][], cur: number) =>
    `<div class="seg glass" data-seg="${key}">${opts.map(([v, l, sub]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}">${l}${sub ? `<small>${sub}</small>` : ""}</button>`).join("")}</div>`;
  const sh = openSheet(`
    <div class="tx create">
      <p class="kicker">New circle · QDay Aevum testnet</p>
      <h2>Open a circle</h2>
      <label class="fl">Name<input class="field" id="c-name" maxlength="40" value="${f.name}" autocomplete="off"></label>
      <label class="fl">Each member pays, per round
        <div class="amount glass"><span>$</span><input id="c-share" type="number" inputmode="decimal" min="0.01" max="1000" step="0.01" value="${f.share}"><span class="unit">tUSD8</span></div>
      </label>
      ${seg("share", SHARES, f.share)}
      <div class="fl">Members
        <div class="stepper glass big"><button type="button" data-size="-1" aria-label="Fewer">−</button><span id="c-size">${f.size}</span><button type="button" data-size="1" aria-label="More">+</button></div>
      </div>
      <div class="fl">Bidding time each round${seg("round", CADENCES, f.round)}</div>
      <div class="fl">Biggest discount a bidder can take${seg("cap", [[1000, "10%"], [2000, "20%"], [3000, "30%"], [4000, "40%"]], f.cap)}</div>
      <div class="fl">Organiser fee, taken only from discounts${seg("fee", [[0, "None"], [100, "1%"], [200, "2%"], [500, "5%"]], f.fee)}</div>
      ${payeeForm(saved.name ?? "", w!.address)}
      <div class="summary glass" id="c-sum"></div>
      <div class="tx-progress" hidden></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>Sign and open</button></div>
    </div>`);
  const q = (sel: string) => sh.body.querySelector<HTMLElement>(sel)!;
  const fmt = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  const sum = () => {
    const pot = f.share * f.size;
    q("#c-sum").innerHTML = `
      <div><b>${fmt(pot)}</b><span>pot each round</span></div>
      <div><b>${fmt(pot)}</b><span>each member pays in total</span></div>
      <div><b>${f.size} rounds</b><span>bidding ${dur(f.round)} each</span></div>
      <p>Everyone takes the pot once. A bidder still gets at least ${fmt(pot * (1 - f.cap / 10000))}. Joining stays open for ${dur(joinWindow(f.round))}; a payee change waits ${dur(payeeDelay(f.round))}. You have ${usd(snap!.bal)}.</p>`;
  };
  sh.body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-v]");
    const g = b?.closest<HTMLElement>("[data-seg]");
    if (b && g) {
      for (const x of g.querySelectorAll("button")) x.classList.toggle("on", x === b);
      const v = Number(b.dataset.v);
      if (g.dataset.seg === "share") {
        f.share = v;
        sh.body.querySelector<HTMLInputElement>("#c-share")!.value = String(v);
      } else (f as Record<string, unknown>)[g.dataset.seg!] = v;
      sum();
    }
    const z = t.closest<HTMLElement>("[data-size]");
    if (z) {
      f.size = Math.min(12, Math.max(2, f.size + Number(z.dataset.size)));
      q("#c-size").textContent = String(f.size);
      sum();
    }
  });
  sh.body.querySelector<HTMLInputElement>("#c-share")!.addEventListener("input", (e) => {
    f.share = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
    for (const x of sh.body.querySelectorAll('[data-seg="share"] button')) x.classList.toggle("on", Number((x as HTMLElement).dataset.v) === f.share);
    sum();
  });
  sum();
  const go = q("[data-go]") as HTMLButtonElement;
  go.addEventListener("click", async () => {
    f.name = val(sh.body, "c-name");
    if (!f.name) return toast("Give your circle a name.", "err");
    if (/^Practice · /.test(f.name)) return toast("Pick another name; that one is for practice circles.", "err");
    if (bytes(f.name) > 64) return toast("Circle names can be at most 64 bytes.", "err");
    if (!(f.share >= 0.000001 && f.share <= 1000)) return toast("Each member's share must be between $0.000001 and $1,000.", "err");
    const bad = checkPayee(sh.body);
    if (bad) return toast(bad, "err");
    const payee = val(sh.body, "f-name");
    const payout = val(sh.body, "f-addr") as Address;
    saved.name = payee;
    save();
    go.disabled = true;
    go.innerHTML = `<span class="spinner light"></span> Opening…`;
    const pEl = q(".tx-progress");
    pEl.hidden = false;
    const p = progressIn(pEl);
    try {
      const share = BigInt(Math.round(f.share * 1e6));
      const params: A.OpenParams = {
        share,
        size: f.size,
        joinWindow: joinWindow(f.round),
        roundLength: f.round,
        graceLength: Math.min(Math.max(Math.round(f.round / 4), 900), 3 * 86400),
        payeeDelay: payeeDelay(f.round),
        maxDiscountBps: f.cap,
        feeBps: f.fee,
        quorumBps: 5001,
        securityBps: 5000,
        name: f.name,
      };
      await ensureFunds(p, share);
      const made = await signAndSend(p, `the rules of "${f.name}"`, () => A.signOpen(w!, params));
      const circle = A.openedCircle(made.rc);
      saved.circles = [...saved.circles.filter((c) => c !== circle), circle];
      saved.current = circle;
      save();
      await signAndSend(p, `your ${usd(share)} pledge as the first member`, () => A.signJoin(w!, circle, share, payee, payout));
      prev = null;
      await refresh();
      sh.close();
      inviteSheet();
    } catch (e) {
      go.disabled = false;
      go.textContent = "Try again";
      toast(friendly(e), "err", 6000);
    }
  });
}
/** Joining stays open a day (a week for weekly rounds). */
const joinWindow = (round: number) => (round >= 604800 ? 604800 : 86400);
/** A payee change waits as long as one round's bidding, at least 5 minutes and at most 2 days. */
const payeeDelay = (round: number) => Math.min(Math.max(round, 300), 172800);

function startFlow() {
  if (!w) return DEMO ? setupFlow() : undefined;
  if (!snap || !ready(snap)) return setupFlow();
  if (!DEMO) return createFlow();
  const sh = openSheet(`
    <div class="tx">
      <p class="kicker">New circle</p>
      <h2>Start a practice circle</h2>
      <div class="trio"><span class="pav me">You</span><span class="pav">A</span><span class="pav">K</span></div>
      <p class="lead center">You, Ah Ming and Kitty. Ah Ming and Kitty are bots run by our circle secretary, so you don't have to wait for friends.</p>
      <dl class="rows glass">
        <div><dt>Each round</dt><dd>$0.01 from everyone · $0.03 pot</dd></div>
        <div><dt>Rounds</dt><dd>3, two minutes of bidding each</dd></div>
        <div><dt>You need</dt><dd>$0.03 in total · you have ${money(snap.bal)}</dd></div>
        <div><dt>Organiser fee</dt><dd>1%, taken only from discounts</dd></div>
        <div><dt>Gas you pay</dt><dd>none</dd></div>
      </dl>
      <label class="fl">Your name in the circle<input class="field" id="f-name" maxlength="32" value="${esc(saved.name ?? "")}" autocomplete="nickname" placeholder="e.g. Mei"></label>
      <div class="tx-progress" hidden></div>
      <div class="tx-actions"><button class="btn-primary block" data-go>Start the circle</button></div>
    </div>`);
  const go = sh.body.querySelector<HTMLButtonElement>("[data-go]")!;
  let circle: Address | null = null;
  go.addEventListener("click", async () => {
    const name = val(sh.body, "f-name");
    if (!name) return toast("Tell the circle your name.", "err");
    if (bytes(name) > 32) return toast("Names can be at most 32 bytes.", "err");
    saved.name = name;
    save();
    go.disabled = true;
    go.innerHTML = `<span class="spinner light"></span> Starting…`;
    const pEl = sh.body.querySelector<HTMLElement>(".tx-progress")!;
    pEl.hidden = false;
    const p = progressIn(pEl);
    try {
      const params = A.practiceParams(name);
      await ensureFunds(p, params.share);
      if (!circle) {
        const made = await signAndSend(p, "the circle's rules", () => A.signOpen(w!, params));
        circle = A.openedCircle(made.rc);
        saved.circles = [...saved.circles.filter((c) => c !== circle), circle];
        saved.current = circle;
        save();
      }
      await signAndSend(p, "your $0.01 pledge", () => A.signJoin(w!, circle!, params.share, name, w!.address));
      p.step("Ah Ming and Kitty are on their way").done();
      sh.body.querySelector(".tx-actions")!.innerHTML = `<div class="done-msg">Your circle is open. Round 1 starts when both friends have joined, in about half a minute.</div><button class="btn-glass block" data-close>Back to my circle</button>`;
      sh.body.querySelector("[data-close]")!.addEventListener("click", () => sh.close());
      prev = null;
      await refresh();
    } catch (e) {
      go.disabled = false;
      go.textContent = "Try again";
      toast(friendly(e), "err", 6000);
    }
  });
}

let bidVal = 0n;
let pendingJoin: string | null = null;
const potOf = () => (snap?.info ? snap.info.share * BigInt(snap.info.size) : 30000n);
const shareOf = () => snap?.info?.share ?? 10000n;
/** Bids move in steps of 1% of the pot, up to the circle's discount cap. */
const bidStep = () => (potOf() / 100n > 0n ? potOf() / 100n : 1n);
const bidMax = () => snap?.info?.maxDiscount ?? (potOf() * 3n) / 10n;
const bidFloor = () => (snap?.r && snap.r.bestBidder !== ZERO ? snap.r.bestDiscount + bidStep() : bidStep() * 4n);
const clamp = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);
function showBid() {
  if (!bidVal || bidVal < bidFloor()) bidVal = clamp(bidFloor(), 0n, bidMax());
  const v = document.getElementById("bid-val");
  if (v) v.textContent = usd(bidVal);
}

const circleName = () => esc(snap?.info?.name && !DEMO ? snap.info.name : "your circle");
const winnerPayee = () => {
  const s = snap!;
  const r = s.r!;
  const k = s.members.findIndex((m) => same(m, r.winner));
  const st = k >= 0 ? s.state[k] : null;
  const name = st && same(st.payee.address, r.payTo) ? st.payee.name : "the locked payee";
  return `<b>${esc(name)}</b> · <code>${short(r.payTo)}</code>`;
};

const actions: Record<string, () => void> = {
  create: () => (DEMO ? setupFlow() : void createWalletLive()),
  connect: () => void connectFlow(),
  "to-demo": () => switchMode("demo"),
  "to-live": () => switchMode("live"),
  setup: () => setupFlow(),
  start: () => startFlow(),
  how: () => howSheet(),
  invite: () => inviteSheet(),
  join: () => saved.current && void joinFlow(saved.current),
  pay: () =>
    confirmTx({
      title: `Pay ${usd(shareOf())}`,
      lead: "Your signature can only move exactly one share, into this circle, for this round.",
      rows: [["To", `${circleName()}'s pot`], ["Amount", `${usd(shareOf())} tUSD8`], ["Round", String(snap?.round ?? "")], scopeRow("this circle"), gasRow],
      cta: "Sign the payment",
      run: async (p) => {
        await ensureFunds(p, shareOf());
        return (await signAndSend(p, `${usd(shareOf())} for round ${snap!.round}`, () => A.signPay(w!, saved.current!, shareOf(), BigInt(snap!.round)))).tx;
      },
      done: () => `Paid. Your ${usd(shareOf())} is in the pot.`,
    }),
  order: () => orderFlow(),
  revokeOrder: () =>
    confirmTx({
      title: "Revoke your standing order",
      lead: "The circle stops collecting your share. You can still pay each round yourself.",
      rows: [["Circle", circleName()], gasRow],
      cta: "Sign",
      run: async (p) => (await signAndSend(p, "the revocation", () => A.signRevokeOrder(w!, saved.current!))).tx,
      done: () => "Revoked. Nothing more will be collected.",
    }),
  bid: () =>
    confirmTx({
      title: `Bid a ${usd(bidVal)} discount`,
      lead: "If your bid is the biggest when the timer ends, you take this round's pot minus the discount. The discount, less the organiser's fee, is shared with every member.",
      rows: [["Discount", usd(bidVal)], ["You'd take", `${usd(potOf() - bidVal)} of the ${usd(potOf())} pot`], ["Cap", `${(snap?.info?.maxDiscountBps ?? 3000) / 100}% of the pot`], gasRow],
      cta: "Sign the bid",
      run: async (p) => (await signAndSend(p, `a ${usd(bidVal)} bid`, () => A.signBid(w!, saved.current!, BigInt(snap!.round), bidVal))).tx,
      done: () => "Bid placed. It wins if nobody bids higher before the timer ends.",
    }),
  close: () =>
    confirmTx({
      title: "Close the auction",
      lead: "Bidding is over. Closing picks the winner (the biggest discount, or with no bids the first member who hasn't won) and locks their payee for this pot.",
      rows: [["Signature", "none needed: the rules decide"], gasRow],
      cta: "Close it",
      run: async (p) => (await withStep(p, "The relayer closes the auction", () => A.submit(A.anyone(saved.current!, "closeAuction")), (r) => txLink(r.tx, "tx"))).tx,
      done: () => "Closed. Now the members approve the release.",
    }),
  approve: () =>
    confirmTx({
      title: "Approve the release",
      lead: "Check who gets the pot. The payee was fixed when the auction closed; a later change can't touch this pot.",
      rows: [
        ["Pot goes to", winnerPayee()],
        ["Winner", esc(snap?.r ? nameOf(snap.r.winner) : "")],
        ["Discount", usd(snap?.r?.discount ?? 0n)],
        ...(snap?.quote ? ([["Paid out now", usd(snap.quote.payout)], ["Held as security", usd(snap.quote.securityHeld)], ["Dividend to all", usd(snap.quote.dividend)]] as [string, string][]) : []),
        ["Approvals", `${snap?.r?.approvals ?? 0} of ${snap?.needed ?? 2}, yours makes ${(snap?.r?.approvals ?? 0) + 1}`],
        gasRow,
      ],
      cta: "Sign the approval",
      run: async (p) => (await signAndSend(p, "your approval", () => A.signApprove(w!, saved.current!, BigInt(snap!.round)))).tx,
      done: () => "Approved.",
    }),
  release: () =>
    confirmTx({
      title: "Release the pot",
      lead: "The quorum has approved. Anyone can release it, and it can only go to the payee locked when the auction closed.",
      rows: [["Goes to", winnerPayee()], ...(snap?.quote ? ([["Paid out now", usd(snap.quote.payout)], ["Held as security", usd(snap.quote.securityHeld)], ["Dividend to all", usd(snap.quote.dividend)]] as [string, string][]) : []), gasRow],
      cta: "Release it",
      run: async (p) => (await withStep(p, "The relayer releases the pot", () => A.submit(A.anyone(saved.current!, "release")), (r) => txLink(r.tx, "tx"))).tx,
      done: (tx) => `<span class="big-ok">${TICK}</span> Released to the locked payee. The discount is shared with every member.<br>${tx ? txLink(tx) : ""}`,
    }),
  payee: () => payeeFlow(),
  cancelPayee: () =>
    confirmTx({
      title: "Cancel the payee change",
      lead: "Your payee stays as it is. If you didn't ask for this change, your key may be stolen: cancel it, and tell the circle.",
      rows: [["Circle", circleName()], gasRow],
      cta: "Sign and cancel",
      run: async (p) => (await signAndSend(p, "the cancellation", () => A.signCancelPayee(w!, saved.current!))).tx,
      done: () => "Cancelled. Your payee didn't change.",
    }),
  leave: () =>
    confirmTx({
      title: "Leave this circle",
      lead: `You can leave until the circle is full. Your ${usd(shareOf())} pledge goes back to your payee.`,
      rows: [["Circle", circleName()], ["Refund", usd(shareOf())], gasRow],
      cta: "Sign and leave",
      run: async (p) => (await signAndSend(p, "your leave", () => A.signLeave(w!, saved.current!))).tx,
      done: () => "You left. Your pledge is on its way back to your payee.",
    }),
  cancelUnfilled: () =>
    confirmTx({
      title: "Cancel and refund",
      lead: "The circle didn't fill by its deadline. Cancelling refunds every pledge in full, each to its member's payee.",
      rows: [["Signature", "none needed: the rules decide"], gasRow],
      cta: "Cancel the circle",
      run: async (p) => (await withStep(p, "The relayer cancels the circle", () => A.submit(A.anyone(saved.current!, "cancelUnfilled")), (r) => txLink(r.tx, "tx"))).tx,
      done: () => "Cancelled. Every pledge is refunded.",
    }),
  dissolve: () =>
    confirmTx({
      title: "Dissolve this circle",
      lead: "The circle stops. The money left goes back to members in proportion to what each put in minus what each took out.",
      rows: [["Signature", "none needed: the rules decide"], gasRow],
      cta: "Dissolve it",
      run: async (p) => (await withStep(p, "The relayer dissolves the circle", () => A.submit(A.anyone(saved.current!, "dissolve")), (r) => txLink(r.tx, "tx"))).tx,
      done: () => "Dissolved. Pay out your refund next.",
    }),
  withdraw: () =>
    confirmTx({
      title: `Pay out ${usd(snap?.owed ?? 0n)}`,
      lead: "Your security and dividends go to your own payee; nobody can send them anywhere else.",
      rows: [["From", circleName()], ["To", snap && meIdx(snap) >= 0 ? `${esc(snap.state[meIdx(snap)].payee.name)} · <code>${short(snap.state[meIdx(snap)].payee.address)}</code>` : "your payee"], gasRow],
      cta: "Pay out",
      run: async (p) => (await withStep(p, "The relayer pays you out", () => A.submit(A.anyone(saved.current!, "withdrawFor", [w!.address])), (r) => txLink(r.tx, "tx"))).tx,
      done: () => "Done. The money is with your payee.",
    }),
};

function orderFlow() {
  const s = snap!;
  const info = s.info!;
  const i = meIdx(s);
  const leftRounds = Math.max(1, Math.min(info.size, info.size - s.round + (s.paid[i] ? 0 : 1)));
  confirmTx({
    title: "Pay every round automatically",
    lead: "A standing order lets the circle collect your share each round, so you never miss one. It can only take <b>one share a round</b>, at most the rounds you choose, until the date you choose. Revoke it any time.",
    rows: [["Share", `${usd(info.share)} a round`], ["Signatures", "two: the order, and a permit for share × rounds, usable only by this circle"], gasRow],
    form: `<label class="fl">Rounds, at most<input class="field" id="o-rounds" type="number" min="1" max="${info.size}" value="${leftRounds}" inputmode="numeric"></label>
      <label class="fl">Expires in (days)<input class="field" id="o-days" type="number" min="1" max="365" value="7" inputmode="numeric"></label>`,
    cta: "Sign both",
    validate: (b) => {
      const r = Number(val(b, "o-rounds"));
      const d = Number(val(b, "o-days"));
      if (!Number.isInteger(r) || r < 1 || r > info.size) return `Rounds must be 1 to ${info.size}.`;
      if (!(d >= 1 && d <= 365)) return "Expiry must be 1 to 365 days.";
      return null;
    },
    run: async (p, b) => {
      const rounds = Number(val(b, "o-rounds"));
      const days = Number(val(b, "o-days"));
      const order = await withStep(p, `Signing the order: one share a round, at most ${rounds} round${rounds > 1 ? "s" : ""}`, () => A.signOrderOnly(w!, saved.current!, rounds, days), () => "no gas");
      const call = await withStep(p, `Signing a permit for ${usd(info.share * BigInt(rounds))}, only for this circle`, () => A.signPermit(w!, saved.current!, info.share, order), () => "no gas");
      return (await withStep(p, "The relayer submits it and pays the gas", () => A.submit(call), (r) => txLink(r.tx, "tx"))).tx;
    },
    done: () => "Standing order set. Our secretary collects your share each round.",
  });
}

function payeeFlow() {
  const s = snap!;
  const me = s.state[meIdx(s)];
  confirmTx({
    title: "Change your payee",
    lead: `The change waits <b>${dur(s.info!.payeeDelay)}</b> before it takes effect. Every member sees it meanwhile, and you can cancel it with one signature. A pot already closed keeps its payee.`,
    rows: [["Payee now", `${esc(me.payee.name)} · <code>${short(me.payee.address)}</code>`], gasRow],
    form: payeeForm(me.payee.name, me.payee.address),
    cta: "Sign the request",
    validate: checkPayee,
    run: async (p, b) => (await signAndSend(p, "the payee change", () => A.signChangePayee(w!, saved.current!, val(b, "f-addr") as Address, val(b, "f-name")))).tx,
    done: () => "Requested. Every member now sees the change while it waits.",
  });
}

// ---------------------------------------------------------------- profile and info sheets

let installEvt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvt = e as never;
});

function profileSheet() {
  const sh = openSheet("");
  const home = () => {
    const s = snap;
    sh.show(`
      <div class="profile">
        <div class="pf-head"><span class="pav me big">You</span><div><h2>${w?.kind === "injected" ? "Your wallet" : "Your test wallet"}</h2>${w ? `<button class="addr" data-copy="${w.address}">${short(w.address)} <span>copy</span></button>` : "<p class=muted>No wallet yet</p>"}</div></div>
        ${w && s ? `<div class="pf-stats"><div class="glass"><span>Test dollars</span><b>${money(s.bal)}</b></div><div class="glass"><span>Gas you pay</span><b>None</b></div><div class="glass"><span>Wallet</span><b>${w.kind === "injected" ? "Connected" : "This browser"}</b></div></div>` : ""}
        ${DEMO
          ? `<button class="pf-mode glass" data-p="to-live"><span class="mi">${MI.live}</span><span class="txt"><b>You're in demo mode</b><span>Bots and free test money. Tap to go back to live mode.</span></span><i>›</i></button>`
          : `<button class="pf-mode glass" data-p="to-demo"><span class="mi">${MI.demo}</span><span class="txt"><b>Try demo mode</b><span>Free test money and two bot friends. Play full rounds in minutes.</span></span><i>›</i></button>`}
        <nav class="menu glass">
          <button data-p="how"><span class="mi">${MI.how}</span>How it works<i>›</i></button>
          <button data-p="security"><span class="mi">${MI.shield}</span>Who can move the pot<i>›</i></button>
          <button data-p="keys"><span class="mi">${MI.key}</span>Your wallet<i>›</i></button>
          ${!DEMO && w ? `<button data-p="fund"><span class="mi">${MI.plus}</span>Add test money<i>›</i></button>` : ""}
          ${!DEMO && w?.kind === "burner" ? `<button data-p="secret"><span class="mi">${MI.key}</span>Back up this wallet<i>›</i></button>` : ""}
          <button data-p="proof"><span class="mi">${MI.ok}</span>Proof on chain<i>›</i></button>
          <a href="${SITE}/live" target="_blank" rel="noopener"><span class="mi">${MI.live}</span>Watch circles live<i>↗</i></a>
          <button data-p="install"><span class="mi">${MI.down}</span>Add Sovereign to your home screen<i>›</i></button>
        </nav>
        ${w ? `<button class="danger" data-p="reset">${w.kind === "injected" ? "Disconnect this wallet" : "Reset this test wallet"}</button>` : ""}
        <p class="fine center">Sovereign · QDay Aevum testnet · <a href="${SITE}" target="_blank" rel="noopener">sovereign.exprmnts.fun</a></p>
      </div>`);
    sh.body.querySelector("[data-copy]")?.addEventListener("click", async (e) => {
      await navigator.clipboard?.writeText((e.currentTarget as HTMLElement).dataset.copy!);
      toast("Address copied", "ok", 1800);
    });
    for (const b of sh.body.querySelectorAll<HTMLElement>("[data-p]")) b.addEventListener("click", () => page(b.dataset.p!));
  };
  const page = (p: string) => {
    if (p === "how") return howInto(sh, home);
    if (p === "security") return securityInto(sh, home);
    if (p === "proof") return proofInto(sh, home);
    if (p === "keys") {
      sh.show(`<div class="info"><h2>Your wallet</h2><p class="lead">${w?.kind === "injected" ? "Your browser wallet holds the key. Sovereign only asks it to sign readable EIP-712 messages; it never asks it to send a transaction." : "The key lives in this browser only. Clearing site data deletes it. It's a test wallet: never use it for anything real."}</p>
        <dl class="rows stack glass"><div><dt>What you sign</dt><dd>EIP-3009 payments for exactly one share, EIP-712 bids, approvals and payee changes, and EIP-2612 permits for standing orders</dd></div><div><dt>Who sends it</dt><dd>Our relayer, which pays the gas and can't change any detail you signed</dd></div><div><dt>Network</dt><dd>QDay Aevum testnet · chain 44005</dd></div><div><dt>Address</dt><dd><code>${w ? esc(w.address) : "–"}</code></dd></div></dl>
        <p class="fine">Testnet only. tUSD8 is QDay's test dollar and has no value.</p></div>`, home);
      return;
    }
    if (p === "to-live" || p === "to-demo") return switchMode(p === "to-live" ? "live" : "demo");
    if (p === "fund" && w) {
      sh.show(`<div class="info"><h2>Add test money</h2><p class="lead">Get 0.03 test dollars from Sovereign's starter faucet (once per wallet), or ask a friend to send tUSD8 to this address on the Aevum testnet. You never need a gas token.</p>
        <div class="addr-box glass"><span class="kicker">Your Aevum address</span><code>${w.address}</code><button class="btn-glass" data-copy="${w.address}">Copy address</button></div>
        <div class="tx-progress"></div><button class="btn-primary block" data-faucet>Get $0.03 of test money</button></div>`, home);
      sh.body.querySelector("[data-copy]")?.addEventListener("click", async (e) => {
        await navigator.clipboard?.writeText((e.currentTarget as HTMLElement).dataset.copy!);
        toast("Address copied", "ok", 1800);
      });
      sh.body.querySelector("[data-faucet]")!.addEventListener("click", async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        try {
          await withStep(progressIn(sh.body.querySelector(".tx-progress")!), "Getting free test money", () => A.faucet(w!.address), (h) => txLink(h, "tx"));
          await refresh();
        } catch (err) {
          b.disabled = false;
          toast(friendly(err), "err", 6000);
        }
      });
      return;
    }
    if (p === "secret") {
      sh.show(`<div class="info"><h2>Back up this wallet</h2><p class="lead">This key is your test wallet. Anyone who has it controls it. Import it into MetaMask to use the same wallet elsewhere; never share it.</p>
        <button class="btn-glass block" data-reveal>Show my wallet key</button><div class="phrase glass" hidden><code>${esc(saved.pk ?? "")}</code></div></div>`, home);
      sh.body.querySelector("[data-reveal]")!.addEventListener("click", (e) => {
        (e.currentTarget as HTMLElement).hidden = true;
        sh.body.querySelector<HTMLElement>(".phrase")!.hidden = false;
      });
      return;
    }
    if (p === "install") {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      sh.show(`<div class="info"><h2>Add Sovereign to your home screen</h2>${installEvt ? `<p class="lead">Install Sovereign as an app. It opens full screen, like any other app.</p><button class="btn-primary block" data-install>Install Sovereign</button>` : ios ? `<p class="lead">In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>` : `<p class="lead">Open your browser's menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>`, home);
      sh.body.querySelector("[data-install]")?.addEventListener("click", () => void installEvt?.prompt());
      return;
    }
    if (p === "reset") {
      const inj = w?.kind === "injected";
      sh.show(`<div class="info"><h2>${inj ? "Disconnect this wallet?" : "Reset this test wallet?"}</h2><p class="lead">${inj ? "Sovereign forgets your wallet on this device. Your circles stay on chain; connect again to see them." : "The key on this device is deleted and you start over with a fresh wallet. Your old circles and test money stay on chain, but you won't be able to use them."}</p><button class="btn-primary block danger-btn" data-yes>${inj ? "Disconnect" : "Reset"}</button></div>`, home);
      sh.body.querySelector("[data-yes]")!.addEventListener("click", () => {
        localStorage.removeItem(KEY);
        location.reload();
      });
    }
  };
  home();
}

function howInto(sh: Sheet, back?: () => void) {
  sh.show(`<div class="info"><h2>How a round works</h2><figure class="how-fig"><div id="how-ring" style="--ring: min(300px, 74vw)"></div><figcaption id="how-cap"></figcaption><div class="flow-dots" id="how-dots"></div></figure>
    <dl class="rows stack glass"><div><dt>Pay</dt><dd>Everyone signs a payment of one share into a pot nobody holds.</dd></div><div><dt>Bid</dt><dd>Need money now? Bid a discount. The biggest wins.</dd></div><div><dt>Close</dt><dd>Anyone closes the auction. The winner's payee is locked.</dd></div><div><dt>Approve</dt><dd>A quorum signs yes, after seeing the payee's name and address.</dd></div><div><dt>Release</dt><dd>Anyone releases it. The pot goes only to the locked payee, and the discount is shared with everyone.</dd></div></dl></div>`, back);
  const demo = mountFlowDemo(sh.body.querySelector("#how-ring")!, sh.body.querySelector("#how-cap")!, sh.body.querySelector("#how-dots")!);
  const obs = new MutationObserver(() => {
    if (!sh.body.querySelector("#how-ring")) {
      demo.stop();
      obs.disconnect();
    }
  });
  obs.observe(sh.body, { childList: true });
}

function howSheet() {
  const sh = openSheet("");
  howInto(sh);
}

function securityInto(sh: Sheet, back?: () => void) {
  const row = (ok: boolean, t: string, d: string) => `<div class="who-row"><span class="mark ${ok ? "y" : "n"}">${ok ? TICK : CROSS}</span><div><b>${t}</b><p>${d}</p></div></div>`;
  sh.show(`<div class="info"><h2>Who can move the pot?</h2><div class="who glass">
    ${row(false, "The organiser", "Opens the circle and earns a capped fee from discounts. No owner, no admin, no upgrade.")}
    ${row(false, "Our relayer", "Only submits your signatures and pays the gas. Change any detail and the signature fails.")}
    ${row(false, "A thief with your key", "A payee change waits, every member sees it, and you cancel it with one signature.")}
    ${row(true, "The locked payee, after a quorum", "The payee is fixed when the auction closes. Members approve, then anyone releases to it.")}
    </div><p class="lead">Try it: in a circle, open <b>Your moves</b> and request a payee change. Every member sees the warning until it takes effect, and one signature cancels it.</p></div>`, back);
}

function proofInto(sh: Sheet, back?: () => void) {
  const a = (href: string, t: string) => `<a href="${href}" target="_blank" rel="noopener">${t} ↗</a>`;
  sh.show(`<div class="info"><h2>Proof on chain</h2><dl class="rows glass">
    <div><dt>Factory</dt><dd>${a(`${NET.explorer}/address/${NET.factory}`, short(NET.factory))}</dd></div>
    <div><dt>Circle code</dt><dd>${a(`${NET.explorer}/address/${NET.implementation}`, short(NET.implementation))}</dd></div>
    ${saved.current ? `<div><dt>Your circle</dt><dd>${a(`${NET.explorer}/address/${saved.current}`, short(saved.current))}</dd></div>` : ""}
    <div><dt>Tests</dt><dd>${a("https://github.com/nikhil-pn/sovereign/tree/main/test", "52 Foundry tests")}</dd></div>
    <div><dt>Live circles</dt><dd>${a(`${SITE}/live`, "sovereign.exprmnts.fun/live")}</dd></div>
    <div><dt>Every claim</dt><dd>${a(`${SITE}/proof`, "sovereign.exprmnts.fun/proof")}</dd></div>
    </dl></div>`, back);
}

function circlesSheet() {
  const sh = openSheet(`<div class="info"><h2>Your circles</h2>
    ${saved.circles.length ? `<nav class="menu glass">${saved.circles.map((c, i) => `<button data-c="${c}"><span class="mi">${MI.circle}</span>Circle ${i + 1} <small>${short(c)}</small><i>${c === saved.current ? TICK : "›"}</i></button>`).reverse().join("")}</nav>` : '<p class="lead">No circles yet.</p>'}
    <button class="btn-primary block" data-new>${DEMO ? "Start a new circle" : "Open a new circle"}</button></div>`);
  for (const b of sh.body.querySelectorAll<HTMLElement>("[data-c]"))
    b.addEventListener("click", () => {
      saved.current = b.dataset.c as Address;
      save();
      prev = null;
      sh.close();
      void refresh();
    });
  sh.body.querySelector("[data-new]")!.addEventListener("click", () => {
    sh.close();
    startFlow();
  });
}

// ---------------------------------------------------------------- events and loop

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const act = t.closest<HTMLElement>("[data-act]");
  if (act) return actions[act.dataset.act!]?.();
  const bid = t.closest<HTMLElement>("[data-bid]");
  if (bid) {
    bidVal = clamp(bidVal + BigInt(Number(bid.dataset.bid)) * bidStep(), bidFloor(), bidMax());
    showBid();
    return;
  }
  const go = t.closest<HTMLElement>("[data-tab],[data-tab-go]");
  if (go && w) {
    tab = (go.dataset.tab ?? go.dataset.tabGo) as typeof tab;
    renderShell();
    draw();
  }
});
$("profile-btn").addEventListener("click", () => profileSheet());
$("circle-pill").addEventListener("click", () => (w ? circlesSheet() : DEMO ? setupFlow() : undefined));
$("dock-plus").addEventListener("click", () => (w ? startFlow() : DEMO ? setupFlow() : undefined));

function tickTimers() {
  for (const el of document.querySelectorAll<HTMLElement>(".timer[data-end]")) {
    el.textContent = left(Number(el.dataset.end) - Math.floor(Date.now() / 1000));
  }
}

let busy: Promise<void> | null = null;
let again = false;
async function refresh(): Promise<void> {
  if (busy) {
    again = true;
    return busy;
  }
  busy = (async () => {
    do {
      again = false;
      try {
        const s = await load();
        prev = snap;
        snap = s;
        draw();
      } catch (e) {
        console.error("Sovereign:", e);
      }
    } while (again);
  })();
  await busy;
  busy = null;
}

async function boot() {
  if (saved.wallet === "injected" && !DEMO) w = await injected(false).catch(() => null);
  else if (saved.pk) w = burner(saved.pk);
  if (w) {
    (PEOPLE as Record<string, string>)[w.address.toLowerCase()] = "You";
    renderShell();
  }
  onAccountsChanged(() => saved.wallet === "injected" && location.reload());
  draw();
  await refresh();
  if (joinParam) {
    pendingJoin = joinParam;
    if (w) void joinFlow(joinParam);
    else toast("You're invited to a circle. Make a test wallet or connect yours to join.", "info", 6000);
  }
  setInterval(() => void refresh(), 4000);
  setInterval(tickTimers, 1000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

void boot();
