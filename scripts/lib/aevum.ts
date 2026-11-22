// Chain config, contracts and clients for QDay Aevum testnet.
// The chain facts match the Aevum Starter Kit (github.com/qday-io/aevum-starter-kit, MIT, PQA Labs).
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployment from "../../deployments/aevum.json" with { type: "json" };

export const aevum = defineChain({
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [process.env.AEVUM_RPC ?? "https://rpc-test.qday.info"] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const TUSD8 = deployment.token as Address;
/** The factory in deployments/aevum.json, or SOVEREIGN_FACTORY (a copy you deployed yourself, e.g. on a local fork). */
export const FACTORY = (process.env.SOVEREIGN_FACTORY || deployment.factory) as Address;
export const DEPLOY_BLOCK = BigInt(deployment.deployBlock);
export const explorerTx = (h: Hex) => `${aevum.blockExplorers.default.url}/tx/${h}`;
export const explorerAddr = (a: Address) => `${aevum.blockExplorers.default.url}/address/${a}`;

export const publicClient = createPublicClient({ chain: aevum, transport: http(undefined, { retryCount: 4 }) });

/** A wallet client that sends legacy (type 0) transactions, as QDay's own faucet and starter kit do. */
export function walletFor(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ account, chain: aevum, transport: http(undefined, { retryCount: 4 }) });
}

export const tusd8Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** eth_getLogs on Aevum is capped at 1,000 blocks: read in chunks from the deploy block. */
export async function getLogsChunked<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, from = DEPLOY_BLOCK) {
  const latest = await publicClient.getBlockNumber();
  const all: T[] = [];
  for (let start = from; start <= latest; start += 1000n) {
    const end = start + 999n > latest ? latest : start + 999n;
    all.push(...(await fetch(start, end)));
  }
  return all;
}
