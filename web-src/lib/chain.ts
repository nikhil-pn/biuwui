// Chain access for the browser: the same chain config, contracts and ABI the scripts, relayer and bot use.
import { formatUnits, type Address, type Hex } from "viem";
import deployment from "../../deployments/aevum.json" with { type: "json" };
import { circleAbi, factoryAbi } from "../../scripts/lib/abi";
import { aevum, FACTORY, TUSD8, publicClient, tusd8Abi, explorerTx, explorerAddr } from "../../scripts/lib/aevum";

export { aevum, FACTORY, TUSD8, publicClient, tusd8Abi, explorerTx, explorerAddr, circleAbi, factoryAbi };
export const FACTORY_V1 = deployment.factoryV1.address as Address;
export const IMPLEMENTATION = deployment.implementation as Address;
export const FACTORIES: Address[] = [FACTORY, FACTORY_V1];
export const EXPLORER = aevum.blockExplorers.default.url;
export const DEMO_CIRCLE = "0xfFd7334858a51C528E945C9587eFE3b5e0C6a1F2" as Address;
export const DECIMALS = 6;

export const PHASES = ["Forming", "Running", "Completed", "Dissolved", "Cancelled"] as const;

/** 0.01, 1.5, 0.528333: tUSD8 amounts without trailing zeros, at least two decimals. */
export function fmt(v: bigint | undefined | null, min = 2) {
  if (v == null) return "–";
  const s = formatUnits(v, DECIMALS);
  const [i, d = ""] = s.split(".");
  const dec = d.replace(/0+$/, "").padEnd(min, "0");
  return `${Number(i).toLocaleString("en-US")}.${dec}`;
}
export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–");
export const txLink = (h: Hex) => explorerTx(h);
export const addrLink = (a: Address) => explorerAddr(a);

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Every circle from both factories, oldest first, tagged with its factory. */
export async function allCircles() {
  const res = await publicClient.multicall({
    contracts: FACTORIES.map((f) => ({ address: f, abi: factoryAbi, functionName: "circles" }) as const),
    allowFailure: true,
  });
  const out: { circle: Address; factory: Address }[] = [];
  res.forEach((r, i) => {
    if (r.status === "success") for (const c of r.result as readonly Address[]) out.push({ circle: c, factory: FACTORIES[i] });
  });
  return out;
}

/** Blockscout (the Aevum explorer) has a CORS-open API: used for things plain RPC is slow at. */
export async function explorerApi<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${EXPLORER}/api/v2${path}`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}
