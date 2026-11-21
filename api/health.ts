// GET /api/health — is the relayer set up and funded? (no secrets returned)
import { formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FACTORY, TUSD8, publicClient, send, type Req, type Res } from "./lib/shared";

const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const addr = (name: string) => {
  const k = process.env[name]?.trim();
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? privateKeyToAccount(k as `0x${string}`).address : null;
};

export default async function handler(_req: Req, res: Res) {
  return send(res, async () => {
    const relayer = addr("RELAYER_PRIVATE_KEY");
    const faucet = addr("FAUCET_PRIVATE_KEY");
    return {
      ok: Boolean(relayer && faucet),
      block: (await publicClient.getBlockNumber()).toString(),
      factory: FACTORY,
      relayer,
      relayerGas: relayer ? formatEther(await publicClient.getBalance({ address: relayer })) : null,
      faucet,
      faucetUsd8: faucet ? formatUnits(await publicClient.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [faucet] }), 6) : null,
    };
  });
}
