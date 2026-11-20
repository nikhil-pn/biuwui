# Biu Wui rules, in plain words

A Biu Wui (標會, Cantonese "bidding association") is a savings circle: a group of people who trust each other a
little pay the same amount every round, and each round one of them takes the whole pot. Who takes it is decided
by an auction: members bid the **discount** they accept, the highest discount wins, and the discount is shared
out among everyone as a **dividend**. People who need money early pay for it; patient people earn it. The same
idea is called a hui in Mandarin, a tanomoshi in Japan, a kye in Korea, a chit fund in India.

The contract (`src/BiuWuiCircle.sol`) is the whole rulebook. Nobody, including the organiser and us, can change
the rules of a circle after it opens. There is no owner, no admin key and no upgrade.

## 1. Opening and joining (the pledge)
- An organiser opens a circle with: the share per round, the number of members (2 to 50), how long joining stays
  open, how long each round's bidding lasts, the grace period, the payee-change delay, the highest discount
  allowed (max 40% of the pot), the organiser's fee (max 5% of the pot) and the approval quorum (over 50%).
- **Joining is a pledge.** You pay your first share when you join, and you name your payee: the address and the
  name your pot and refunds go to.
- You can **leave** before the circle is full and get your pledge back.
- If the circle is **not full by the join deadline**, anyone can cancel it, and **every pledge comes back in full**.
- When the last member joins, round 1 starts. Everyone has already paid round 1 (the pledges).

## 2. Every round
1. **Pay** your share before bidding ends: yourself, by a signed message (no gas), or by your standing order.
2. **Bid** the discount you accept (only members who paid this round and have not won yet can bid). A new bid
   must be higher than the best one.
3. **Close**: after bidding ends, anyone closes the auction. The highest bid wins. With no bids, the
   earliest-joined member who has not won yet takes the pot at no discount. Past winners who did not pay are
   covered from the security held back from their own pot.
4. **The payee is fixed at close.** A payee change that matures later cannot touch this pot.
5. **Approve**: more than half of the members (or the circle's quorum) approve the release.
6. **Release**: anyone submits it. The pot goes to the winner's fixed payee, minus:
   - the **discount**: the organiser's fee comes out of it (never more than the discount), the rest is the
     dividend, shared equally by all members;
   - the **security**: part of the winner's pot is held back to cover their future shares, never more than
     they still owe. It is paid back when the circle completes.
7. The next round starts. After the last round the circle is **completed**.

## 3. Standing orders (scoped, capped, expiring, revocable)
- A member can let the circle collect their share each round: **exactly one share, at most once per round, at
  most `maxRounds` times, until `expiresAt`**.
- Anyone can trigger the collection (our secretary bot does), but it can only ever move one share from that
  member into this circle.
- The member can revoke it any time (with a signature, no gas), or set the token allowance to zero.

## 4. Payee lock (confirmation of payee)
- Your payee has a **name** and an **address**. Members see both before they approve a release.
- A change only takes effect after the circle's **payee delay** (e.g. 48 hours). While it waits, everyone sees
  the new name and address, and you can cancel it with one signature. A stolen key cannot quietly redirect a pot.
- Refunds and dividends also go to your payee, never to whoever calls the function.

## 5. Gasless (members never need gas)
Every action has a signed version that anyone (our relayer) can submit:

| Action | What the member signs |
|---|---|
| Join (with pledge) | EIP-3009 `ReceiveWithAuthorization` for exactly one share; its nonce binds this circle, the member, the payee address and the payee name |
| Pay a round | EIP-3009 `ReceiveWithAuthorization`; its nonce binds this circle, the member and the round |
| Standing order | EIP-712 `StandingOrder` + EIP-2612 `permit` for `share x maxRounds` |
| Bid, approve, revoke, change or cancel payee, leave | EIP-712, with a per-member nonce and a deadline |

A relayer cannot change any signed detail (amount, round, payee, discount): the signature would fail. A
signature cannot be replayed (nonces) or used in another circle (the circle's address is in every message).
Smart-account (EIP-1271) signatures are accepted too.

## 6. When things go wrong
- **A round stalls** (bidding over but nobody closed it, or closed but not released, for longer than the grace
  period): anyone can **dissolve** the circle. Everything left, except dividends already earned, goes back in
  proportion to what each member put in minus what each took out. Security held back from past winners joins
  that pool, because it exists to cover what winners still owe.
- **A member stops paying**: if they already won, their held security pays for them. If they have not won, they
  cannot bid, and the earliest-joined paying member wins instead.

## 7. Limits we chose
- At most 50 members, so every per-member loop has bounded gas.
- Discount at most 40% and organiser fee at most 5% of the pot, borrowed from India's Chit Funds Act 1982
  (s.6(3): discount at most 40% of the chit amount; s.21(1)(b): foreman's commission at most 5%, which the 2019
  amendment raises to 7%). We use them as sensible defaults, not as a legal claim for any country.
- Names are 1 to 32 bytes.
