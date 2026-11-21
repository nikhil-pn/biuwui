// POST /api/relay — submits a member's signed Biu Wui action and pays the gas. See docs/API.md.
//
// Rails (modelled on the Aevum Starter Kit relayer, MIT, PQA Labs):
//  - allow-list of functions; only the factory or circles the factory created (isCircle)
//  - every call is simulated first; a call that would revert is refused and costs nothing
//  - signature windows of at most 1 hour
//  - per-IP and per-member rate limits and a daily gas cap (in memory, per instance)
//  - the relayer key holds only gas; the contract paths it can reach cannot send a member's money anywhere
//    except into their circle or to their own locked payee
import { BaseError, ContractFunctionRevertedError, formatEther, type AbiFunction, type AbiParameter, type Address } from "viem";
import { circleAbi, factoryAbi } from "../scripts/lib/abi";
import { ApiError, FACTORY, asAddress, body, clientIp, explorerTx, limit, publicClient, send, walletFromEnv, type Req, type Res } from "./lib/shared";

const MAX_WINDOW_SEC = 3600n;
const DAILY_GAS_CAP_WEI = BigInt(process.env.RELAY_DAILY_GAS_CAP_WEI ?? "50000000000000000"); // 0.05 tQDAY
const MIN_RELAYER_BALANCE_WEI = 2_000_000_000_000_000n; // 0.002 tQDAY

/** fn → which contract it lives on, and where the member and the time limits sit in its arguments. */
const ALLOWED: Record<string, { on: "factory" | "circle"; member?: number; windows: (args: unknown[]) => bigint[] }> = {
  createCircleWithSig: { on: "factory", member: 1, windows: (a) => [a[2] as bigint] },
  joinWithAuthorization: { on: "circle", member: 0, windows: (a) => [(a[3] as { validBefore: bigint }).validBefore] },
  payWithAuthorization: { on: "circle", member: 0, windows: (a) => [(a[1] as { validBefore: bigint }).validBefore] },
  setStandingOrderWithSig: { on: "circle", member: 0, windows: (a) => [a[3] as bigint, (a[5] as { deadline: bigint }).deadline] },
  revokeStandingOrderWithSig: { on: "circle", member: 0, windows: (a) => [a[1] as bigint] },
  bidWithSig: { on: "circle", member: 0, windows: (a) => [a[2] as bigint] },
  approveReleaseWithSig: { on: "circle", member: 0, windows: (a) => [a[1] as bigint] },
  requestPayeeChangeWithSig: { on: "circle", member: 0, windows: (a) => [a[3] as bigint] },
  cancelPayeeChangeWithSig: { on: "circle", member: 0, windows: (a) => [a[1] as bigint] },
  leaveWithSig: { on: "circle", member: 0, windows: (a) => [a[1] as bigint] },
  closeAuction: { on: "circle", windows: () => [] },
  release: { on: "circle", windows: () => [] },
  cancelUnfilled: { on: "circle", windows: () => [] },
  dissolve: { on: "circle", windows: () => [] },
  collect: { on: "circle", member: 0, windows: () => [] },
  withdrawFor: { on: "circle", member: 0, windows: () => [] },
};

/** Plain-language messages for the contract's custom errors. */
const FRIENDLY: Record<string, string> = {
  AlreadyMember: "You are already in this circle.",
  CircleFull: "This circle is already full.",
  JoinWindowClosed: "Joining has closed for this circle.",
  JoinWindowOpen: "The circle can only be cancelled after its joining deadline.",
  BadName: "Names must be 1 to 32 characters.",
  AlreadyPaid: "You have already paid this round.",
  TooLate: "Bidding for this round has ended.",
  TooEarly: "Bidding is still open for this round.",
  NotEligible: "Only members who paid this round and have not taken a pot yet can bid.",
  DiscountTooHigh: "That discount is above this circle's limit.",
  BidNotHigher: "A bid must be higher than the best bid so far.",
  AlreadyClosed: "This round's auction is already closed.",
  NotClosed: "The auction for this round has not closed yet.",
  AlreadyApproved: "You have already approved this release.",
  AlreadyReleased: "This round's pot has already been released.",
  NoQuorum: "Not enough members have approved the release yet.",
  NotStalled: "The circle is not stalled, so it cannot be dissolved.",
  NothingToWithdraw: "There is nothing to pay out for this member right now.",
  SignatureExpired: "That signature has expired. Please sign again.",
  BadSignature: "The signature does not match. Please sign again.",
  NoStandingOrder: "This member has no active standing order.",
  StandingOrderUsedUp: "This standing order has been used up.",
  StandingOrderExpired: "This standing order has expired.",
  BadStandingOrder: "A standing order needs 1 or more rounds (up to the circle size) and a future expiry.",
  NoPendingPayee: "There is no pending payee change to cancel.",
  NotMember: "That address is not a member of this circle.",
  WrongPhase: "That action is not possible at this stage of the circle.",
  BadParams: "One of the circle settings is out of range.",
  TokenCallFailed: "The tUSD8 transfer failed. Check the balance.",
  ZeroAddress: "An address is missing.",
};

// ------------------------------------------------------------ argument decoding (decimal strings → bigint)

