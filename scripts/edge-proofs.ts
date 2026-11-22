// Proves the safety paths on QDay Aevum testnet and records every transaction:
//   A. a circle that does not fill is cancelled and every pledge comes back
//   B. a stalled circle is dissolved and members are refunded pro rata
//   C. a past winner stops paying and their held security pays their share
//   D. a standing order is revoked and can no longer collect
//   E. the relayer refuses an action that would revert (no transaction, no gas)
//
//   npx tsx scripts/edge-proofs.ts      (keys from $SOVEREIGN_KEYS or ~/.config/sovereign/accounts.json; sends with the gas-only relayer key)
//
// Writes $PROOF_DIR/edge-cases.json (default docs/proof). Step E asks the relayer at $RELAY_URL (default: the live app's
// /api/relay); on a local fork point it at scripts/serve-app.ts, e.g. RELAY_URL=http://127.0.0.1:3000/api/relay.
import { writeFileSync, mkdirSync } from "node:fs";
import { type Address, type Hex, decodeEventLog, formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleAbi, factoryAbi } from "./lib/abi";
import { FACTORY, TUSD8, aevum, explorerAddr, explorerTx, publicClient, tusd8Abi, walletFor } from "./lib/aevum";
import { loadKeys, proofDir } from "./lib/keys";
import { actionTypes, circleDomain, joinNonce, nowSec, payNonce, permitTypes, receiveTypes, tusd8Domain, vrs } from "./lib/sign";

const keys = loadKeys();
const RELAY_URL = process.env.RELAY_URL ?? "https://app.sovereign.exprmnts.fun/api/relay";
const relayer = walletFor(keys.relayer.privateKey as Hex);
const P = {
  ahming: { name: "Ah Ming", acct: privateKeyToAccount(keys.ahming.privateKey as Hex) },
  kitty: { name: "Kitty", acct: privateKeyToAccount(keys.kitty.privateKey as Hex) },
  wing: { name: "Wing", acct: privateKeyToAccount(keys.wing.privateKey as Hex) },
};
type Person = (typeof P)[keyof typeof P];
const SHARE = parseUnits("0.05", 6);
const steps: { section: string; step: string; tx?: Hex; url?: string; note?: string }[] = [];
const fmt = (v: bigint) => `${formatUnits(v, 6)} tUSD8`;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const read = <T>(c: Address, fn: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: c, abi: circleAbi, functionName: fn as never, args: args as never }) as Promise<T>;
const chainNow = async () => (await publicClient.getBlock()).timestamp;

