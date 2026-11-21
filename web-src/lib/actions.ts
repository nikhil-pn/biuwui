/**
 * Everything a member does on chain. The member's wallet signs (EIP-3009, EIP-712, EIP-2612); the relayer
 * (/api/relay) submits and pays the gas. Members never send a transaction. Message shapes are shared with
 * the relayer and the bot through scripts/lib/sign.ts, so all three agree byte for byte.
 */
import { decodeEventLog, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { actionTypes, circleDomain, joinNonce, nowSec, payNonce, permitTypes, receiveTypes, tusd8Domain, vrs } from "../../scripts/lib/sign";
import { circleAbi, factoryAbi } from "./abi.ts";
import { NET, pub, tusd8Abi } from "./aevum.ts";
import type { Wallet } from "./wallet.ts";

/** Signatures live 30 minutes (the relayer accepts at most one hour). */
const WINDOW = 1800n;

// ---------------------------------------------------------------- reads

export const read = <T>(circle: Address, functionName: string, args: readonly unknown[] = []) =>
  pub.readContract({ address: circle, abi: circleAbi as Abi, functionName, args }) as Promise<T>;

export const tokenBalance = (a: Address) => pub.readContract({ address: NET.token, abi: tusd8Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;

export interface RoundView {
  start: bigint;
  bidEnd: bigint;
  closedAt: bigint;
  bestBidder: Address;
  bestDiscount: bigint;
  collected: bigint;
  winner: Address;
  payTo: Address;
  discount: bigint;
  approvals: number;
  closed: boolean;
  released: boolean;
}

export interface CircleInfo {
  address: Address;
  name: string;
  share: bigint;
  size: number;
  roundLength: number;
  payeeDelay: number;
  joinBy: number;
  maxDiscountBps: number;
  maxDiscount: bigint;
  feeBps: number;
  quorumBps: number;
  organiser: Address;
  memberCount: number;
  phase: number;
}

const FIELDS = ["name", "share", "size", "roundLength", "payeeDelay", "joinBy", "maxDiscountBps", "maxDiscount", "feeBps", "quorumBps", "organiser", "memberCount", "phase"] as const;

export async function circleInfo(c: Address): Promise<CircleInfo> {
  const r = await pub.multicall({ contracts: FIELDS.map((f) => ({ address: c, abi: circleAbi as Abi, functionName: f })), allowFailure: false });
  const v = Object.fromEntries(FIELDS.map((f, i) => [f, r[i]])) as Record<(typeof FIELDS)[number], unknown>;
  return {
    address: c,
    name: v.name as string,
    share: v.share as bigint,
    size: Number(v.size),
    roundLength: Number(v.roundLength),
    payeeDelay: Number(v.payeeDelay),
    joinBy: Number(v.joinBy),
    maxDiscountBps: Number(v.maxDiscountBps),
    maxDiscount: v.maxDiscount as bigint,
    feeBps: Number(v.feeBps),
    quorumBps: Number(v.quorumBps),
    organiser: v.organiser as Address,
    memberCount: Number(v.memberCount),
    phase: Number(v.phase),
  };
}

export interface Payee {
  address: Address;
  name: string;
}
export interface PendingPayee extends Payee {
  effectiveAt: number;
}
export interface Order {
  expiresAt: bigint;
  maxRounds: number;
  used: number;
  active: boolean;
}

/** Per-member state of a circle for `round`, in one multicall. */
export async function memberState(c: Address, members: Address[], round: bigint) {
  const per = ["payeeOf", "pendingPayeeOf", "hasWon", "paid", "approved", "standingOrderOf", "withdrawable"] as const;
  const r = round > 0n ? round : 1n;
  const res = await pub.multicall({
    contracts: members.flatMap((m) => per.map((f) => ({ address: c, abi: circleAbi as Abi, functionName: f, args: f === "paid" || f === "approved" ? [r, m] : [m] }))),
    allowFailure: true,
  });
  const ok = <T>(i: number) => (res[i]?.status === "success" ? (res[i].result as T) : null);
  return members.map((m, k) => {
    const o = k * per.length;
    const payee = ok<readonly [Address, string]>(o) ?? [m, "?"];
    const pend = ok<readonly [Address, string, bigint]>(o + 1);
    return {
      payee: { address: payee[0], name: payee[1] } as Payee,
      pending: pend && pend[2] > 0n && pend[0] !== "0x0000000000000000000000000000000000000000" ? ({ address: pend[0], name: pend[1], effectiveAt: Number(pend[2]) } as PendingPayee) : null,
      won: Boolean(ok<boolean>(o + 2)),
      paid: round > 0n && Boolean(ok<boolean>(o + 3)),
      approved: round > 0n && Boolean(ok<boolean>(o + 4)),
      order: ok<Order>(o + 5) ?? { expiresAt: 0n, maxRounds: 0, used: 0, active: false },
      owed: ok<bigint>(o + 6) ?? 0n,
    };
  });
}

/** True only for circles a Biu Wui factory opened, so an invite link can't point at some other contract. */
export async function isBiuWuiCircle(c: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(c)) return false;
  const res = await pub.multicall({
    contracts: [NET.factory, NET.factoryV1].map((f) => ({ address: f, abi: factoryAbi as Abi, functionName: "isCircle", args: [c] })),
    allowFailure: true,
  });
  return res.some((r) => r.status === "success" && r.result === true);
}

// ---------------------------------------------------------------- the relayer and the starter faucet (docs/API.md)

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function post<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: json(body) });
  } catch {
    throw new Error("Can't reach the relayer. Check your connection and try again.");
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(data.error || `The relayer answered ${r.status}.`);
  return data as T;
}

