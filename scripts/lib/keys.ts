// The throwaway testnet keys the scripts and the bot use, from one JSON file:
//   { "ops": { "address": "0x…", "privateKey": "0x…" }, "relayer": {…}, "secretary": {…}, "ahming": {…}, "kitty": {…}, "wing": {…}, "siumei": {…} }
// Path: $SOVEREIGN_KEYS, or ~/.config/sovereign/accounts.json. On a local fork, scripts/fork-setup.ts writes one for you.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Address, Hex } from "viem";

export type Keys = Record<string, { address: Address; privateKey: Hex }>;
export const keysPath = () => process.env.SOVEREIGN_KEYS ?? `${homedir()}/.config/sovereign/accounts.json`;
export const loadKeys = (): Keys => JSON.parse(readFileSync(keysPath(), "utf8"));
/** Where the demo and safety-path scripts write their proof JSON (docs/proof by default; use another folder on a fork). */
export const proofDir = () => process.env.PROOF_DIR ?? "docs/proof";