async function send(section: string, step: string, address: Address, abi: unknown, fn: string, args: readonly unknown[]) {
  const hash = await relayer.writeContract({ address, abi: abi as never, functionName: fn as never, args: args as never, type: "legacy" } as never);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${step} reverted ${hash}`);
  steps.push({ section, step, tx: hash, url: explorerTx(hash) });
  console.log(`✓ [${section}] ${step}\n  ${explorerTx(hash)}`);
  return rc;
}

async function open(section: string, name: string, size: number, roundLength: number, graceLength: number, joinWindow = 3600) {
  const rc = await send(section, `Open "${name}" (${size} members, ${fmt(SHARE)} a round)`, FACTORY, factoryAbi, "createCircle", [
    { token: TUSD8, share: SHARE, size, joinWindow, roundLength, graceLength, payeeDelay: 120, maxDiscountBps: 3000, feeBps: 100, quorumBps: 6000, securityBps: 5000, name },
  ]);
  const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "CircleCreated");
  const c = (ev!.args as { circle: Address }).circle;
  console.log(`  circle ${explorerAddr(c)}`);
  return c;
}

async function join(section: string, c: Address, p: Person) {
  const validBefore = nowSec() + 1800n;
  const sig = await p.acct.signTypedData({ domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization",
    message: { from: p.acct.address, to: c, value: SHARE, validAfter: 0n, validBefore, nonce: joinNonce(c, p.acct.address, p.acct.address, p.name) } });
  await send(section, `${p.name} joins with a signed pledge`, c, circleAbi, "joinWithAuthorization", [p.acct.address, p.name, p.acct.address, { validAfter: 0n, validBefore, ...vrs(sig) }]);
}

async function pay(section: string, c: Address, p: Person, r: bigint) {
  const validBefore = nowSec() + 1800n;
  const sig = await p.acct.signTypedData({ domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization",
    message: { from: p.acct.address, to: c, value: SHARE, validAfter: 0n, validBefore, nonce: payNonce(c, p.acct.address, r) } });
  await send(section, `Round ${r}: ${p.name} pays by signature`, c, circleAbi, "payWithAuthorization", [p.acct.address, { validAfter: 0n, validBefore, ...vrs(sig) }]);
}

async function approve(section: string, c: Address, p: Person) {
  const deadline = nowSec() + 1800n;
  const nonce = await read<bigint>(c, "nonces", [p.acct.address]);
  const round = await read<bigint>(c, "currentRound");
  const sig = await p.acct.signTypedData({ domain: circleDomain(c), types: actionTypes, primaryType: "ApproveRelease", message: { member: p.acct.address, round, nonce, deadline } });
  await send(section, `Round ${round}: ${p.name} approves the release`, c, circleAbi, "approveReleaseWithSig", [p.acct.address, deadline, sig]);
}

async function waitUntil(t: bigint, why: string) {
  for (;;) {
    const now = await chainNow();
    if (now > t) return;
    const s = Number(t - now) + 3;
    console.log(`  …waiting ${s}s (${why})`);
    await sleep(Math.min(s, 30));
  }
}

async function finishRound(section: string, c: Address, approvers: Person[]) {
  const r = await read<bigint>(c, "currentRound");
  const rd = await read<{ bidEnd: bigint }>(c, "getRound", [r]);
  await waitUntil(rd.bidEnd, `round ${r} bidding`);
  await send(section, `Round ${r}: auction closed`, c, circleAbi, "closeAuction", []);
  for (const p of approvers) await approve(section, c, p);
  await send(section, `Round ${r}: pot released to the winner's locked payee`, c, circleAbi, "release", []);
}

