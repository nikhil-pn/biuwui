// Gets a LOCAL fork of Aevum ready for the demo, the safety-path proofs, the bot and the app. Refuses any other RPC.
//
//   anvil --fork-url https://rpc-test.qday.info --hardfork shanghai --block-time 1 &
//   AEVUM_RPC=http://127.0.0.1:8545 SOVEREIGN_KEYS=.fork/accounts.json npx tsx scripts/fork-setup.ts
//
// Writes $SOVEREIGN_KEYS (fresh random keys) if it does not exist, then on the fork only:
//   - gives every key 10 tQDAY for gas (anvil_setBalance);
//   - mints tUSD8 to the keys that need it, by impersonating tUSD8's master minter on the fork (anvil_impersonateAccount).
// Nothing here touches the real testnet: anvil keeps these changes in its own memory.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createWalletClient, http, parseEther, parseUnits, toHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { TUSD8, aevum, publicClient } from "./lib/aevum";
import { keysPath, loadKeys } from "./lib/keys";

const rpc = aevum.rpcUrls.default.http[0];
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(rpc)) {
  console.error(`Refusing: AEVUM_RPC is ${rpc}. This script only runs against a local fork (http://127.0.0.1:<port>).`);
  process.exit(1);
}

const NAMES = ["ops", "relayer", "secretary", "ahming", "kitty", "wing", "siumei"];
const TUSD8_FOR: Record<string, string> = { ops: "5", ahming: "2", kitty: "2", wing: "2", siumei: "2" };

const path = keysPath();
if (!existsSync(path)) {
  const keys = Object.fromEntries(
    NAMES.map((n) => {
      const privateKey = generatePrivateKey();
      return [n, { address: privateKeyToAccount(privateKey).address, privateKey }];
    }),
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(keys, null, 2), { mode: 0o600 });
  console.log(`wrote fresh fork keys to ${path}`);
}
const keys = loadKeys();

const tokenAbi = [
  { type: "function", name: "masterMinter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "configureMinter", stateMutability: "nonpayable", inputs: [{ name: "m", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const anvil = (method: string, params: unknown[]) => publicClient.request({ method: method as never, params: params as never });

async function main() {
  if ((await publicClient.getChainId()) !== aevum.id) throw new Error("This RPC is not a fork of Aevum (chain 44005).");

  for (const n of NAMES) await anvil("anvil_setBalance", [keys[n].address, toHex(parseEther("10"))]);
  console.log("gas: 10 tQDAY for each key");

  const minter = (await publicClient.readContract({ address: TUSD8, abi: tokenAbi, functionName: "masterMinter" })) as Address;
  await anvil("anvil_impersonateAccount", [minter]);
  await anvil("anvil_setBalance", [minter, toHex(parseEther("1"))]);
  const asMinter = createWalletClient({ account: minter, chain: aevum, transport: http() });
  const wait = async (hash: `0x${string}`) => {
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`fork setup transaction reverted: ${hash}`);
  };
  await wait(await asMinter.writeContract({ address: TUSD8, abi: tokenAbi, functionName: "configureMinter", args: [minter, parseUnits("1000000", 6)], type: "legacy" }));
  for (const [n, amount] of Object.entries(TUSD8_FOR)) {
    await wait(await asMinter.writeContract({ address: TUSD8, abi: tokenAbi, functionName: "mint", args: [keys[n].address, parseUnits(amount, 6)], type: "legacy" }));
  }
  await anvil("anvil_stopImpersonatingAccount", [minter]);
  for (const n of NAMES) {
    const bal = (await publicClient.readContract({ address: TUSD8, abi: tokenAbi, functionName: "balanceOf", args: [keys[n].address] })) as bigint;
    console.log(`${n.padEnd(10)} ${keys[n].address}  ${Number(bal) / 1e6} tUSD8`);
  }
  const pick = (n: string) => `$(node -p 'require("${resolve(path)}").${n}.privateKey')`;
  console.log(`\nReady. For the relayer and the faucet (scripts/serve-app.ts), on this fork:
  export RELAYER_PRIVATE_KEY=${pick("relayer")}   # gas only
  export FAUCET_PRIVATE_KEY=${pick("ops")}        # holds the tUSD8 the faucet hands out`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
