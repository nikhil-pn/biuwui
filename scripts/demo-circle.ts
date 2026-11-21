// Runs one whole Biu Wui circle on QDay Aevum testnet, end to end, and records every transaction.
// Three members (Ah Ming, Kitty, Wing) never spend gas: they only sign. The ops wallet relays.
//
//   npx tsx scripts/demo-circle.ts            (keys come from ~/.config/biuwui/accounts.json)
//
// Proof is written to docs/proof/<circle>.json and printed as explorer links.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { type Address, type Hex, formatUnits, parseUnits, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleAbi, factoryAbi } from "./lib/abi";
import { aevum, FACTORY, TUSD8, publicClient, walletFor, tusd8Abi, explorerTx, explorerAddr } from "./lib/aevum";
import { actionTypes, circleDomain, joinNonce, nowSec, payNonce, permitTypes, receiveTypes, tusd8Domain, vrs } from "./lib/sign";

type Keys = Record<string, { address: Address; privateKey: Hex }>;
const keys: Keys = JSON.parse(readFileSync(`${homedir()}/.config/biuwui/accounts.json`, "utf8"));
const ops = walletFor(keys.ops.privateKey);
const people = [
  { id: "ahming", name: "Ah Ming", acct: privateKeyToAccount(keys.ahming.privateKey) },
  { id: "kitty", name: "Kitty", acct: privateKeyToAccount(keys.kitty.privateKey) },
  { id: "wing", name: "Wing", acct: privateKeyToAccount(keys.wing.privateKey) },
];

const SHARE = parseUnits("0.5", 6); // 0.5 tUSD8
const ROUND = 75; // seconds of bidding per round (short, for a live demo)
const proof: { step: string; tx: Hex; url: string }[] = [];
const fmt = (v: bigint) => `${formatUnits(v, 6)} tUSD8`;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function send(step: string, write: () => Promise<Hex>) {
  const tx = await write();
  const rc = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (rc.status !== "success") throw new Error(`${step} reverted: ${tx}`);
  proof.push({ step, tx, url: explorerTx(tx) });
  console.log(`✓ ${step}\n  ${explorerTx(tx)}`);
  return rc;
}

const relay = (fn: string, args: readonly unknown[], circle: Address) =>
  ops.writeContract({ address: circle, abi: circleAbi, functionName: fn as never, args: args as never, type: "legacy" });

const read = <T>(circle: Address, fn: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: circle, abi: circleAbi, functionName: fn as never, args: args as never }) as Promise<T>;

