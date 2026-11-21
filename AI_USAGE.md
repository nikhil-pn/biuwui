# How AI built Biu Wui

Biu Wui was built by a two-person team working with an AI coding agent, [Claude Code](https://claude.com/claude-code)
(Anthropic), running in a terminal on our own always-on Linux machine and driven from a phone.
**The agent wrote the code, tests, scripts, website, app and docs in this repository** during the challenge's build
window, using the official [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) as the reference for the
chain setup and the gasless payment pattern. The humans chose what to build, set the design and the rules, made every
product decision, reviewed the results, and did the steps only a person can do (signing in, Discord verification,
claiming test tokens, approving anything that could cost money).

This file covers **the workflow**, **the generated work** and **the human contribution**, how the agent acted as a
**security reviewer** and an **autonomous tester**, and where it was wrong.

| | |
| --- | --- |
| Agent | Claude Code, one long-running agent session per working day, plus short sub-agents for research and the web front end |
| Written by the agent | contracts, 48 Foundry tests + a fork test on the real tUSD8, deploy and demo scripts, the relayer and faucet functions, the secretary bot, the site, the app, all docs |
| Written by hand | no code; `tools/check-shanghai.mjs` and the test token mock come from the Aevum Starter Kit (MIT, see `NOTICE.md`); the humans decided, reviewed and approved |
| Commits | every commit in `git log` was made by the agent in small steps during the build window; they carry the owner's git name and a `Co-Authored-By` line |
| Verified by | Foundry (unit, fuzz, invariant, fork), real Aevum testnet transactions, a relayer test suite, and headless-browser runs of every user flow |

## 1. The workflow

Every feature went through the same loop:

1. **Brief.** The owner asks for something in plain words, often voice-typed from a phone
   ("make members never need gas", "a demo mode in the app bar", "keep it simple on the phone").
2. **Research before building.** The agent reads the challenge page, QDay's wiki and starter kit, the chain itself
   (`cast`, the explorer API) and the web, and says what it found, with sources, before writing code. Example: before
   choosing a track it counted the public repos already built for each track and checked past hackathon winners per
   theme; before designing gasless actions it confirmed on chain that tUSD8 supports EIP-3009 and EIP-2612, and read
   in the starter kit that no paymaster is offered for this challenge, so spending limits had to live in our contract.
3. **Plan, then small commits.** The agent builds in one-concern commits (a contract function, a test file, a CSS block,
   a doc section) and pushes as it goes.
4. **Prove it on chain.** Nothing counts as done until it has worked on the Aevum testnet: a deploy, a verified
   contract, a full circle, a relayed signature, or a full app flow clicked through in a headless browser.
5. **Look at it.** For anything visual the agent takes screenshots at phone and desktop sizes, reads them, and fixes
   what looks wrong before showing the owner.
6. **Owner review.** The owner tries it on his phone and sends feedback. The agent pushes back when it disagrees and
   otherwise builds what was asked (the owner rejected the first front end; see section 8).
7. **Memory.** At the end of each session the agent writes what it did, what it learned and what is left into its
   notes outside the repository, so the next session starts where the last one ended.

## 2. The generated work

| Area | What the agent produced | Where |
| --- | --- | --- |
| Research | Read the challenge rules, QDay's wiki and starter kit, counted public repos per track (about 80, mostly agent wallets and invoices, none for crowdfunding) and checked past hackathon winners per theme; recommended a bid-for-the-pot savings circle for the Crowdfunding track | team notes (outside the repo); the result is `docs/RULES.md` |
| Contracts | `BiuWuiCircle` (pledge on joining with refunds if the circle does not fill, pay, discount auction, quorum release, payee lock with a change delay, capped standing orders, security held from winners, dissolve and refunds, a signed version of every action), `BiuWuiFactory` (EIP-1167 clones, gasless `createCircleWithSig`) | `src/` |
| Tests | 48 Foundry tests: unit tests per action, signature tampering and replay, fuzz tests, and invariants (money conserved, circle always solvent, nobody wins twice) over random action sequences; a fork test that runs a whole gasless circle against the real tUSD8 | `test/` |
| Chain scripts | Deploy and verify, a full demo circle on the testnet with every transaction recorded, a practice-circle visitor, the relayer test suite | `script/`, `scripts/` |
| The relayer | Serverless functions that submit members' signatures and pay the gas, with an allow-list, simulate-first, one-hour signature windows, rate limits and a daily gas cap; a starter faucet | `api/`, `docs/API.md` |
| The secretary bot | A service that collects standing orders, closes auctions on time, releases pots to locked payees, pays out dividends and refunds, cancels circles that did not fill, and plays two friendly members in practice circles | `bot/secretary.ts` |
| The app and the site | An installable web app with Live and Demo modes, and the How it works, Live, Security and Proof pages, read live from the chain | `web-src/`, `web-app/`, `web/` |
| Docs | README, the rules in plain words, the API and its rails, the on-chain proof with every transaction link, this file | `README.md`, `docs/`, `AI_USAGE.md` |
| Operations | Vercel deploys, the subdomain (it drove the owner's browser to add the DNS record), contract verification, the bot service | — |

## 3. The human contribution

**Nikhil P N** (builder, registered on DoraHacks):

- chose the challenge and the track from the agent's research, and the name Biu Wui (標會, Cantonese for "bidding
  association") because QDay is a Hong Kong team;
- set the bar: a clean wallet-style design from a reference screenshot he sent, app-first, a Live/Demo toggle, short
  pages on the phone;
- made the product calls: members never pay gas, the payee lock, the practice circle with bots;
- tested every version on his phone and sent feedback on what was wrong;
- did what only a person can: signing in, verifying on QDay's Discord and claiming test tokens with `/faucet`, and
  approving anything that could cost money.

**Hina Hanan**: ideas and product direction.

The agent decided the technical details: contract design, the security model, the test strategy, the relayer's rails
and the architecture of the site and the app. The owner reviewed the results rather than the code line by line.

## 4. How the AI's work was checked

- **Foundry:** `make test` runs 48 tests; fuzz and invariant runs check that money is conserved and that the circle
  can always pay what it owes. `make test-fork` runs a whole gasless circle against the real tUSD8 on a fork of Aevum.
- **QDay's own check:** `make build` runs the starter kit's Shanghai opcode check on every build.
- **The chain:** every feature was run for real on Aevum testnet. `docs/PROOF.md` lists the deploys, the verified
  contracts and a full three-member circle (32 transactions) in which the members held no gas token at all.
- **The relayer:** `scripts/test-relay.ts` checks 13 cases against a fork: gasless open and join, replay refused,
  non-circle targets refused, functions outside the allow-list refused, long-lived signatures refused, rate limits,
  and the faucet's once-per-address rule.
- **The app, end to end:** headless-browser scripts click through the app the way a person would, at phone and desktop
  sizes, against the testnet.

## 5. The AI as security reviewer

| Attack | Why it fails | Proof |
| --- | --- | --- |
| The organiser takes the pot | There is no owner, admin, upgrade or withdraw function; the organiser only gets a capped fee | tests, contract |
| A stolen member key redirects the pot | The pot only goes to the payee fixed when the auction closed; a payee change waits a delay, every member sees it, and the member cancels it with one signature | tests; a request-and-cancel on testnet in `docs/PROOF.md` |
| A relayer changes what a member signed (amount, payee, discount, round) | Every detail is inside the signature: the EIP-3009 nonce binds the circle, member, payee and name; EIP-712 messages carry round, amount and a per-member nonce | tests; relayer test suite |
| A signature is replayed, or used in another circle | Per-member nonces, used EIP-3009 nonces, and the circle's address in every message | tests |
| A standing order is abused | It can move exactly one share per round into that circle, at most N times, until it expires; the member can revoke it or zero the allowance | tests |
| A winner stops paying | Part of their pot is held as security and pays their later shares | tests; on testnet in practice circles |
| A round stalls forever | After a grace period anyone dissolves the circle and members get refunds pro rata | tests, invariants |
| Someone burns the relayer's gas | Allow-list, simulate-first (a call that would revert is never sent), short windows, rate limits, daily gas cap; the relayer key holds only gas | `api/relay.ts`, relayer test suite |

## 6. The AI as autonomous tester

The secretary bot (`bot/secretary.ts`) is a test harness that never stops. Around the clock it tends every circle
the factories created, plays two friendly members (Ah Ming and Kitty) in visitors' practice circles, and pays out
what each member is owed when a circle ends. Its transactions are public on the explorer.

## 7. Guardrails

- **Testnet only.** Every key the agent created is a throwaway testnet key kept outside the repository; the relayer
  and the bot hold only gas.
- **Money needs a person.** The agent stops and asks before anything that could cost money. Test tokens came only from
  QDay's own faucet, claimed by the owner.
- **Outward actions need a person.** Registering, posting and account sign-ins happen only when the owner asks.
- **The machine's own safety checks** blocked one action (an automated request to the challenge platform's API), and
  the agent used the owner's normal browser session instead.

## 8. Where the AI was wrong, and how it was caught

| Mistake | Caught by | Fix |
| --- | --- | --- |
| On dissolve, a past winner got their held security back while members who never won took a loss | the agent's own dissolve test asserting refunds | security joins the refund pool for members not yet paid |
| A function with many signature fields failed to compile ("stack too deep") | the compiler | signature fields grouped into small structs |
| The factory, which embedded the circle's code, was over the 24 KB contract limit | `forge build --sizes` | circles are EIP-1167 clones of one implementation |
| With the IR pipeline or low optimizer runs, the compiler places constants after the code, which QDay's opcode check reads as Cancun opcodes | QDay's own `check-shanghai.mjs` | optimizer runs set to 200, no IR pipeline, and the reason written in `foundry.toml` |
| The bot looked stuck in a local test | reading its log | the local fork only mined blocks on transactions, so time stood still; tests now mine a block every second, like Aevum |
| A cleanup command matched its own shell and ended it | the next command's exit code | processes are now stopped by exact name |
| The first front end looked machine-made and put too much on the phone's home page | the owner's review | rebuilt in the reference wallet design, with details on separate pages and a Live/Demo toggle in the app bar |

## 9. What the AI did not do

- It did not decide what Biu Wui is for or who it serves; the team did.
- It did not hold or move real money, and it typed no passwords or codes.
- Biu Wui itself uses no AI at run time: the contracts, the relayer, the bot and the app are deterministic, so nothing
  a model says can move a pot.

## Reproduce

```bash
make build                                   # compile + QDay's Shanghai opcode check
make test                                    # 48 tests (unit, fuzz, invariant)
make test-fork                               # a whole gasless circle on a fork of Aevum with the real tUSD8
npx tsx scripts/demo-circle.ts               # one full circle on the testnet (needs funded test keys)
```
