// The member's wallet. Two kinds, both of which only ever SIGN (members never send transactions):
//  - a burner key made in this browser ("try without a wallet"), kept in localStorage, test-only;
//  - an injected EIP-1193 wallet (MetaMask, Rabby…), signing with eth_signTypedData_v4.
import { createWalletClient, custom, numberToHex, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { aevum, EXPLORER } from "../lib/chain";

export type Wallet = {
  kind: "burner" | "injected";
  address: Address;
  sign: (td: TypedDataDefinition) => Promise<Hex>;
};

type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown>; on?(e: string, f: (...a: unknown[]) => void): void };
const eth = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;
export const hasInjected = () => Boolean(eth());

const KEY = "biuwui.burner";
const MODE = "biuwui.wallet";

export const AEVUM_PARAMS = {
  chainId: numberToHex(aevum.id), // 0xabe5
  chainName: "QDay Aevum Testnet",
  rpcUrls: ["https://rpc-test.qday.info"],
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  blockExplorerUrls: [EXPLORER],
};

/** Add (or switch to) Aevum in the injected wallet. */
export async function addAevum() {
  const w = eth();
  if (!w) throw new Error("No browser wallet found. Use “Try without a wallet” instead.");
  try {
    await w.request({ method: "wallet_switchEthereumChain", params: [{ chainId: AEVUM_PARAMS.chainId }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4902 || code === -32603 || /unrecognized|not added|unknown chain/i.test(String((e as Error).message))) {
      await w.request({ method: "wallet_addEthereumChain", params: [AEVUM_PARAMS] });
    } else throw e;
  }
}

function burnerWallet(pk: Hex): Wallet {
  const acct = privateKeyToAccount(pk);
  return { kind: "burner", address: acct.address, sign: (td) => acct.signTypedData(td as never) };
}

function injectedWallet(address: Address): Wallet {
  const client = createWalletClient({ account: address, chain: aevum, transport: custom(eth()!) });
  return {
    kind: "injected",
    address,
    sign: async (td) => {
      // MetaMask refuses typed data whose domain chainId differs from the active chain.
      const cur = (await eth()!.request({ method: "eth_chainId" })) as string;
      if (Number(cur) !== aevum.id) await addAevum();
      return client.signTypedData({ account: address, ...(td as object) } as never);
    },
  };
}

/** The wallet from last time, without any prompt. */
export async function restoreWallet(): Promise<Wallet | null> {
  const mode = localStorage.getItem(MODE);
  if (mode === "burner") {
    const pk = localStorage.getItem(KEY) as Hex | null;
    return pk ? burnerWallet(pk) : null;
  }
  if (mode === "injected" && eth()) {
    const accts = (await eth()!.request({ method: "eth_accounts" }).catch(() => [])) as Address[];
    return accts[0] ? injectedWallet(accts[0]) : null;
  }
  return null;
}

export function useBurner(): Wallet {
  let pk = localStorage.getItem(KEY) as Hex | null;
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(KEY, pk);
  }
  localStorage.setItem(MODE, "burner");
  return burnerWallet(pk);
}

export async function connectInjected(): Promise<Wallet> {
  const w = eth();
  if (!w) throw new Error("No browser wallet found. Use “Try without a wallet” instead.");
  const accts = (await w.request({ method: "eth_requestAccounts" })) as Address[];
  if (!accts[0]) throw new Error("The wallet did not share an address.");
  await addAevum().catch(() => {}); // best effort now; we ask again before each signature
  localStorage.setItem(MODE, "injected");
  return injectedWallet(accts[0]);
}

export function onInjectedChange(f: () => void) {
  eth()?.on?.("accountsChanged", f);
}

export const burnerKey = () => localStorage.getItem(KEY) as Hex | null;
export function forgetWallet(resetBurner: boolean) {
  localStorage.removeItem(MODE);
  if (resetBurner) localStorage.removeItem(KEY);
}

/** The name members see on your seat and payee (1–32 bytes). */
export const displayName = () => localStorage.getItem("biuwui.name") || "";
export const setDisplayName = (n: string) => localStorage.setItem("biuwui.name", n.trim());
