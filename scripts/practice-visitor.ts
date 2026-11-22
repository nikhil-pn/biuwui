// Plays a visitor who opens a practice circle and joins it, then leaves everything else to the secretary bot.
//   npx tsx scripts/practice-visitor.ts [roundSeconds]     (uses the "siumei" demo key as the visitor)
import { loadKeys } from "./lib/keys";
import { type Address, type Hex, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { factoryAbi, circleAbi } from "./lib/abi";
import { FACTORY, TUSD8, publicClient, walletFor, explorerAddr } from "./lib/aevum";
import { joinNonce, nowSec, receiveTypes, tusd8Domain, vrs } from "./lib/sign";

const keys = loadKeys();
const visitor = privateKeyToAccount(keys.siumei.privateKey as Hex);
const relayer = walletFor(keys.relayer.privateKey as Hex);
const roundLength = Number(process.argv[2] ?? 120);
const openTypes = { OpenCircle: [
  { name: "organiser", type: "address" }, { name: "share", type: "uint256" }, { name: "size", type: "uint8" },
  { name: "joinWindow", type: "uint32" }, { name: "roundLength", type: "uint32" }, { name: "graceLength", type: "uint32" },
  { name: "payeeDelay", type: "uint32" }, { name: "maxDiscountBps", type: "uint16" }, { name: "feeBps", type: "uint16" },
  { name: "quorumBps", type: "uint16" }, { name: "securityBps", type: "uint16" }, { name: "name", type: "string" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] } as const;

const params = { token: TUSD8, share: 10000n, size: 3, joinWindow: 3600, roundLength, graceLength: 900, payeeDelay: 300, maxDiscountBps: 3000, feeBps: 100, quorumBps: 6000, securityBps: 5000, name: "Practice · Siu Mei" };
const deadline = nowSec() + 1800n;
const nonce = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "nonces", args: [visitor.address] });
const sig = await visitor.signTypedData({ domain: { name: "Sovereign Factory", version: "1", chainId: 44005, verifyingContract: FACTORY }, types: openTypes, primaryType: "OpenCircle", message: { organiser: visitor.address, ...params, nonce, deadline } as never });
const h = await relayer.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "createCircleWithSig", args: [params, visitor.address, deadline, sig], type: "legacy" });
const rc = await publicClient.waitForTransactionReceipt({ hash: h });
const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "CircleCreated");
const circle = (ev!.args as { circle: Address }).circle;
console.log(`practice circle ${explorerAddr(circle)}`);
const vb = nowSec() + 1800n;
const js = await visitor.signTypedData({ domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization", message: { from: visitor.address, to: circle, value: 10000n, validAfter: 0n, validBefore: vb, nonce: joinNonce(circle, visitor.address, visitor.address, "Siu Mei") } });
await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract({ address: circle, abi: circleAbi, functionName: "joinWithAuthorization", args: [visitor.address, "Siu Mei", visitor.address, { validAfter: 0n, validBefore: vb, ...vrs(js) }], type: "legacy" }) });
console.log("visitor joined; the secretary takes it from here");
console.log(circle);
