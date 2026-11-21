// Reads straight from Aevum: one or two multicalls per refresh, and the circle's events for its activity feed.
import { decodeEventLog, type Address, type Hex, type Log } from "viem";
import { allCircles, circleAbi, explorerApi, factoryAbi, publicClient, TUSD8, tusd8Abi } from "../lib/chain";

export type Round = {
  start: bigint; bidEnd: bigint; closedAt: bigint; bestBidder: Address; bestDiscount: bigint; collected: bigint;
  winner: Address; payTo: Address; discount: bigint; approvals: number; closed: boolean; released: boolean;
};
export type Member = {
  address: Address; index: number; payee: Address; payeeName: string;
  pending: { payout: Address; name: string; effectiveAt: bigint } | null;
  won: boolean; paid: boolean; approved: boolean;
  order: { expiresAt: bigint; maxRounds: number; used: number; active: boolean };
  withdrawable: bigint; paidIn: bigint;
};
export type Circle = {
  address: Address; name: string; phase: number; size: number; share: bigint; round: bigint; joinBy: bigint;
  roundLength: number; graceLength: number; payeeDelay: number; maxDiscount: bigint; maxDiscountBps: number;
  feeBps: number; quorumBps: number; securityBps: number; quorumNeeded: number; organiser: Address; stalled: boolean;
  chit: bigint; members: Member[]; rd: Round | null; quote: { payout: bigint; fee: bigint; dividend: bigint; securityHeld: bigint } | null;
  practice: boolean; readAt: number;
};

const ZERO = "0x0000000000000000000000000000000000000000";
const c = <F extends string>(address: Address, functionName: F, args?: readonly unknown[]) =>
  ({ address, abi: circleAbi, functionName, args }) as never;

export async function loadCircle(address: Address): Promise<Circle> {
  const fields = [
    "name", "phase", "size", "share", "members", "currentRound", "joinBy", "roundLength", "graceLength", "payeeDelay",
    "maxDiscount", "maxDiscountBps", "feeBps", "quorumBps", "securityBps", "quorumNeeded", "organiser", "isStalled", "chitAmount",
  ] as const;
  const a = await publicClient.multicall({ contracts: fields.map((f) => c(address, f)), allowFailure: false });
  const v = Object.fromEntries(fields.map((f, i) => [f, a[i] as unknown])) as unknown as Record<(typeof fields)[number], unknown>;
  const members = v.members as Address[];
  const round = v.currentRound as bigint;
  const r = round > 0n ? round : 1n;

  const per = ["payeeOf", "pendingPayeeOf", "hasWon", "paid", "approved", "standingOrderOf", "withdrawable", "paidIn"] as const;
  const calls = [
    c(address, "getRound", [r]),
    c(address, "quotePayout", [r]),
    ...members.flatMap((m) =>
      per.map((f) => c(address, f, f === "paid" || f === "approved" ? [r, m] : [m])),
    ),
  ];
  const b = await publicClient.multicall({ contracts: calls, allowFailure: true });
  const ok = <T>(x: (typeof b)[number]) => (x.status === "success" ? (x.result as T) : null);
  const rd = ok<Round>(b[0]);
  const q = ok<readonly [bigint, bigint, bigint, bigint]>(b[1]);
  const ms: Member[] = members.map((m, i) => {
    const o = 2 + i * per.length;
    const payee = ok<readonly [Address, string]>(b[o]) ?? [m, "?"];
    const pend = ok<readonly [Address, string, bigint]>(b[o + 1]);
    const order = ok<{ expiresAt: bigint; maxRounds: number; used: number; active: boolean }>(b[o + 5]);
    return {
      address: m,
      index: i,
      payee: payee[0],
      payeeName: payee[1],
      pending: pend && pend[2] > 0n && pend[0] !== ZERO ? { payout: pend[0], name: pend[1], effectiveAt: pend[2] } : null,
      won: Boolean(ok<boolean>(b[o + 2])),
      paid: Boolean(ok<boolean>(b[o + 3])),
      approved: Boolean(ok<boolean>(b[o + 4])),
      order: order ?? { expiresAt: 0n, maxRounds: 0, used: 0, active: false },
      withdrawable: ok<bigint>(b[o + 6]) ?? 0n,
      paidIn: ok<bigint>(b[o + 7]) ?? 0n,
    };
  });
  const name = v.name as string;
  return {
    address, name, phase: Number(v.phase), size: Number(v.size), share: v.share as bigint, round, joinBy: v.joinBy as bigint,
    roundLength: Number(v.roundLength), graceLength: Number(v.graceLength), payeeDelay: Number(v.payeeDelay),
    maxDiscount: v.maxDiscount as bigint, maxDiscountBps: Number(v.maxDiscountBps), feeBps: Number(v.feeBps),
    quorumBps: Number(v.quorumBps), securityBps: Number(v.securityBps), quorumNeeded: Number(v.quorumNeeded),
    organiser: v.organiser as Address, stalled: Boolean(v.isStalled), chit: v.chitAmount as bigint,
    members: ms, rd: round > 0n ? rd : null, quote: q ? { payout: q[0], fee: q[1], dividend: q[2], securityHeld: q[3] } : null,
    practice: name.startsWith("Practice · "), readAt: Date.now(),
  };
}

