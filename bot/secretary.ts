// The circle secretary: keeps every Sovereign circle moving, so members never have to.
//
// Every few seconds (TICK_MS, default 8000), for each circle the factory opened:
//   - collects standing orders that are due (exactly one share, within the member's limits)
//   - closes an auction once its bidding time is over
//   - releases a pot once enough members approved (it always goes to the payee fixed at close)
//   - pays out dividends, security and refunds to members' own payees when a circle ends
//   - cancels circles that did not fill by their deadline, so pledges can be refunded
//   - in practice circles (name starts with "Practice · "), plays two friendly demo members, Ah Ming and Kitty
//
// It holds a gas-only key. Everything it can call is either a member's own signature or a function anyone may
// call, so it cannot move anyone's money anywhere the contract does not already allow.
//
//   npx tsx bot/secretary.ts        (keys from $SOVEREIGN_KEYS or ~/.config/sovereign/accounts.json; systemd unit in bot/sovereign-secretary.service)
import { type Address, type Hex, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleAbi, factoryAbi } from "../scripts/lib/abi";
import { FACTORY, publicClient, walletFor, explorerTx } from "../scripts/lib/aevum";
import { loadKeys } from "../scripts/lib/keys";
import { actionTypes, circleDomain, joinNonce, payNonce, receiveTypes, tusd8Domain, vrs } from "../scripts/lib/sign";

const keys = loadKeys();
const secretary = walletFor(keys.secretary.privateKey as Hex);
const demo = [
  { name: "Ah Ming", acct: privateKeyToAccount(keys.ahming.privateKey as Hex) },
  { name: "Kitty", acct: privateKeyToAccount(keys.kitty.privateKey as Hex) },
];
const FACTORIES = [FACTORY] as Address[];
const TICK_MS = Number(process.env.TICK_MS ?? 8000);
const PRACTICE = "Practice · ";
const Phase = { Forming: 0, Running: 1, Completed: 2, Dissolved: 3, Cancelled: 4 } as const;

const finished = new Set<string>(); // circles with nothing left to do
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

type Round = { start: bigint; bidEnd: bigint; closedAt: bigint; bestBidder: Address; bestDiscount: bigint; collected: bigint; winner: Address; payTo: Address; discount: bigint; approvals: number; closed: boolean; released: boolean };

const read = <T>(c: Address, fn: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: c, abi: circleAbi, functionName: fn as never, args: args as never }) as Promise<T>;

async function tx(label: string, c: Address, fn: string, args: readonly unknown[] = []) {
  try {
    const { request } = await publicClient.simulateContract({ account: secretary.account, address: c, abi: circleAbi, functionName: fn as never, args: args as never });
    const hash = await secretary.writeContract({ ...(request as object), type: "legacy" } as never);
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    log(`${rc.status === "success" ? "✓" : "✗"} ${label}  ${explorerTx(hash)}`);
    return rc.status === "success";
  } catch (e) {
    log(`· skip ${label}: ${(e as Error).message.split("\n")[0].slice(0, 140)}`);
    return false;
  }
}