function coerce(param: AbiParameter, value: unknown): unknown {
  const t = param.type;
  if (t === "tuple") {
    const comps = (param as { components: readonly AbiParameter[] }).components;
    if (typeof value !== "object" || value === null) throw new ApiError(400, "BAD_ARGS", `${param.name} must be an object.`);
    const o = value as Record<string, unknown>;
    return Object.fromEntries(comps.map((c) => [c.name!, coerce(c, o[c.name!])]));
  }
  const m = /^u?int(\d*)$/.exec(t);
  if (m) {
    if (typeof value !== "string" && typeof value !== "number") throw new ApiError(400, "BAD_ARGS", `${param.name} must be a number.`);
    let v: bigint;
    try {
      v = BigInt(value);
    } catch {
      throw new ApiError(400, "BAD_ARGS", `${param.name} must be a whole number.`);
    }
    const bits = Number(m[1] || 256);
    return bits <= 48 ? Number(v) : v;
  }
  if (t === "address") return asAddress(value, param.name ?? "address");
  if (t === "bytes" || t === "bytes32") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) throw new ApiError(400, "BAD_ARGS", `${param.name} must be hex.`);
    return value;
  }
  if (t === "string") {
    if (typeof value !== "string") throw new ApiError(400, "BAD_ARGS", `${param.name} must be text.`);
    return value;
  }
  throw new ApiError(400, "BAD_ARGS", `Unsupported argument type ${t}.`);
}

function decodeArgs(abi: readonly unknown[], fn: string, raw: unknown): unknown[] {
  const item = abi.find((x) => (x as AbiFunction).type === "function" && (x as AbiFunction).name === fn) as AbiFunction | undefined;
  if (!item) throw new ApiError(400, "NOT_ALLOWED", "That action is not available.");
  if (!Array.isArray(raw) || raw.length !== item.inputs.length) {
    throw new ApiError(400, "BAD_ARGS", `${fn} takes ${item.inputs.length} arguments.`);
  }
  return item.inputs.map((p, i) => coerce(p, raw[i]));
}

// ------------------------------------------------------------ daily gas cap (in memory, per instance)

let gasDay = "";
let gasSpent = 0n;
function chargeGas(wei: bigint) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== gasDay) {
    gasDay = today;
    gasSpent = 0n;
  }
  if (gasSpent + wei > DAILY_GAS_CAP_WEI) {
    throw new ApiError(503, "DAILY_CAP", "The relayer has reached today's gas budget. Please try again tomorrow.");
  }
  gasSpent += wei;
}

// ------------------------------------------------------------ handler

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST.", code: "METHOD" });
  return send(res, async () => {
    const ip = clientIp(req);
    limit(`ip:${ip}`, 30, 10 * 60_000);

    const { target, fn, args } = body<{ target?: unknown; fn?: unknown; args?: unknown }>(req);
    if (typeof fn !== "string" || !(fn in ALLOWED)) throw new ApiError(400, "NOT_ALLOWED", "That action is not available.");
    const rule = ALLOWED[fn];
    const to = asAddress(target, "target");

    // Only our factory, or circles our factory created.
    if (rule.on === "factory") {
      if (to.toLowerCase() !== FACTORY.toLowerCase()) throw new ApiError(400, "NOT_ALLOWED", "Unknown factory.");
    } else {
      const ok = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCircle", args: [to] });
      if (!ok) throw new ApiError(400, "NOT_ALLOWED", "That is not a Biu Wui circle.");
    }

    const abi = rule.on === "factory" ? factoryAbi : circleAbi;
    const decoded = decodeArgs(abi, fn, args);

    // Short signature windows only.
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const w of rule.windows(decoded)) {
      if (w > now + MAX_WINDOW_SEC) throw new ApiError(400, "WINDOW_TOO_LONG", "Signatures must expire within 1 hour. Please sign again.");
    }
    if (rule.member !== undefined) limit(`member:${(decoded[rule.member] as Address).toLowerCase()}`, 60, 24 * 3600_000);

    const wallet = walletFromEnv("RELAYER_PRIVATE_KEY");
    const balance = await publicClient.getBalance({ address: wallet.account.address });
    if (balance < MIN_RELAYER_BALANCE_WEI) throw new ApiError(503, "LOW_GAS", "The relayer is out of test gas right now. Please try again later.");

    // Simulate first: a call that would revert never costs gas.
    let request;
    try {
      ({ request } = await publicClient.simulateContract({
        account: wallet.account,
        address: to,
        abi: abi as never,
        functionName: fn as never,
        args: decoded as never,
      }));
    } catch (e) {
      if (e instanceof BaseError) {
        const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
        const name = rev?.data?.errorName ?? "";
        if (name) throw new ApiError(400, "WOULD_REVERT", FRIENDLY[name] ?? `The contract refused this (${name}).`);
      }
      throw new ApiError(400, "WOULD_REVERT", "The contract would refuse this action (for example, the tUSD8 signature or balance is not valid).");
    }

    const gas = await publicClient.estimateContractGas(request as never);
    const gasPrice = await publicClient.getGasPrice();
    chargeGas((gas * 12n) / 10n * gasPrice);

    const hash = await wallet.writeContract({ ...(request as object), gas: (gas * 12n) / 10n, type: "legacy" } as never);
    console.log(`relayed ${fn} on ${to}: ${hash} (relayer balance ${formatEther(balance)} tQDAY)`);
    return { hash, explorer: explorerTx(hash) };
  });
}
