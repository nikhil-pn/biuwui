# Sovereign

**A savings circle where members bid for the pot, in tUSD8 on QDay Aevum. Members never need gas, the pot can
only go to a named and locked payee, and nobody (not even the organiser) can run away with the money.**

> Built for the QDay **Aevum Builder Challenge #1** (DoraHacks), Crowdfunding track.
> Submission deadline: **11 Dec 2026, 16:00 HKT (08:00 UTC)**. Status: **live on Aevum testnet**: contracts verified, web app + gasless
> relayer at https://app.sovereign.exprmnts.fun, secretary bot running, a full circle on chain in [`docs/PROOF.md`](docs/PROOF.md).

A savings circle is how families and small shops across Asia, Africa and Latin America have saved and borrowed for
generations: everyone pays the same amount each round, and each round one member takes the whole pot. In the bidding
kind (a hui in Hong Kong and Taiwan, a chit fund in India) whoever needs it soonest bids the biggest discount, and the discount is shared by everyone as a
dividend. Sovereign keeps the members sovereign over their own money: no organiser, relayer or bot can take it.

The weak point has always been trust: the organiser holds the cash, a member stops paying after taking the pot,
or the pot goes to the wrong person. Sovereign moves the rules into a contract on Aevum.

**Try it: https://sovereign.exprmnts.fun** (no wallet needed: open a practice circle with two friendly bots and play full
rounds in a few minutes) · app: https://app.sovereign.exprmnts.fun · proof: https://sovereign.exprmnts.fun/proof

## What makes it safe
| Risk | What the contract does |
|---|---|
| The organiser runs off with the pot | There is no owner or admin key. The organiser only gets a capped fee. |
| A winner stops paying | Part of each winner's pot is held as security and pays their later shares. |
| A stolen key redirects the pot | Every pot goes to a **named, locked payee**. A change waits a delay (e.g. 48 h), every member sees it, and it can be cancelled with one signature. |
| The circle never fills | Joining is a **pledge**. If the circle is not full by its deadline, every pledge is refunded. |
| A round stalls | Anyone can dissolve the circle; what is left goes back pro rata. |
| Forgetting to pay | A **standing order**: exactly one share per round, at most N rounds, expires, revocable at any time. |
| Members have no gas token | Every action is a **signature** (EIP-3009, EIP-712, EIP-2612); a relayer submits it. |

Full rules: [`docs/RULES.md`](docs/RULES.md).

## Live on Aevum testnet (chain 44005)
| | |
|---|---|
| SovereignFactory (verified) | [`0x73117fda8e0C804eB3FACbFefCd08cF6164f1f87`](https://explorer-test.qday.info/address/0x73117fda8e0C804eB3FACbFefCd08cF6164f1f87) |
| SovereignCircle implementation (verified) | [`0x918cd9BC72cA8Eb23A57995C2503e3ED8676fDed`](https://explorer-test.qday.info/address/0x918cd9BC72cA8Eb23A57995C2503e3ED8676fDed) |
| A full circle on chain | [all transactions](docs/PROOF.md) |

## Run it
Needs [Foundry](https://book.getfoundry.sh) and Node 22+.

```bash
git clone --recursive https://github.com/nikhil-pn/sovereign && cd sovereign
make build       # compile + check the bytecode is Shanghai-safe (Aevum has no Cancun opcodes)
make test        # unit, fuzz and invariant tests
make test-fork   # a whole gasless circle against the REAL tUSD8 on a local fork of Aevum
```

## Layout
```
src/SovereignCircle.sol     one circle: pledges, rounds, auction, payee lock, standing orders, release, dissolve
src/SovereignFactory.sol    opens circles as EIP-1167 clones of one implementation; isCircle() for the relayer
test/                    unit tests, invariants (test/Invariant.t.sol), fork test on real tUSD8 (test/fork)
docs/RULES.md            the rules in plain words
tools/check-shanghai.mjs opcode check from the Aevum Starter Kit
web/                     the site (sovereign.exprmnts.fun): plain HTML, CSS and JS that read the chain directly
web-src/                 the app's TypeScript, built into web-app/ (app.sovereign.exprmnts.fun) by scripts/build-app.sh
api/                     the gasless relayer and starter faucet, bundled into web-app/api/ by the same script
```

## Credits
Built on ideas and tooling from the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs).
Third-party code and licenses: [`NOTICE.md`](NOTICE.md). License: MIT.
