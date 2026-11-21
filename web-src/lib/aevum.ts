/**
 * QDay Aevum testnet plumbing for the browser app: the same chain config, contracts and clients the scripts,
 * relayer and bot use. Reads go straight to the Aevum RPC (it allows browsers); writes only through /api.
 */
import type { Address } from "viem";
import deployment from "../../deployments/aevum.json" with { type: "json" };
import { aevum, FACTORY, publicClient, TUSD8, tusd8Abi } from "../../scripts/lib/aevum";

export const NET = {
  chainId: aevum.id,
  rpc: "https://rpc-test.qday.info",
  explorer: aevum.blockExplorers.default.url,
  /** The current factory (gasless open). New circles open here. */
  factory: FACTORY,
  /** The first factory; its circle stays on chain. */
  factoryV1: ((deployment as { factoryV1?: { address: string } }).factoryV1?.address ?? deployment.factory) as Address,
  implementation: deployment.implementation as Address,
  token: TUSD8,
  decimals: 6,
} as const;

export { aevum, publicClient as pub, tusd8Abi };