export type CircleRow = { address: Address; factory: Address; name: string; phase: number; size: number; count: number; share: bigint; round: bigint; mine: boolean };

/** Every circle on both factories with a few fields each (one multicall), newest first. */
export async function listCircles(me?: Address | null): Promise<CircleRow[]> {
  const all = await allCircles();
  const f = ["name", "phase", "size", "memberCount", "share", "currentRound"] as const;
  const calls = all.flatMap(({ circle }) => [...f.map((x) => c(circle, x)), ...(me ? [c(circle, "isMember", [me])] : [])]);
  const res = await publicClient.multicall({ contracts: calls, allowFailure: true });
  const per = f.length + (me ? 1 : 0);
  return all
    .map(({ circle, factory }, i) => {
      const g = (k: number): unknown => (res[i * per + k]?.status === "success" ? res[i * per + k].result : undefined);
      return {
        address: circle, factory, name: String(g(0) ?? "?"), phase: Number(g(1) ?? 0), size: Number(g(2) ?? 0),
        count: Number(g(3) ?? 0), share: (g(4) as bigint) ?? 0n, round: (g(5) as bigint) ?? 0n, mine: Boolean(me && g(f.length)),
      };
    })
    .reverse();
}

export const balanceOf = (a: Address) => publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "balanceOf", args: [a] });
export const tokenNonce = (a: Address) => publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "nonces", args: [a] });
export const circleNonce = (circle: Address, a: Address) =>
  publicClient.readContract({ address: circle, abi: circleAbi, functionName: "nonces", args: [a] });
export const factoryNonce = (factory: Address, a: Address) =>
  publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "nonces", args: [a] });

// ---------------------------------------------------------------- events (activity feed)

export type Ev = { name: string; args: Record<string, unknown>; block: bigint; tx: Hex; logIndex: number };

function decode(l: { topics: readonly (Hex | null)[]; data: Hex; blockNumber: bigint; transactionHash: Hex; logIndex: number }): Ev | null {
  try {
    const topics = l.topics.filter(Boolean) as [Hex, ...Hex[]];
    const d = decodeEventLog({ abi: circleAbi, data: l.data, topics });
    return { name: d.eventName as string, args: (d.args ?? {}) as Record<string, unknown>, block: l.blockNumber, tx: l.transactionHash, logIndex: l.logIndex };
  } catch {
    return null;
  }
}

const createdKey = (a: Address) => `biuwui.created.${a.toLowerCase()}`;

/** The block a circle was created in: remembered, or found through the explorer API. */
export async function createdBlock(a: Address): Promise<bigint | null> {
  const k = localStorage.getItem(createdKey(a));
  if (k) return BigInt(k);
  const info = await explorerApi<{ creation_transaction_hash?: Hex; creation_tx_hash?: Hex }>(`/addresses/${a}`);
  const h = info?.creation_transaction_hash ?? info?.creation_tx_hash;
  if (!h) return null;
  const rc = await publicClient.getTransactionReceipt({ hash: h }).catch(() => null);
  if (!rc) return null;
  localStorage.setItem(createdKey(a), String(rc.blockNumber));
  return rc.blockNumber;
}
export const rememberCreated = (a: Address, block: bigint) => localStorage.setItem(createdKey(a), String(block));

async function rpcLogs(address: Address, from: bigint, to: bigint) {
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += 1000n) ranges.push([s, s + 999n > to ? to : s + 999n]);
  const out: Log[] = [];
  for (let i = 0; i < ranges.length; i += 4) {
    const part = await Promise.all(ranges.slice(i, i + 4).map(([f, t]) => publicClient.getLogs({ address, fromBlock: f, toBlock: t })));
    part.forEach((p) => out.push(...p));
  }
  return out;
}

type ScoutLog = { topics: (Hex | null)[]; data: Hex; block_number: number; transaction_hash: Hex; index: number };

/** All events since `from` (or the whole history), oldest first. Uses RPC in 1,000-block chunks when the
 *  range is small, and the explorer's index for long histories. */
export async function circleEvents(address: Address, latest: bigint, from?: bigint | null): Promise<Ev[]> {
  const evs: Ev[] = [];
  const start = from ?? (await createdBlock(address));
  if (start != null && latest - start <= 20_000n) {
    for (const l of await rpcLogs(address, start, latest)) {
      const e = decode(l as never);
      if (e) evs.push(e);
    }
  } else {
    let next = "";
    for (let page = 0; page < 6; page++) {
      const r = await explorerApi<{ items: ScoutLog[]; next_page_params: Record<string, string> | null }>(`/addresses/${address}/logs${next}`);
      if (!r) break;
      for (const l of r.items) {
        const e = decode({ topics: l.topics, data: l.data, blockNumber: BigInt(l.block_number), transactionHash: l.transaction_hash, logIndex: l.index });
        if (e) evs.push(e);
      }
      if (!r.next_page_params) break;
      next = "?" + new URLSearchParams(r.next_page_params).toString();
    }
    // the explorer can lag a few seconds: always add the last 1,000 blocks from RPC
    const tail = latest > 999n ? latest - 999n : 0n;
    for (const l of await rpcLogs(address, tail, latest)) {
      const e = decode(l as never);
      if (e && !evs.some((x) => x.tx === e.tx && x.logIndex === e.logIndex)) evs.push(e);
    }
  }
  return evs.sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1));
}
