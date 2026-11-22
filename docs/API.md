# Sovereign HTTP API (gasless relayer + starter faucet)

Both run as serverless functions next to the web app (`/api/*` on the same origin). Members never send
transactions: they sign in their wallet, the app posts the signature here, and the relayer pays the gas.

All numbers that are `uint256` on chain are sent as **decimal strings**. All responses are JSON.
Errors are `{ "error": "<plain-language message for the user>", "code": "<SHORT_CODE>" }` with HTTP 4xx/5xx.

## `POST /api/relay`

Submit one signed action. The relayer only ever calls the functions below, only on the Sovereign factory or on a
circle that `factory.isCircle(circle)` confirms, and simulates every call before sending it.

```json
{ "target": "0x<circle or factory>", "fn": "<function name>", "args": [ ... ] }
```

Response `200`: `{ "hash": "0x…", "explorer": "https://explorer-test.qday.info/tx/0x…" }` (sent, not yet mined;
poll the chain for the receipt). The app should then wait for the receipt with viem `waitForTransactionReceipt`.

Example: a bid. The member signs EIP-712 `Bid { member, round, discount, nonce, deadline }` in the circle's domain, and the
app posts it. Numbers are decimal strings (here a 0.1 tUSD8 discount). The signature below is an obviously fake
placeholder: with a real circle and member filled in, the relayer refuses it in simulation (`400 WOULD_REVERT`, "The
signature does not match. Please sign again.") and nothing is sent.

```bash
curl -s -X POST https://app.sovereign.exprmnts.fun/api/relay \
  -H 'content-type: application/json' \
  -d '{
    "target": "0x<circle address>",
    "fn": "bidWithSig",
    "args": ["0x<member address>", "100000", "<deadline: unix seconds, at most 1 hour ahead>",
             "0x111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222221b"]
  }'
```

An action anyone may call needs no signature. Asking to close an auction while bidding is still open is refused before
anything is sent:

```bash
curl -s -X POST https://app.sovereign.exprmnts.fun/api/relay -H 'content-type: application/json' \
  -d '{"target":"0x<circle address>","fn":"closeAuction","args":[]}'
# 400 {"error":"Bidding is still open for this round.","code":"WOULD_REVERT"}
```

Error codes from `/api/relay` (the `error` text is written for the member and shown as is by the app):

| HTTP | `code` | When |
|---|---|---|
| 400 | `NOT_ALLOWED` | `fn` is not on the allow-list, or `target` is not the factory or a circle it created |
| 400 | `BAD_JSON`, `BAD_ARGS`, `BAD_ADDRESS` | the body is not JSON, or an argument has the wrong count, type or format |
| 400 | `WINDOW_TOO_LONG` | a signature's `deadline` or `validBefore` is more than 1 hour ahead |
| 400 | `WOULD_REVERT` | the simulation reverted; `error` is the contract's reason in plain words |
| 405 | `METHOD` | not a POST |
| 429 | `RATE_LIMITED` | over 30 calls per IP in 10 minutes, or 60 per member per day |
| 503 | `LOW_GAS` | the relayer holds under 0.002 tQDAY |
| 503 | `DAILY_CAP` | the relayer reached `RELAY_DAILY_GAS_CAP_WEI` for the day (UTC) |
| 503 | `NOT_CONFIGURED` | `RELAYER_PRIVATE_KEY` is missing or is a public test key |
| 500 | `INTERNAL` | anything unexpected (logged on the server) |

| `fn` | `target` | `args` (in order) | Signed by the member |
|---|---|---|---|
| `createCircleWithSig` | factory | `[params, organiser, deadline, sig]` | EIP-712 `OpenCircle` (factory domain `"Sovereign Factory"`, `"1"`) |
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

`params` for `createCircleWithSig` is the `SovereignCircle.Params` struct as an object:
`{ token, share, size, joinWindow, roundLength, graceLength, payeeDelay, maxDiscountBps, feeBps, quorumBps, securityBps, name }`
(`token` is ignored and forced to tUSD8 by the factory; send the tUSD8 address).

Circle EIP-712 domain: `{ name: "Sovereign", version: "1", chainId: 44005, verifyingContract: <circle> }`.
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

Starter money for people trying the app: `{ "address": "0x…" }` → `200 { "hash", "explorer", "amount": "30000" }`
(`amount` in tUSD8 units, 6 decimals). Sends **0.03 tUSD8** (enough for a practice circle at 0.01 a round). Once per
address, 3 per IP per day, and only if the address holds less than 0.03 tUSD8. Members never need tQDAY (everything is
relayed). The once-per-address list and the per-IP counter live in memory, per instance.

```bash
curl -s -X POST https://app.sovereign.exprmnts.fun/api/faucet -H 'content-type: application/json' \
  -d '{"address":"0x<your new test wallet>"}'
# 200 {"hash":"0x…","explorer":"https://explorer-test.qday.info/tx/0x…","amount":"30000"}
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_ADDRESS`, `BAD_JSON` | `address` missing or not an address |
| 400 | `HAS_FUNDS` | the address already holds 0.03 tUSD8 or more |
| 429 | `ALREADY_SENT` | this address already got its starter tUSD8 |
| 429 | `RATE_LIMITED` | 3 requests from this IP today |
| 503 | `EMPTY` | the faucet holds under 0.03 tUSD8 (QDay's Discord `/faucet` gives 5 tUSD8) |
| 503 | `NOT_CONFIGURED` | `FAUCET_PRIVATE_KEY` is missing or is a public test key |

The app turns every faucet error into a plain sentence that points to QDay's Discord faucet.

## `GET /api/health`

Is the service set up and funded? Returns no secrets, only addresses derived from the keys.

```bash
curl -s https://app.sovereign.exprmnts.fun/api/health
```

```json
{
  "ok": true,
  "block": "3864358",
  "factory": "0xc81C215C64A5145067f56DD461Cb058f05A7c898",
  "relayer": "0x…",
  "relayerGas": "0.4182",
  "faucet": "0x…",
  "faucetUsd8": "4.2"
}
```

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | `true` when both `RELAYER_PRIVATE_KEY` and `FAUCET_PRIVATE_KEY` are set and valid |
| `block` | decimal string | latest Aevum block number the function saw |
| `factory` | address | the factory the relayer accepts (`deployments/aevum.json`, or `SOVEREIGN_FACTORY`) |
| `relayer` | address or `null` | the relayer's address; `null` if its key is not set |
| `relayerGas` | decimal string or `null` | the relayer's balance **in tQDAY** (not wei), e.g. `"0.4182"` |
| `faucet` | address or `null` | the faucet's address; `null` if its key is not set |
| `faucetUsd8` | decimal string or `null` | the faucet's balance **in tUSD8** (not units), e.g. `"4.2"` |

The example numbers are illustrative. Errors: `500 INTERNAL` if the RPC cannot be read.
