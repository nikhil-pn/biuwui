/**
 * The member's wallet. Two kinds, and both only ever SIGN: members never send a transaction.
 *  - a test wallet made in this browser (a key kept in localStorage, testnet only);
 *  - a browser wallet (MetaMask, Rabby…) over EIP-1193, signing with eth_signTypedData_v4.
 */
import { createWalletClient, custom, numberToHex, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { aevum } from "../../scripts/lib/aevum";

export type Wallet = {
  kind: "burner" | "injected";
  address: Address;
  sign: (td: TypedDataDefinition) => Promise<Hex>;
};

type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown>; on?(e: string, f: (...a: unknown[]) => void): void };
const eth = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;
export const hasInjected = () => Boolean(eth());

export const AEVUM_PARAMS = {
  chainId: numberToHex(aevum.id), // 0xabe5
  chainName: "QDay Aevum Testnet",
  rpcUrls: ["https://rpc-test.qday.info"],
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  blockExplorerUrls: [aevum.blockExplorers.default.url],
};

/** Add (or switch to) Aevum in the browser wallet. */
export async function addAevum() {
  const w = eth();
  if (!w) throw new Error("No browser wallet found. Make a test wallet instead.");
  try {
    await w.request({ method: "wallet_switchEthereumChain", params: [{ chainId: AEVUM_PARAMS.chainId }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4902 || code === -32603 || /unrecognized|not added|unknown chain/i.test(String((e as Error).message))) {
      await w.request({ method: "wallet_addEthereumChain", params: [AEVUM_PARAMS] });
    } else throw e;
  }
}

export const newKey = () => generatePrivateKey();

export function burner(pk: Hex): Wallet {
  const acct = privateKeyToAccount(pk);
  return { kind: "burner", address: acct.address, sign: (td) => acct.signTypedData(td as never) };
}

function injectedWallet(address: Address): Wallet {
  const client = createWalletClient({ account: address, chain: aevum, transport: custom(eth()!) });
  return {
    kind: "injected",
    address,
    sign: async (td) => {
      // Wallets refuse typed data whose domain chainId differs from the active chain.
      const cur = (await eth()!.request({ method: "eth_chainId" })) as string;
      if (Number(cur) !== aevum.id) await addAevum();
      return client.signTypedData({ account: address, ...(td as object) } as never);
    },
  };
}

/** The browser wallet: silently if it is already connected, or with a prompt when `ask` is set. */
export async function injected(ask: boolean): Promise<Wallet | null> {
  const w = eth();
  if (!w) return null;
  const accts = (await w.request({ method: ask ? "eth_requestAccounts" : "eth_accounts" }).catch((e) => {
    if (ask) throw e;
    return [];
  })) as Address[];
  if (!accts[0]) return null;
  if (ask) await addAevum().catch(() => {}); // best effort now; we ask again before each signature
  return injectedWallet(accts[0]);
}

export function onAccountsChanged(f: () => void) {
  eth()?.on?.("accountsChanged", f);
}
