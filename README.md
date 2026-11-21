# Biu Wui 標會

**A savings circle where members bid for the pot, in tUSD8 on QDay Aevum. Members never need gas, the pot can
only go to a named and locked payee, and nobody (not even the organiser) can run away with the money.**

> Built for the QDay **Aevum Builder Challenge #1** (DoraHacks), Crowdfunding track.
> Submission deadline: **11 Dec 2026, 16:00 HKT (08:00 UTC)**. Status: **live on Aevum testnet** (contracts verified, a full
> gasless circle run on chain: [`docs/PROOF.md`](docs/PROOF.md)). App, relayer and secretary bot in progress.

A Biu Wui (標會, Cantonese for "bidding association") is how families and small shops in Hong Kong and across Asia
have saved and borrowed for generations: everyone pays the same amount each round, and each round one member takes
the whole pot. Whoever needs it soonest bids the biggest discount; the discount is shared by everyone as a dividend.
It is a hui in Mandarin, a tanomoshi in Japan, a kye in Korea, a chit fund in India.

The weak point has always been trust: the organiser holds the cash, a member stops paying after taking the pot,
or the pot goes to the wrong person. Biu Wui moves the rules into a contract on Aevum.

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
| Factory (verified, gasless open) | [`0xDD39a0B8020C8C18480a068D15Bf18B3e9Ef39EA`](https://explorer-test.qday.info/address/0xDD39a0B8020C8C18480a068D15Bf18B3e9Ef39EA) |
| First factory (verified) | [`0xAEcA0Beb9eCEDBe45dBB2fe74524dE31dDf0aa89`](https://explorer-test.qday.info/address/0xAEcA0Beb9eCEDBe45dBB2fe74524dE31dDf0aa89) |
| Circle implementation (verified) | [`0x1F8E90464604e4fEC47D915525B0e9E61dD6bBDf`](https://explorer-test.qday.info/address/0x1F8E90464604e4fEC47D915525B0e9E61dD6bBDf) |
| First full circle (32 txs, members spent 0 gas) | [`0xfFd7…a1F2`](https://explorer-test.qday.info/address/0xfFd7334858a51C528E945C9587eFE3b5e0C6a1F2) · [all transactions](docs/PROOF.md) |

## Run it
Needs [Foundry](https://book.getfoundry.sh) and Node 22+.

```bash
git clone --recursive https://github.com/nikhil-pn/biuwui && cd biuwui
make build       # compile + check the bytecode is Shanghai-safe (Aevum has no Cancun opcodes)
make test        # unit, fuzz and invariant tests
make test-fork   # a whole gasless circle against the REAL tUSD8 on a local fork of Aevum
```

## Layout
```
src/BiuWuiCircle.sol     one circle: pledges, rounds, auction, payee lock, standing orders, release, dissolve
src/BiuWuiFactory.sol    opens circles as EIP-1167 clones of one implementation; isCircle() for the relayer
test/                    unit tests, invariants (test/Invariant.t.sol), fork test on real tUSD8 (test/fork)
docs/RULES.md            the rules in plain words
tools/check-shanghai.mjs opcode check from the Aevum Starter Kit
```

## Credits
Built on ideas and tooling from the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs).
Third-party code and licenses: [`NOTICE.md`](NOTICE.md). License: MIT.
