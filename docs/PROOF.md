# Proof on QDay Aevum testnet (chain 44005)

Everything below can be checked on the explorer. Contract sources are verified there.

## Contracts

| What | Address |
|---|---|
| SovereignFactory (verified; opens circles as clones, gasless `createCircleWithSig`) | [0x73117fda8e0C804eB3FACbFefCd08cF6164f1f87](https://explorer-test.qday.info/address/0x73117fda8e0C804eB3FACbFefCd08cF6164f1f87) |
| SovereignCircle implementation (verified) | [0x918cd9BC72cA8Eb23A57995C2503e3ED8676fDed](https://explorer-test.qday.info/address/0x918cd9BC72cA8Eb23A57995C2503e3ED8676fDed) |
| tUSD8 (QDay's test stablecoin) | [0x456569838f1d43009A91ebA4263147Afd7233483](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |
| Deploy transactions | [implementation](https://explorer-test.qday.info/tx/0x105279c33c217f56c23a35c6044285cbec546c2488e10205b3e1a31ae4c19c98) · [factory](https://explorer-test.qday.info/tx/0x8635ab70a2859fbd53aabfef7a3e51da34c8feb7145e46fcec5c0024026f75c2) |

## A whole circle, live (2026-11-21 14:36 UTC)

Circle [`0x378Df2b129aD08992884D9f752c85DA3e88012ED`](https://explorer-test.qday.info/address/0x378Df2b129aD08992884D9f752c85DA3e88012ED): 3 members (Ah Ming, Kitty, Wing), 0.25 tUSD8 a round, 75-second rounds
for the demo. **The members hold no tQDAY at all: every one of their actions is a signature that our relayer submitted.**
Produced by `npx tsx scripts/demo-circle.ts`.

| # | Step | Transaction |
|---|---|---|
| 1 | Open circle 'Family Circle' (3 members, 0.25 tUSD8 a round) | [0xcab54eae…](https://explorer-test.qday.info/tx/0xcab54eae1ed19d77ad804d7c97f584911201c224ad74de29797a6096eedbeaad) |
| 2 | Ah Ming joins with a signed pledge (no gas) | [0x37c8bbef…](https://explorer-test.qday.info/tx/0x37c8bbef1137944aa6cb87d495bdf9d03f5fcbf63e0e7b18ddb2249a0002851e) |
| 3 | Kitty joins with a signed pledge (no gas) | [0xa54e6609…](https://explorer-test.qday.info/tx/0xa54e66093011808ebadce7de7cfe958d1a1b4fbd160d059ea6811ef5c2ffc70d) |
| 4 | Wing joins with a signed pledge (no gas) | [0x10c8b084…](https://explorer-test.qday.info/tx/0x10c8b084b55b85e3b70ffcb850c5ae4e41c5acfe97ea30aeec0b9381954a4ef2) |
| 5 | Wing sets a standing order: 1 share a round, max 2 rounds, expires in 7 days (no gas) | [0x6fb2401c…](https://explorer-test.qday.info/tx/0x6fb2401c56e14ec5c92ae5b6072d3802d14c3d729cfefe9bcb7252977dc309f8) |
| 6 | Round 1: Kitty bids a 0.1 tUSD8 discount (signed, no gas) | [0xf9e8c839…](https://explorer-test.qday.info/tx/0xf9e8c83951825c4cd12c2939578421d5dd520a687969caeef7eff1c1f3d71ecc) |
| 7 | Round 1: auction closed (anyone can call it) | [0xf348a7aa…](https://explorer-test.qday.info/tx/0xf348a7aa4d1d636c6b237d623ec667e2274bcbdd8ec792995f737594ca8041e7) |
| 8 | Round 1: Ah Ming approves the release (signed, no gas) | [0xadbe3a6e…](https://explorer-test.qday.info/tx/0xadbe3a6e57dcd240eb9271406ea6e349ca5252765b43e65e824a777a1a0b0645) |
| 9 | Round 1: Wing approves the release (signed, no gas) | [0xfef21bfe…](https://explorer-test.qday.info/tx/0xfef21bfe9e07ee94e98034d4ad7ef67ab8ff35892240b77c3ceb59fc4ef09f52) |
| 10 | Round 1: pot released to Kitty's locked payee | [0x84a5e455…](https://explorer-test.qday.info/tx/0x84a5e4558988f276567dd7212dad14ec725838b546bdb747379c1a13757572e0) |
| 11 | Round 2: Ah Ming pays a signed share (no gas) | [0x8daf8f0e…](https://explorer-test.qday.info/tx/0x8daf8f0e4ff450bec8fac58b919fe290762ab6fb36f20af066324d266b45480c) |
| 12 | Round 2: Kitty pays a signed share (no gas) | [0x32d6dd36…](https://explorer-test.qday.info/tx/0x32d6dd36930fa3c721945f7c3804233d2547b0f0007af68ffdc7d98be09643a8) |
| 13 | Round 2: standing order collects Wing's share | [0x7618bb56…](https://explorer-test.qday.info/tx/0x7618bb563f9b5f2b8699ddb8e63a1f3c24fda9821ec01e93dfae12143a325e2e) |
| 14 | Payee lock: a change of Ah Ming's payout address is requested (waits 120 s, visible to all) | [0x1c3e3b44…](https://explorer-test.qday.info/tx/0x1c3e3b4438399c6ddaad50680838c2eec96812837dd2d2ad174bc130157a774e) |
| 15 | Payee lock: Ah Ming cancels it with one signature before it takes effect | [0x94a02490…](https://explorer-test.qday.info/tx/0x94a02490d981150b71f4b610a19940f6e4c0191243907e6144021cc73ce9b8bf) |
| 16 | Round 2: auction closed (anyone can call it) | [0x18e1ad58…](https://explorer-test.qday.info/tx/0x18e1ad5843b9ed2392d55300a48c9295fd51c6d940f8e93070172b4a46e60750) |
| 17 | Round 2: Ah Ming approves the release (signed, no gas) | [0x4c08a0dc…](https://explorer-test.qday.info/tx/0x4c08a0dc1f98e9936e96d52b376e50bd6b53daba19ef7ce095e07ce993204929) |
| 18 | Round 2: Kitty approves the release (signed, no gas) | [0x23c46937…](https://explorer-test.qday.info/tx/0x23c469373b17185f528ca8cce8ad26bc3e91cd366c676925546d5b884ad762ce) |
| 19 | Round 2: pot released to Ah Ming's locked payee | [0x9b9be5d8…](https://explorer-test.qday.info/tx/0x9b9be5d88d98a56b0b2f94732f93791031f261510030eba6ef8f0914fff67fac) |
| 20 | Round 3: Ah Ming pays a signed share (no gas) | [0xb7b2ed51…](https://explorer-test.qday.info/tx/0xb7b2ed51a114d76a1026430f4900e7f77623fc53985edb8e8f7055d19051dc50) |
| 21 | Round 3: Kitty pays a signed share (no gas) | [0x8d605df1…](https://explorer-test.qday.info/tx/0x8d605df1491772e828773bc0e0ad28c2ac1c2e39fc91d37e90af8c7a2520f5d3) |
| 22 | Round 3: standing order collects Wing's share | [0xb67c4eed…](https://explorer-test.qday.info/tx/0xb67c4eedb61de7d205c08421723cc8a8cfeb12593bdc7b4d4bd45a9505b646d0) |
| 23 | Round 3: auction closed (anyone can call it) | [0xc3ef61e7…](https://explorer-test.qday.info/tx/0xc3ef61e754ac600ab99960c1bac1ce07826f49f76e1e80860694bca7fb68293c) |
| 24 | Round 3: Ah Ming approves the release (signed, no gas) | [0xc7baf680…](https://explorer-test.qday.info/tx/0xc7baf6805589219f53e140b882a79ba3c81f682c962f52e766e801da2d3e5850) |
| 25 | Round 3: Kitty approves the release (signed, no gas) | [0xb8623ceb…](https://explorer-test.qday.info/tx/0xb8623ceb761c8c4fe2e6855e5fcdc391ff4b45f71caa1a65adb77ef8c8975494) |
| 26 | Round 3: pot released to Wing's locked payee | [0x4c8cb9f0…](https://explorer-test.qday.info/tx/0x4c8cb9f07180edfb7ae824841352b35942fb8439b49c908e988456f29c9ae5f2) |
| 27 | Pay out Ah Ming's dividend and security (0.280833 tUSD8) | [0xd640362b…](https://explorer-test.qday.info/tx/0xd640362bd4618579ff15cae0f91855c156aa1c99f1b3fd6b870d01373bec5508) |
| 28 | Pay out Kitty's dividend and security (0.355834 tUSD8) | [0x2cff3c5b…](https://explorer-test.qday.info/tx/0x2cff3c5bbc4d84853826e7775cf6092ea20686bc68a907c054c115fd02ab0f45) |
| 29 | Pay out Wing's dividend and security (0.030833 tUSD8) | [0xf20627ec…](https://explorer-test.qday.info/tx/0xf20627eca4d9a0896b10e093b5704dcadf20ae103ad7c045e8fea5c75b14d8c2) |

### Result

| Member | Change | Why |
|---|---|---|
| Ah Ming | +0.030833 tUSD8 | never bid; earned dividends from Kitty's discount |
| Kitty | −0.069166 tUSD8 | took the first pot early for a 0.1 discount |
| Wing | +0.030833 tUSD8 | paid by standing order; earned dividends |
| Organiser | +0.0075 tUSD8 | 1% fee, taken out of the discount |

The changes add up to zero: no money created or lost. Members' tQDAY balance before and after: **0**.
