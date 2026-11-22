# How AI built Sovereign

Sovereign was built by a two-person team working with an AI coding agent, [Claude Code](https://claude.com/claude-code)
(Anthropic), running in a terminal on our own Linux machine and driven from a phone. **The agent wrote the code, tests,
scripts, website, app and docs in this repository** during the challenge's build window, using the official
[Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) as the reference for the chain setup and the gasless
payment pattern. The humans chose what to build, set the design and the rules, made the product decisions, reviewed the
results, and did the steps only a person can do (signing in, Discord verification, claiming test tokens, approving
anything that could cost money).

| | |
| --- | --- |
| Agent | Claude Code, one long session per working day, plus short sub-agents for research and the front end |
| Written by the agent | contracts, 49 Foundry tests + 1 fork test, deploy and demo scripts, the relayer and faucet, the secretary bot, the site, the app, the docs |
| Written by hand | no code; `tools/check-shanghai.mjs` and the test token mock come from the Aevum Starter Kit (MIT, see `NOTICE.md`) |
| Commits | made by the agent in small steps; they carry the owner's git name and a `Co-Authored-By` line |

## 1. The workflow

The owner asks in plain words, often voice-typed ("make members never need gas"). The agent researches first (QDay's
docs, the chain itself; it confirmed on chain that tUSD8 supports EIP-3009 and EIP-2612 before designing gasless actions),
builds in small one-concern commits, proves each feature on the Aevum testnet, screenshots anything visual at phone and
desktop sizes, and then the owner tries it on his phone and sends feedback.

## 2. The generated work

| Area | What | Where |
| --- | --- | --- |
| Contracts | `SovereignCircle` (pledges, auction, quorum release, payee lock, standing orders, security, dissolve, a signed version of every action) and one `SovereignFactory` (EIP-1167 clones, gasless open) | `src/` |
| Tests | 49 tests: unit, signature tampering and replay, fuzz, invariants (money conserved, always solvent, nobody wins twice); 1 fork test on the real tUSD8 | `test/` |
| Scripts | deploy, a full demo circle, the safety-path proofs, a relayer test suite, local fork setup and app server | `script/`, `scripts/` |
| Relayer | allow-list, simulate first, one-hour signature windows, rate limits, daily gas cap; a starter faucet | `api/`, `docs/API.md` |
| Secretary bot | collects standing orders, closes auctions, releases pots, pays out, cancels unfilled circles, plays two bot members in practice circles | `bot/secretary.ts` |
| Site and app | installable app with Live and Demo modes; How it works, Live, Security and Proof pages read from the chain | `web-src/`, `web-app/`, `web/` |

## 3. The human contribution

**Nikhil P N** (builder, registered on DoraHacks) chose the challenge, the track and the name; set the design from a
reference screenshot; made the product calls (no gas for members, the payee lock, practice circles with bots); tested
every version on his phone; and did what only a person can (sign-ins, Discord verification, `/faucet`, approving costs).
**Hina Hanan**: ideas and product direction.

The agent decided the technical details: contract design, security model, tests, the relayer's rails and the front-end
architecture. The owner reviewed results rather than every line of code.

## 4. How the work was checked

- **Foundry:** `make test` runs 49 tests; `make test-fork` runs a whole gasless circle against the real tUSD8 on a fork.
- **QDay's own check:** `make build` runs the starter kit's Shanghai opcode check.
- **The chain:** `docs/PROOF.md` lists a full three-member circle (29 transactions, members held no gas token) and the
  safety paths (34 transactions: unfilled circle refunded, stalled circle dissolved, security paying a missed share,
  standing order revoked, relayer refusing a call that would revert).
- **The relayer:** `scripts/test-relay.ts` runs 13 checks against a fork (replay, wrong target, off-list function, long
  signature window, rate limit, faucet once per address).
- **The app:** headless-browser scripts click through it at phone and desktop sizes.

## 5. The AI as security reviewer

| Attack | Why it fails |
| --- | --- |
| The organiser takes the pot | no owner, admin, upgrade or withdraw function; the fee is capped |
| A stolen key redirects the pot | the payee is fixed at close; a change waits a delay, is visible to all, and one signature cancels it (on chain in `docs/PROOF.md`) |
| The relayer changes what was signed | amount, round, payee and discount are all inside the signature |
| A signature is replayed or reused elsewhere | per-member nonces, used EIP-3009 nonces, the circle's address in every message |
| A standing order is abused | one share per round, at most N rounds, until it expires, revocable |
| A winner stops paying | held security pays their later shares (on chain) |
| A round stalls | anyone dissolves after the grace period; refunds pro rata (on chain) |
| Someone burns the relayer's gas | allow-list, simulate first, short windows, rate limits, daily cap; the key holds only gas |

## 6. The AI as autonomous tester

The secretary bot (`bot/secretary.ts`) never stops: it tends every circle the factory created, plays two friendly
members (Ah Ming and Kitty) in visitors' practice circles, and pays out what each member is owed. Its transactions are
public on the explorer.

## 7. Guardrails

Testnet only: every key is a throwaway testnet key outside the repository, and the relayer and the bot hold only gas.
Anything that costs money or acts outward (sign-ins, posts, registering) waits for a person; test tokens came only from
QDay's faucet.

## 8. Where the AI was wrong

| Mistake | Caught by | Fix |
| --- | --- | --- |
| On dissolve, a past winner got their security back while non-winners took a loss | its own dissolve test | security joins the refund pool |
| "Stack too deep" on functions with many signature fields | the compiler | fields grouped into small structs |
| The factory embedding the circle was over the 24 KB limit | `forge build --sizes` | circles are EIP-1167 clones |
| IR or low optimizer runs placed constants that QDay's check reads as Cancun opcodes | `check-shanghai.mjs` | optimizer runs 200, no IR, reason in `foundry.toml` |
| The first front end looked machine-made | the owner's review | rebuilt in the reference wallet design with a Live/Demo toggle |

## 9. What the AI did not do

It did not decide what Sovereign is for or who it serves, hold or move real money, or type passwords or codes.
Sovereign itself uses no AI at run time: the contracts, relayer, bot and app are deterministic.

## Reproduce

```bash
make build                       # compile + QDay's Shanghai opcode check
make test                        # 49 tests (unit, fuzz, invariant)
make test-fork                   # 1 fork test: a whole gasless circle with the real tUSD8
```
Everything else (a local fork, the app, the bot, the demo circle and the safety paths) is in the README's
[step-by-step reproduction](README.md#reproduce-it-step-by-step).
