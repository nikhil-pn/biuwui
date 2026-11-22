// Exercises api/relay.ts and api/faucet.ts in-process against a chain (use a local Aevum fork):
//   anvil --fork-url https://rpc-test.qday.info --hardfork shanghai --port 8555 &
//   AEVUM_RPC=http://127.0.0.1:8555 RELAYER_PRIVATE_KEY=… FAUCET_PRIVATE_KEY=… npx tsx scripts/test-relay.ts
import { loadKeys } from "./lib/keys";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import relay from "../api/relay";
import faucet from "../api/faucet";
import { FACTORY, publicClient } from "./lib/aevum";
import { factoryAbi, circleAbi } from "./lib/abi";
import { actionTypes, joinNonce, nowSec, receiveTypes, tusd8Domain, circleDomain, vrs } from "./lib/sign";

const keys = loadKeys();
const org = privateKeyToAccount(keys.siumei.privateKey);
const kitty = privateKeyToAccount(keys.kitty.privateKey);
let n = 0;
const ok = (c: boolean, m: string) => { n++; if (!c) { console.error(`✗ ${m}`); process.exit(1); } console.log(`✓ ${m}`); };
const str = (x: unknown): unknown => typeof x === "bigint" ? x.toString() : Array.isArray(x) ? x.map(str) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, str(v)])) : x;

async function call(h: typeof relay, payload: unknown, ip = "1.2.3.4") {
  let status = 0; let out: any;
  await h({ method: "POST", body: JSON.stringify(str(payload)), headers: { "x-vercel-forwarded-for": ip } }, {
    status(c) { status = c; return this; }, json(b) { out = b; }, setHeader() {},
  });
  return { status, out };
}

const openTypes = { OpenCircle: [
  { name: "organiser", type: "address" }, { name: "share", type: "uint256" }, { name: "size", type: "uint8" },
  { name: "joinWindow", type: "uint32" }, { name: "roundLength", type: "uint32" }, { name: "graceLength", type: "uint32" },
  { name: "payeeDelay", type: "uint32" }, { name: "maxDiscountBps", type: "uint16" }, { name: "feeBps", type: "uint16" },
  { name: "quorumBps", type: "uint16" }, { name: "securityBps", type: "uint16" }, { name: "name", type: "string" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] } as const;

async function main() {
  const params = { token: "0x456569838f1d43009A91ebA4263147Afd7233483" as Address, share: 10000n, size: 3, joinWindow: 3600, roundLength: 120, graceLength: 900, payeeDelay: 300, maxDiscountBps: 3000, feeBps: 100, quorumBps: 6000, securityBps: 5000, name: "Practice · Relay test" };
  const deadline = nowSec() + 1800n;
  const nonce = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "nonces", args: [org.address] });
  const sig = await org.signTypedData({ domain: { name: "Sovereign Factory", version: "1", chainId: 44005, verifyingContract: FACTORY }, types: openTypes, primaryType: "OpenCircle",
    message: { organiser: org.address, ...params, nonce, deadline } as never });

  let r = await call(relay, { target: FACTORY, fn: "createCircleWithSig", args: [params, org.address, deadline, sig] });
  ok(r.status === 200 && /^0x/.test(r.out.hash), `gasless open circle relayed (${r.out?.hash ?? JSON.stringify(r.out)})`);
  await publicClient.waitForTransactionReceipt({ hash: r.out.hash });
  const list = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "circlesOf", args: [org.address] });
  const circle = list[list.length - 1] as Address;
  ok((await publicClient.readContract({ address: circle, abi: circleAbi, functionName: "organiser" })) === org.address, "signer (not relayer) is the organiser");

  // replay of the same open signature is refused in simulation, costing nothing
  r = await call(relay, { target: FACTORY, fn: "createCircleWithSig", args: [params, org.address, deadline, sig] });
  ok(r.status === 400 && r.out.code === "WOULD_REVERT", `replayed open refused: "${r.out.error}"`);

  // gasless join
  const vb = nowSec() + 1800n;
  const js = await kitty.signTypedData({ domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization",
    message: { from: kitty.address, to: circle, value: 10000n, validAfter: 0n, validBefore: vb, nonce: joinNonce(circle, kitty.address, kitty.address, "Kitty") } });
  r = await call(relay, { target: circle, fn: "joinWithAuthorization", args: [kitty.address, "Kitty", kitty.address, { validAfter: 0n, validBefore: vb, ...vrs(js) }] });
  ok(r.status === 200, "gasless join relayed");
  await publicClient.waitForTransactionReceipt({ hash: r.out.hash });
  ok(await publicClient.readContract({ address: circle, abi: circleAbi, functionName: "isMember", args: [kitty.address] }), "Kitty is a member");

  // rails
  r = await call(relay, { target: circle, fn: "joinWithAuthorization", args: [kitty.address, "Kitty", kitty.address, { validAfter: 0n, validBefore: vb, ...vrs(js) }] });
  ok(r.status === 400 && r.out.error === "You are already in this circle.", `friendly error: "${r.out.error}"`);
  r = await call(relay, { target: "0x456569838f1d43009A91ebA4263147Afd7233483", fn: "closeAuction", args: [] });
  ok(r.status === 400 && r.out.code === "NOT_ALLOWED", "non-circle target refused");
  r = await call(relay, { target: circle, fn: "initialize", args: [] });
  ok(r.status === 400 && r.out.code === "NOT_ALLOWED", "function outside the allow-list refused");
  const far = nowSec() + 86400n;
  const bs = await kitty.signTypedData({ domain: circleDomain(circle), types: actionTypes, primaryType: "Bid", message: { member: kitty.address, round: 1n, discount: 1n, nonce: 0n, deadline: far } });
  r = await call(relay, { target: circle, fn: "bidWithSig", args: [kitty.address, 1n, far, bs] });
  ok(r.status === 400 && r.out.code === "WINDOW_TOO_LONG", "signature valid for a day refused");
  r = await call(relay, { target: circle, fn: "closeAuction", args: [] });
  ok(r.status === 400 && r.out.code === "WOULD_REVERT", `premature close refused in simulation: "${r.out.error}"`);
  for (let i = 0; i < 40; i++) { r = await call(relay, { target: circle, fn: "closeAuction", args: [] }, "9.9.9.9"); }
  ok(r.status === 429 && r.out.code === "RATE_LIMITED", "per-IP rate limit");

  // faucet
  const fresh = privateKeyToAccount(keccak256(toBytes(`fresh-${Date.now()}`)) as Hex);
  r = await call(faucet, { address: fresh.address }, "5.5.5.5");
  ok(r.status === 200, "faucet sends 0.03 tUSD8 to a new address");
  r = await call(faucet, { address: fresh.address }, "5.5.5.5");
  ok(r.status === 429 && r.out.code === "ALREADY_SENT", "faucet refuses the same address twice");
  console.log(`\nall ${n} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