async function main() {
  console.log(`ops ${ops.account.address}  tQDAY ${formatUnits(await publicClient.getBalance({ address: ops.account.address }), 18)}`);

  // 0. give each member 1.5 tUSD8 (enough for three shares) — the only step that is not gasless for us
  for (const p of people) {
    const bal = await publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "balanceOf", args: [p.acct.address] });
    if (bal < SHARE * 3n) {
      await send(`Fund ${p.name} with ${fmt(SHARE * 3n - bal)}`, () =>
        ops.writeContract({ address: TUSD8, abi: tusd8Abi, functionName: "transfer", args: [p.acct.address, SHARE * 3n - bal], type: "legacy" }),
      );
    }
  }

  // 1. open a circle
  const rc = await send("Open circle 'Sham Shui Po Biu Wui' (3 members, 0.5 tUSD8 a round)", () =>
    ops.writeContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "createCircle",
      type: "legacy",
      args: [
        {
          token: TUSD8,
          share: SHARE,
          size: 3,
          joinWindow: 86400,
          roundLength: ROUND,
          graceLength: 3600,
          payeeDelay: 120,
          maxDiscountBps: 3000,
          feeBps: 100,
          quorumBps: 6000,
          securityBps: 5000,
          name: "Sham Shui Po Biu Wui",
        },
      ],
    }),
  );
  const created = rc.logs
    .map((l) => { try { return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics }); } catch { return null; } })
    .find((e) => e?.eventName === "CircleCreated");
  const circle = (created!.args as { circle: Address }).circle;
  console.log(`circle ${explorerAddr(circle)}`);

  // sanity: our off-chain nonces equal the contract's
  const n0 = await read<Hex>(circle, "joinNonce", [people[0].acct.address, people[0].acct.address, people[0].name]);
  if (n0 !== joinNonce(circle, people[0].acct.address, people[0].acct.address, people[0].name)) throw new Error("joinNonce mismatch");

  // 2. three gasless joins: each member signs an EIP-3009 pledge bound to this circle, their payee and name
  for (const p of people) {
    const validBefore = nowSec() + 3600n;
    const sig = await p.acct.signTypedData({
      domain: tusd8Domain(),
      types: receiveTypes,
      primaryType: "ReceiveWithAuthorization",
      message: { from: p.acct.address, to: circle, value: SHARE, validAfter: 0n, validBefore, nonce: joinNonce(circle, p.acct.address, p.acct.address, p.name) },
    });
    await send(`${p.name} joins with a signed pledge (no gas)`, () =>
      relay("joinWithAuthorization", [p.acct.address, p.name, p.acct.address, { validAfter: 0n, validBefore, ...vrs(sig) }], circle),
    );
  }

  // 3. Wing sets a standing order for 2 rounds: EIP-712 order + EIP-2612 permit, one relayed transaction
  {
    const p = people[2];
    const deadline = nowSec() + 3600n;
    const expiresAt = nowSec() + 7n * 86400n;
    const nonce = await read<bigint>(circle, "nonces", [p.acct.address]);
    const orderSig = await p.acct.signTypedData({
      domain: circleDomain(circle), types: actionTypes, primaryType: "StandingOrder",
      message: { member: p.acct.address, maxRounds: 2n, expiresAt, nonce, deadline },
    });
    const pNonce = await publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "nonces", args: [p.acct.address] });
    const permitSig = await p.acct.signTypedData({
      domain: tusd8Domain(), types: permitTypes, primaryType: "Permit",
      message: { owner: p.acct.address, spender: circle, value: SHARE * 2n, nonce: pNonce, deadline },
    });
    await send("Wing sets a standing order: 1 share a round, max 2 rounds, expires in 7 days (no gas)", () =>
      relay("setStandingOrderWithSig", [p.acct.address, 2, Number(expiresAt), deadline, orderSig, { deadline, ...vrs(permitSig) }], circle),
    );
  }

  const signAction = async (p: (typeof people)[number], primaryType: "Bid" | "ApproveRelease", extra: Record<string, bigint>) => {
    const deadline = nowSec() + 3600n;
    const nonce = await read<bigint>(circle, "nonces", [p.acct.address]);
    const round = await read<bigint>(circle, "currentRound");
    const sig = await p.acct.signTypedData({
      domain: circleDomain(circle), types: actionTypes, primaryType,
      message: { member: p.acct.address, round, nonce, deadline, ...extra } as never,
    });
    return { deadline, sig };
  };

  const finishRound = async (r: number, approvers: number[]) => {
    const rd = await read<{ bidEnd: bigint }>(circle, "getRound", [BigInt(r)]);
    const wait = Number(rd.bidEnd - nowSec()) + 8;
    if (wait > 0) { console.log(`  …waiting ${wait}s for round ${r} bidding to end`); await sleep(wait); }
    await send(`Round ${r}: auction closed (anyone can call it)`, () => relay("closeAuction", [], circle));
    const closed = await read<{ winner: Address; payTo: Address; discount: bigint }>(circle, "getRound", [BigInt(r)]);
    const w = people.find((p) => p.acct.address === closed.winner)!;
    console.log(`  winner ${w.name}, discount ${fmt(closed.discount)}, pays to locked payee ${closed.payTo}`);
    for (const i of approvers) {
      const { deadline, sig } = await signAction(people[i], "ApproveRelease", {});
      await send(`Round ${r}: ${people[i].name} approves the release (signed, no gas)`, () =>
        relay("approveReleaseWithSig", [people[i].acct.address, deadline, sig], circle),
      );
    }
    await send(`Round ${r}: pot released to ${w.name}'s locked payee`, () => relay("release", [], circle));
  };

  // 4. Round 1: Kitty needs money now and bids a 0.1 tUSD8 discount
  {
    const { deadline, sig } = await signAction(people[1], "Bid", { discount: parseUnits("0.1", 6) });
    await send("Round 1: Kitty bids a 0.1 tUSD8 discount (signed, no gas)", () =>
      relay("bidWithSig", [people[1].acct.address, parseUnits("0.1", 6), deadline, sig], circle),
    );
    await finishRound(1, [0, 2]);
  }

  // 5. Round 2: Ah Ming and Kitty pay by signature; Wing's standing order is collected by the relayer
  for (const r of [2, 3]) {
    for (const i of [0, 1]) {
      const p = people[i];
      const validBefore = nowSec() + 3600n;
      const sig = await p.acct.signTypedData({
        domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization",
        message: { from: p.acct.address, to: circle, value: SHARE, validAfter: 0n, validBefore, nonce: payNonce(circle, p.acct.address, BigInt(r)) },
      });
      await send(`Round ${r}: ${p.name} pays a signed share (no gas)`, () =>
        relay("payWithAuthorization", [p.acct.address, { validAfter: 0n, validBefore, ...vrs(sig) }], circle),
      );
    }
    await send(`Round ${r}: standing order collects Wing's share`, () => relay("collect", [people[2].acct.address], circle));

    if (r === 2) {
      // payee lock demo: a change to a new address is requested, visible to all, then cancelled in time
      const p = people[0];
      const thief = "0x000000000000000000000000000000000000dEaD" as Address;
      let deadline = nowSec() + 3600n;
      let nonce = await read<bigint>(circle, "nonces", [p.acct.address]);
      let sig = await p.acct.signTypedData({
        domain: circleDomain(circle), types: actionTypes, primaryType: "ChangePayee",
        message: { member: p.acct.address, payout: thief, name: "Ah Ming", nonce, deadline },
      });
      await send("Payee lock: a change of Ah Ming's payout address is requested (waits 120 s, visible to all)", () =>
        relay("requestPayeeChangeWithSig", [p.acct.address, thief, "Ah Ming", deadline, sig], circle),
      );
      deadline = nowSec() + 3600n;
      nonce = await read<bigint>(circle, "nonces", [p.acct.address]);
      sig = await p.acct.signTypedData({
        domain: circleDomain(circle), types: actionTypes, primaryType: "CancelPayeeChange",
        message: { member: p.acct.address, nonce, deadline },
      });
      await send("Payee lock: Ah Ming cancels it with one signature before it takes effect", () =>
        relay("cancelPayeeChangeWithSig", [p.acct.address, deadline, sig], circle),
      );
    }
    await finishRound(r, [0, 1]);
  }

  // 6. completed: pay out dividends and held security to each member's payee (anyone can trigger it)
  for (const p of people) {
    const owed = await read<bigint>(circle, "withdrawable", [p.acct.address]);
    if (owed > 0n) await send(`Pay out ${p.name}'s dividend and security (${fmt(owed)})`, () => relay("withdrawFor", [p.acct.address], circle));
  }
  console.log(`phase ${await read<number>(circle, "phase")} (2 = Completed)`);
  for (const p of people) {
    const bal = await publicClient.readContract({ address: TUSD8, abi: tusd8Abi, functionName: "balanceOf", args: [p.acct.address] });
    console.log(`${p.name}: ${fmt(bal)}, tQDAY (gas) balance ${formatUnits(await publicClient.getBalance({ address: p.acct.address }), 18)}`);
  }

  mkdirSync("docs/proof", { recursive: true });
  writeFileSync(`docs/proof/${circle}.json`, JSON.stringify({ chainId: aevum.id, circle, ranAt: new Date().toISOString(), steps: proof }, null, 2));
  console.log(`\nproof: docs/proof/${circle}.json (${proof.length} transactions)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
