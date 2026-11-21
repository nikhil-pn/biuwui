// Writes go ONLY through the relayer (/api/relay) and the starter faucet (/api/faucet). See docs/API.md.
import type { Address, Hex } from "viem";

export class Friendly extends Error {
  constructor(message: string, public code = "ERROR") {
    super(message);
  }
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function post<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: json(body) });
  } catch {
    throw new Friendly("Can't reach the relayer. Check your connection and try again.", "NETWORK");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Friendly(friendlyText(data.error || `The relayer answered ${r.status}.`), data.code || String(r.status));
  return data as T;
}

export const relay = (target: Address, fn: string, args: readonly unknown[]) =>
  post<{ hash: Hex; explorer: string }>("/api/relay", { target, fn, args });

export const faucet = (address: Address) => post<{ hash: Hex; explorer: string; amount: string }>("/api/faucet", { address });

/** Contract error names → sentences, for anything that reaches us unexplained. */
const ERRORS: Record<string, string> = {
  TooLate: "Too late: bidding for this round has ended.",
  TooEarly: "Too early: bidding is still open for this round.",
  AlreadyPaid: "You've already paid this round.",
  NotEligible: "Only members who paid this round and haven't taken a pot yet can bid.",
  BidNotHigher: "Your bid must be higher than the best bid so far.",
  DiscountTooHigh: "That discount is above this circle's limit.",
  NoQuorum: "Not enough members have approved the release yet.",
  SignatureExpired: "That signature expired. Please sign again.",
  JoinWindowClosed: "Joining has closed for this circle.",
  JoinWindowOpen: "The circle can only be cancelled after its joining deadline.",
  CircleFull: "This circle is already full.",
  AlreadyMember: "You're already in this circle.",
  AlreadyApproved: "You've already approved this release.",
  NothingToWithdraw: "There's nothing to pay out right now.",
  BadSignature: "The signature didn't match. Please sign again.",
  NotStalled: "The circle isn't stalled, so it can't be dissolved.",
  BadName: "Names must be 1 to 32 characters.",
};

export function friendlyText(msg: string) {
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v;
  return msg;
}

/** Any thrown thing → one plain sentence. */
export function explain(e: unknown): string {
  if (e instanceof Friendly) return e.message;
  const err = e as { code?: number; shortMessage?: string; message?: string; details?: string };
  const m = `${err.shortMessage ?? ""} ${err.details ?? ""} ${err.message ?? ""}`;
  if (err.code === 4001 || /user rejected|user denied|rejected the request|cancelled/i.test(m)) return "You cancelled the signature. Nothing was sent.";
  if (/timed? ?out|Timeout/i.test(m)) return "The network is slow to confirm. Check the transaction link; it may still go through.";
  return friendlyText(err.shortMessage || err.message || "Something went wrong.").slice(0, 240);
}
