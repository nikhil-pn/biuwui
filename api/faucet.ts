// POST /api/faucet — 0.03 tUSD8 of starter money for people trying Biu Wui (enough for a practice circle).
// Once per address, 3 per IP per day, only if the address holds less than 0.03 tUSD8. See docs/API.md.
import { ApiError, TUSD8, asAddress, body, clientIp, explorerTx, limit, publicClient, send, walletFromEnv, type Req, type Res } from "./lib/shared";

const AMOUNT = 30_000n; // 0.03 tUSD8 (6 decimals)
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const served = new Set<string>();

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST.", code: "METHOD" });
  return send(res, async () => {
    const to = asAddress(body<{ address?: unknown }>(req).address, "address");
    const key = to.toLowerCase();
    if (served.has(key)) throw new ApiError(429, "ALREADY_SENT", "This address already got its starter tUSD8.");
    limit(`faucet-ip:${clientIp(req)}`, 3, 24 * 3600_000);

    const have = await publicClient.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [to] });
    if (have >= AMOUNT) throw new ApiError(400, "HAS_FUNDS", "This address already has enough tUSD8 for a practice circle.");

    const wallet = walletFromEnv("FAUCET_PRIVATE_KEY");
    const left = await publicClient.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [wallet.account.address] });
    if (left < AMOUNT) throw new ApiError(503, "EMPTY", "The starter faucet is empty right now. QDay's Discord faucet (/faucet) gives 5 tUSD8.");

    const { request } = await publicClient.simulateContract({ account: wallet.account, address: TUSD8, abi: erc20, functionName: "transfer", args: [to, AMOUNT] });
    const hash = await wallet.writeContract({ ...request, type: "legacy" } as never);
    served.add(key);
    return { hash, explorer: explorerTx(hash), amount: AMOUNT.toString() };
  });
}