async function tick() {
  const now = (await publicClient.getBlock()).timestamp;
  for (const f of FACTORIES) {
    const circles = (await publicClient.readContract({ address: f, abi: factoryAbi, functionName: "circles" })) as Address[];
    for (const c of circles) {
      if (finished.has(c)) continue;
      try {
        await tend(c, now);
      } catch (e) {
        log(`! ${c}: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
      }
    }
  }
}

async function tend(c: Address, now: bigint) {
  const [phase, name, size, share, joinBy, members] = await Promise.all([
    read<number>(c, "phase"), read<string>(c, "name"), read<number>(c, "size"), read<bigint>(c, "share"), read<bigint>(c, "joinBy"), read<Address[]>(c, "members"),
  ]);
  const practice = name.startsWith(PRACTICE);

  if (phase === Phase.Forming) {
    if (now > joinBy) return void (await tx(`cancel unfilled "${name}"`, c, "cancelUnfilled"));
    if (practice) {
      for (const d of demo) {
        if (members.length >= size) break;
        if (members.includes(d.acct.address) || !(members.length > 0)) continue; // wait for the visitor to join first
        const validBefore = now + 1800n;
        const sig = await d.acct.signTypedData({
          domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization",
          message: { from: d.acct.address, to: c, value: share, validAfter: 0n, validBefore, nonce: joinNonce(c, d.acct.address, d.acct.address, d.name) },
        });
        if (await tx(`${d.name} joins practice "${name}"`, c, "joinWithAuthorization", [d.acct.address, d.name, d.acct.address, { validAfter: 0n, validBefore, ...vrs(sig) }])) members.push(d.acct.address);
      }
    }
    return;
  }

  if (phase === Phase.Running) {
    const r = await read<bigint>(c, "currentRound");
    const rd = await read<Round>(c, "getRound", [r]);

    if (!rd.closed && now <= rd.bidEnd) {
      // collect due standing orders
      for (const m of members) {
        if (await read<boolean>(c, "canCollect", [m])) await tx(`collect standing order of ${m.slice(0, 8)} (round ${r})`, c, "collect", [m]);
      }
      // demo members pay their share by signature
      if (practice) {
        for (const d of demo) {
          if (!members.includes(d.acct.address) || (await read<boolean>(c, "paid", [r, d.acct.address]))) continue;
          const validBefore = now + 1800n;
          const sig = await d.acct.signTypedData({
            domain: tusd8Domain(), types: receiveTypes, primaryType: "ReceiveWithAuthorization",
            message: { from: d.acct.address, to: c, value: share, validAfter: 0n, validBefore, nonce: payNonce(c, d.acct.address, r) },
          });
          await tx(`${d.name} pays round ${r} of "${name}"`, c, "payWithAuthorization", [d.acct.address, { validAfter: 0n, validBefore, ...vrs(sig) }]);
        }
      }
      return;
    }

    if (!rd.closed) return void (await tx(`close round ${r} of "${name}"`, c, "closeAuction"));

    if (!rd.released) {
      const needed = await read<number>(c, "quorumNeeded");
      if (rd.approvals < needed && practice) {
        for (const d of demo) {
          if (!members.includes(d.acct.address) || (await read<boolean>(c, "approved", [r, d.acct.address]))) continue;
          const deadline = now + 1800n;
          const nonce = await read<bigint>(c, "nonces", [d.acct.address]);
          const sig = await d.acct.signTypedData({ domain: circleDomain(c), types: actionTypes, primaryType: "ApproveRelease", message: { member: d.acct.address, round: r, nonce, deadline } });
          await tx(`${d.name} approves round ${r} of "${name}"`, c, "approveReleaseWithSig", [d.acct.address, deadline, sig]);
        }
      }
      const fresh = await read<Round>(c, "getRound", [r]);
      if (fresh.approvals >= needed) await tx(`release round ${r} of "${name}" to ${fresh.payTo.slice(0, 8)} (${formatUnits(fresh.collected, 6)} tUSD8 pot)`, c, "release");
      else if (await read<boolean>(c, "isStalled")) await tx(`dissolve stalled "${name}"`, c, "dissolve");
    }
    return;
  }

  // Completed, Dissolved or Cancelled: pay everyone what they are owed, to their own payee
  let left = false;
  for (const m of members) {
    if ((await read<bigint>(c, "withdrawable", [m])) > 0n) {
      if (!(await tx(`pay out ${m.slice(0, 8)} from "${name}"`, c, "withdrawFor", [m]))) left = true;
    }
  }
  if (!left) finished.add(c);
}

async function main() {
  log(`secretary ${secretary.account.address}, factories ${FACTORIES.join(", ")}, every ${TICK_MS / 1000}s`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log(`! tick: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