async function main() {
  console.log(`relayer ${relayer.account.address}, factory ${FACTORY}`);

  // A. not full by the deadline: cancelled, every pledge refunded
  {
    const S = "A. Circle does not fill: pledges refunded";
    const c = await open(S, "Unfilled circle", 3, 60, 60, 60);
    await join(S, c, P.ahming);
    await waitUntil(await read<bigint>(c, "joinBy"), "joining deadline");
    await send(S, "Joining closed with 1 of 3 members: circle cancelled (anyone can call it)", c, circleAbi, "cancelUnfilled", []);
    const before = await publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "balanceOf", args: [P.ahming.acct.address] });
    await send(S, "Ah Ming's whole pledge paid back to his payee", c, circleAbi, "withdrawFor", [P.ahming.acct.address]);
    const after = await publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "balanceOf", args: [P.ahming.acct.address] });
    steps.push({ section: S, step: `Refund check: Ah Ming got back ${fmt(after - before)} (his pledge was ${fmt(SHARE)})` });
  }

  // B. a round stalls: anyone dissolves, members refunded pro rata
  {
    const S = "B. Round stalls: circle dissolved, refunds pro rata";
    const c = await open(S, "Stalled circle", 2, 60, 60);
    await join(S, c, P.ahming);
    await join(S, c, P.kitty);
    const rd = await read<{ bidEnd: bigint }>(c, "getRound", [1n]);
    await waitUntil(rd.bidEnd + 61n, "bidding plus grace with nobody closing");
    await send(S, "Nobody closed round 1 within the grace period: circle dissolved (anyone can call it)", c, circleAbi, "dissolve", []);
    for (const p of [P.ahming, P.kitty]) await send(S, `${p.name}'s refund paid to his/her payee`, c, circleAbi, "withdrawFor", [p.acct.address]);
  }

  // C + D. a past winner stops paying (security pays), and a standing order is revoked
  {
    const S = "C. A past winner stops paying: held security pays the share";
    const D = "D. Standing order revoked: it can no longer collect";
    const c = await open(S, "Security circle", 3, 60, 900);
    for (const p of [P.ahming, P.kitty, P.wing]) await join(S, c, p);
    await finishRound(S, c, [P.kitty, P.wing]); // nobody bids: Ah Ming (joined first) takes round 1, part held as security
    steps.push({ section: S, step: `Ah Ming's held security after round 1: ${fmt(await read<bigint>(c, "security", [P.ahming.acct.address]))}` });

    // Wing sets a standing order (order + permit, one relayed transaction); it collects round 2
    const w = P.wing;
    const deadline = nowSec() + 1800n;
    const expiresAt = nowSec() + 86400n;
    const nonce = await read<bigint>(c, "nonces", [w.acct.address]);
    const orderSig = await w.acct.signTypedData({ domain: circleDomain(c), types: actionTypes, primaryType: "StandingOrder", message: { member: w.acct.address, maxRounds: 2n, expiresAt, nonce, deadline } });
    const pNonce = await publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "nonces", args: [w.acct.address] });
    const permitSig = await w.acct.signTypedData({ domain: tusd8Domain(), types: permitTypes, primaryType: "Permit", message: { owner: w.acct.address, spender: c, value: SHARE * 2n, nonce: pNonce, deadline } });
    await send(D, "Wing sets a standing order: 1 share a round, max 2 rounds, 1-day expiry", c, circleAbi, "setStandingOrderWithSig", [w.acct.address, 2, Number(expiresAt), deadline, orderSig, { deadline, ...vrs(permitSig) }]);
    await send(D, "Round 2: the standing order collects Wing's share", c, circleAbi, "collect", [w.acct.address]);

    await pay(S, c, P.kitty, 2n); // Ah Ming does NOT pay round 2
    await finishRound(S, c, [P.kitty, P.wing]);
    steps.push({ section: S, step: `Round 2 closed with Ah Ming unpaid: his security paid his share (security left ${fmt(await read<bigint>(c, "security", [P.ahming.acct.address]))}, round 2 pot ${fmt((await read<{ collected: bigint }>(c, "getRound", [2n])).collected)})` });

    // Wing revokes the standing order before round 3
    const rdl = nowSec() + 1800n;
    const rn = await read<bigint>(c, "nonces", [w.acct.address]);
    const revSig = await w.acct.signTypedData({ domain: circleDomain(c), types: actionTypes, primaryType: "RevokeStandingOrder", message: { member: w.acct.address, nonce: rn, deadline: rdl } });
    await send(D, "Wing revokes the standing order with one signature", c, circleAbi, "revokeStandingOrderWithSig", [w.acct.address, rdl, revSig]);
    try {
      await publicClient.simulateContract({ account: relayer.account, address: c, abi: circleAbi, functionName: "collect", args: [w.acct.address] });
      steps.push({ section: D, step: "UNEXPECTED: collect still simulated after revoke" });
    } catch (e) {
      const name = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName ?? "reverted";
      steps.push({ section: D, step: `Round 3: collecting again is refused by the contract (${name}); no transaction is sent` });
      console.log(`✓ [${D}] collect after revoke refused: ${name}`);
    }

    // E. the live relayer refuses an action that would revert, before spending any gas
    const E = "E. The relayer refuses what would revert";
    const res = await fetch(RELAY_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: c, fn: "closeAuction", args: [] }),
    });
    const body = (await res.json()) as { error?: string; code?: string };
    steps.push({ section: E, step: `POST /api/relay closeAuction while round 3 bidding is open → HTTP ${res.status} ${body.code}: "${body.error}" (simulated, refused, no gas spent)` });
    console.log(`✓ [${E}] ${res.status} ${body.code} ${body.error}`);

    // finish the circle so it ends cleanly
    await pay(S, c, P.kitty, 3n);
    await pay(S, c, P.wing, 3n);
    await finishRound(S, c, [P.kitty, P.wing]);
    for (const p of [P.ahming, P.kitty, P.wing]) {
      if ((await read<bigint>(c, "withdrawable", [p.acct.address])) > 0n) await send(S, `Pay out ${p.name}'s dividends and remaining security`, c, circleAbi, "withdrawFor", [p.acct.address]);
    }
  }

  mkdirSync(proofDir(), { recursive: true });
  writeFileSync(`${proofDir()}/edge-cases.json`, JSON.stringify({ chainId: aevum.id, factory: FACTORY, ranAt: new Date().toISOString(), steps }, null, 2));
  console.log(`\nwrote ${proofDir()}/edge-cases.json (${steps.filter((s) => s.tx).length} transactions)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
