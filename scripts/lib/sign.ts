// Builds every message a Biu Wui member signs. Wallets show these as readable EIP-712 data.
import { keccak256, toBytes, type Address, type Hex, encodeAbiParameters, parseSignature } from "viem";
import { aevum, TUSD8 } from "./aevum";

/** tUSD8's EIP-712 domain: name "tUSD8", version "2" (USDC-style). */
export const tusd8Domain = (chainId = aevum.id, token: Address = TUSD8) =>
  ({ name: "tUSD8", version: "2", chainId, verifyingContract: token }) as const;

/** Biu Wui's EIP-712 domain, one per circle. */
export const circleDomain = (circle: Address, chainId = aevum.id) =>
  ({ name: "Biu Wui", version: "1", chainId, verifyingContract: circle }) as const;

export const receiveTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const actionTypes = {
  Bid: [
    { name: "member", type: "address" },
    { name: "round", type: "uint256" },
    { name: "discount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  ApproveRelease: [
    { name: "member", type: "address" },
    { name: "round", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  StandingOrder: [
    { name: "member", type: "address" },
    { name: "maxRounds", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  RevokeStandingOrder: [
    { name: "member", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  ChangePayee: [
    { name: "member", type: "address" },
    { name: "payout", type: "address" },
    { name: "name", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  CancelPayeeChange: [
    { name: "member", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Leave: [
    { name: "member", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Same nonces as BiuWuiCircle.joinNonce / payNonce, computed off-chain (the contract views agree). */
const JOIN_TAG = keccak256(toBytes("BIUWUI-JOIN-V1"));
const PAY_TAG = keccak256(toBytes("BIUWUI-PAY-V1"));
export const joinNonce = (circle: Address, member: Address, payout: Address, name: string) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
      [JOIN_TAG, circle, member, payout, keccak256(toBytes(name))],
    ),
  );
export const payNonce = (circle: Address, member: Address, round: bigint) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [PAY_TAG, circle, member, round],
    ),
  );

/** Split a 65-byte signature into the v/r/s the token functions take. */
export function vrs(sig: Hex) {
  const p = parseSignature(sig);
  return { v: Number(p.v ?? BigInt(27 + (p.yParity ?? 0))), r: p.r, s: p.s };
}

export const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