async function receipt(hash: Hex): Promise<TransactionReceipt> {
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1500 });
  if (rc.status !== "success") throw new Error("Someone else acted first and the circle moved on before this landed. Nothing was taken from you; check the circle and try again if it's still needed.");
  return rc;
}

/** Starter money: 0.03 tUSD8, once per wallet. Waits until it lands. */
export async function faucet(a: Address): Promise<Hex> {
  const { hash } = await post<{ hash: Hex }>("/api/faucet", { address: a });
  await receipt(hash);
  return hash;
}

/** A signed (or anyone-may-call) action, ready for the relayer. */
export interface Call {
  target: Address;
  fn: string;
  args: readonly unknown[];
}

/** Hand a call to the relayer, which simulates it, pays the gas and sends it. Waits for the block. */
export async function submit(c: Call): Promise<{ tx: Hex; rc: TransactionReceipt }> {
  const { hash } = await post<{ hash: Hex }>("/api/relay", c);
  return { tx: hash, rc: await receipt(hash) };
}

/** The circle a `createCircleWithSig` receipt opened. */
export function openedCircle(rc: TransactionReceipt): Address {
  for (const l of rc.logs) {
    try {
      const d = decodeEventLog({ abi: factoryAbi as Abi, data: l.data, topics: l.topics as never });
      if (d.eventName === "CircleCreated") return (d.args as unknown as { circle: Address }).circle;
    } catch {
      /* another contract's log */
    }
  }
  throw new Error("The circle was opened but its address wasn't in the receipt. Look for it under your circles.");
}

// ---------------------------------------------------------------- what members sign

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

export interface OpenParams {
  share: bigint;
  size: number;
  joinWindow: number;
  roundLength: number;
  graceLength: number;
  payeeDelay: number;
  maxDiscountBps: number;
  feeBps: number;
  quorumBps: number;
  securityBps: number;
  name: string;
}

/** The practice circle: 3 seats, 0.01 tUSD8 a round, two-minute rounds. The secretary fills the other two seats. */
export const practiceParams = (name: string): OpenParams => ({
  share: 10000n,
  size: 3,
  joinWindow: 3600,
  roundLength: 120,
  graceLength: 900,
  payeeDelay: 300,
  maxDiscountBps: 3000,
  feeBps: 100,
  quorumBps: 6000,
  securityBps: 5000,
  name: `Practice · ${name}`.slice(0, 64),
});

/** The organiser signs the circle's rules once; the relayer opens it. */
export async function signOpen(w: Wallet, p: OpenParams): Promise<Call> {
  const deadline = nowSec() + WINDOW;
  const nonce = (await pub.readContract({ address: NET.factory, abi: factoryAbi as Abi, functionName: "nonces", args: [w.address] })) as bigint;
  const sig = await w.sign({
    domain: { name: "Biu Wui Factory", version: "1", chainId: NET.chainId, verifyingContract: NET.factory },
    types: OPEN_TYPES,
    primaryType: "OpenCircle",
    message: { organiser: w.address, ...p, nonce, deadline },
  } as never);
  return { target: NET.factory, fn: "createCircleWithSig", args: [{ token: NET.token, ...p }, w.address, deadline, sig] };
}

