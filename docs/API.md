# Biu Wui HTTP API (gasless relayer + starter faucet)

Both run as serverless functions next to the web app (`/api/*` on the same origin). Members never send
transactions: they sign in their wallet, the app posts the signature here, and the relayer pays the gas.

All numbers that are `uint256` on chain are sent as **decimal strings**. All responses are JSON.
Errors are `{ "error": "<plain-language message for the user>", "code": "<SHORT_CODE>" }` with HTTP 4xx/5xx.

## `POST /api/relay`

Submit one signed action. The relayer only ever calls the functions below, only on the Biu Wui factory or on a
circle that `factory.isCircle(circle)` confirms, and simulates every call before sending it.

```json
{ "target": "0x<circle or factory>", "fn": "<function name>", "args": [ ... ] }
```

Response `200`: `{ "hash": "0x…", "explorer": "https://explorer-test.qday.info/tx/0x…" }` (sent, not yet mined;
poll the chain for the receipt). The app should then wait for the receipt with viem `waitForTransactionReceipt`.

| `fn` | `target` | `args` (in order) | Signed by the member |
|---|---|---|---|
| `createCircleWithSig` | factory | `[params, organiser, deadline, sig]` | EIP-712 `OpenCircle` (factory domain `"Biu Wui Factory"`, `"1"`) |
| `joinWithAuthorization` | circle | `[member, payeeName, payout, {validAfter, validBefore, v, r, s}]` | EIP-3009 `ReceiveWithAuthorization` on tUSD8, value = share, nonce = `joinNonce(member, payout, payeeName)` |
| `payWithAuthorization` | circle | `[member, {validAfter, validBefore, v, r, s}]` | EIP-3009, value = share, nonce = `payNonce(member, currentRound)` |
| `setStandingOrderWithSig` | circle | `[member, maxRounds, expiresAt, deadline, orderSig, {deadline, v, r, s}]` | EIP-712 `StandingOrder` + EIP-2612 `Permit` (value = share × maxRounds, spender = circle) |
| `revokeStandingOrderWithSig` | circle | `[member, deadline, sig]` | EIP-712 `RevokeStandingOrder` |
| `bidWithSig` | circle | `[member, discount, deadline, sig]` | EIP-712 `Bid` (round = currentRound) |
| `approveReleaseWithSig` | circle | `[member, deadline, sig]` | EIP-712 `ApproveRelease` |
| `requestPayeeChangeWithSig` | circle | `[member, payout, payeeName, deadline, sig]` | EIP-712 `ChangePayee` |
| `cancelPayeeChangeWithSig` | circle | `[member, deadline, sig]` | EIP-712 `CancelPayeeChange` |
| `leaveWithSig` | circle | `[member, deadline, sig]` | EIP-712 `Leave` |
| `closeAuction`, `release`, `cancelUnfilled`, `dissolve` | circle | `[]` | nothing (anyone may call; the rules decide) |
| `collect`, `withdrawFor` | circle | `[member]` | nothing (money only moves along the member's own fixed path) |

`params` for `createCircleWithSig` is the `BiuWuiCircle.Params` struct as an object:
`{ token, share, size, joinWindow, roundLength, graceLength, payeeDelay, maxDiscountBps, feeBps, quorumBps, securityBps, name }`
(`token` is ignored and forced to tUSD8 by the factory; send the tUSD8 address).

Circle EIP-712 domain: `{ name: "Biu Wui", version: "1", chainId: 44005, verifyingContract: <circle> }`.
tUSD8 domain: `{ name: "tUSD8", version: "2", chainId: 44005, verifyingContract: 0x4565…3483 }`.
Type definitions: `scripts/lib/sign.ts` (shared by the app, the relayer and the bot).

### Rails (why the relayer is safe to leave open)
- **Allow-list:** only the functions above, only on the factory or on `isCircle` circles. Anything else: `400 NOT_ALLOWED`.
- **Simulate first:** every call is simulated; a call that would revert is refused with the decoded reason (`400 WOULD_REVERT`) and never costs gas.
- **Short signatures:** EIP-3009 windows (`validBefore - now`) and EIP-712 `deadline`s must be at most 1 hour ahead (`400 WINDOW_TOO_LONG`), so a leaked signature dies fast.
- **Rate limits:** per IP 30 calls / 10 min and per member 60 calls / day; a global daily gas cap. `429 RATE_LIMITED`.
  ⚠️ Limits live in memory per server instance (fine for one instance; use a shared store before real traffic).
- **The relayer key holds only gas (tQDAY), never stablecoins**, and can only reach the paths above, which already
  cannot move a member's money anywhere but into their circle or to their own locked payee.

## `POST /api/faucet`

Starter money for people trying the app: `{ "address": "0x…" }` → `200 { "hash", "explorer", "amount": "30000" }`.
Sends **0.03 tUSD8** (enough for a practice circle at 0.01 a round). Once per address, 3 per IP per day, and only
if the address holds less than 0.03 tUSD8. Members never need tQDAY (everything is relayed).

## `GET /api/health`
`{ "ok": true, "relayer": "0x…", "relayerGas": "<tQDAY wei>", "faucetUsd8": "<tUSD8 units>", "factory": "0x…" }`