const signReceive = async (w: Wallet, to: Address, value: bigint, nonce: Hex) => {
  const validBefore = nowSec() + WINDOW;
  const sig = await w.sign({
    domain: tusd8Domain(),
    types: receiveTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from: w.address, to, value, validAfter: 0n, validBefore, nonce },
  } as never);
  return { validAfter: 0n, validBefore, ...vrs(sig) };
};

/** Join with a pledge of exactly one share; the nonce binds the circle, the member, the payee address and name. */
export async function signJoin(w: Wallet, circle: Address, share: bigint, payeeName: string, payout: Address): Promise<Call> {
  const auth = await signReceive(w, circle, share, joinNonce(circle, w.address, payout, payeeName));
  return { target: circle, fn: "joinWithAuthorization", args: [w.address, payeeName, payout, auth] };
}

/** Pay this round's share; the nonce binds the circle, the member and the round. */
export async function signPay(w: Wallet, circle: Address, share: bigint, round: bigint): Promise<Call> {
  const auth = await signReceive(w, circle, share, payNonce(circle, w.address, round));
  return { target: circle, fn: "payWithAuthorization", args: [w.address, auth] };
}

type ActionName = keyof typeof actionTypes;
async function signAction(w: Wallet, circle: Address, primaryType: ActionName, extra: Record<string, unknown>) {
  const deadline = nowSec() + WINDOW;
  const nonce = await read<bigint>(circle, "nonces", [w.address]);
  const sig = await w.sign({ domain: circleDomain(circle), types: actionTypes, primaryType, message: { member: w.address, nonce, deadline, ...extra } } as never);
  return { deadline, sig };
}

export async function signBid(w: Wallet, circle: Address, round: bigint, discount: bigint): Promise<Call> {
  const { deadline, sig } = await signAction(w, circle, "Bid", { round, discount });
  return { target: circle, fn: "bidWithSig", args: [w.address, discount, deadline, sig] };
}

export async function signApprove(w: Wallet, circle: Address, round: bigint): Promise<Call> {
  const { deadline, sig } = await signAction(w, circle, "ApproveRelease", { round });
  return { target: circle, fn: "approveReleaseWithSig", args: [w.address, deadline, sig] };
}

export async function signChangePayee(w: Wallet, circle: Address, payout: Address, name: string): Promise<Call> {
  const { deadline, sig } = await signAction(w, circle, "ChangePayee", { payout, name });
  return { target: circle, fn: "requestPayeeChangeWithSig", args: [w.address, payout, name, deadline, sig] };
}

const simple = (type: "RevokeStandingOrder" | "CancelPayeeChange" | "Leave", fn: string) => async (w: Wallet, circle: Address): Promise<Call> => {
  const { deadline, sig } = await signAction(w, circle, type, {});
  return { target: circle, fn, args: [w.address, deadline, sig] };
};
export const signRevokeOrder = simple("RevokeStandingOrder", "revokeStandingOrderWithSig");
export const signCancelPayee = simple("CancelPayeeChange", "cancelPayeeChangeWithSig");
export const signLeave = simple("Leave", "leaveWithSig");

/** A standing order: the order itself, then a tUSD8 permit for exactly share × rounds, spendable only by this circle. */
export async function signOrderOnly(w: Wallet, circle: Address, rounds: number, days: number) {
  const expiresAt = nowSec() + BigInt(Math.round(days * 86400));
  const order = await signAction(w, circle, "StandingOrder", { maxRounds: BigInt(rounds), expiresAt });
  return { rounds, expiresAt, ...order };
}
export async function signPermit(w: Wallet, circle: Address, share: bigint, o: { rounds: number; expiresAt: bigint; deadline: bigint; sig: Hex }): Promise<Call> {
  const nonce = (await pub.readContract({ address: NET.token, abi: tusd8Abi, functionName: "nonces", args: [w.address] })) as bigint;
  const permit = await w.sign({
    domain: tusd8Domain(),
    types: permitTypes,
    primaryType: "Permit",
    message: { owner: w.address, spender: circle, value: share * BigInt(o.rounds), nonce, deadline: o.deadline },
  } as never);
  return { target: circle, fn: "setStandingOrderWithSig", args: [w.address, o.rounds, o.expiresAt, o.deadline, o.sig, { deadline: o.deadline, ...vrs(permit) }] };
}

/** Steps anyone may submit (the rules decide; nothing is signed). `withdrawFor` pays only to the member's own payee. */
export const anyone = (circle: Address, fn: "closeAuction" | "release" | "cancelUnfilled" | "dissolve" | "withdrawFor", args: readonly unknown[] = []): Call => ({ target: circle, fn, args });
