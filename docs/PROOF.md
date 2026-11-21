# Proof on QDay Aevum testnet (chain 44005)

Everything below can be checked on the explorer. Contract sources are verified there.

## Contracts

| What | Address |
|---|---|
| BiuWuiFactory (verified) | [0xAEcA0Beb9eCEDBe45dBB2fe74524dE31dDf0aa89](https://explorer-test.qday.info/address/0xAEcA0Beb9eCEDBe45dBB2fe74524dE31dDf0aa89) |
| BiuWuiCircle implementation (verified) | [0x1F8E90464604e4fEC47D915525B0e9E61dD6bBDf](https://explorer-test.qday.info/address/0x1F8E90464604e4fEC47D915525B0e9E61dD6bBDf) |
| tUSD8 (QDay's test stablecoin) | [0x456569838f1d43009A91ebA4263147Afd7233483](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |
| Deploy transactions | [implementation](https://explorer-test.qday.info/tx/0xbd721c5b33b687fb7cb4822b021294df47bcb6b2a81cc0422cb55b8df2b066c2) · [factory](https://explorer-test.qday.info/tx/0x9140b539839ad59dac608c5bc3b9839e627d21e61cde5ec65cf264c3b143a5ba) |

## A whole circle, live (2026-11-21 10:01 UTC)

Circle [`0xfFd7334858a51C528E945C9587eFE3b5e0C6a1F2`](https://explorer-test.qday.info/address/0xfFd7334858a51C528E945C9587eFE3b5e0C6a1F2): 3 members (Ah Ming, Kitty, Wing), 0.5 tUSD8 a round, 75-second rounds
for the demo. **The members hold no tQDAY at all: every one of their actions is a signature that our relayer submitted.**
Produced by `npx tsx scripts/demo-circle.ts`.

| # | Step | Transaction |
|---|---|---|
| 1 | Fund Ah Ming with 1.5 tUSD8 | [0x7c253b9f…](https://explorer-test.qday.info/tx/0x7c253b9f91f176757948b34eb5550019b393af80e8d23cf107a71862da7c13b4) |
| 2 | Fund Kitty with 1.5 tUSD8 | [0x8d72063d…](https://explorer-test.qday.info/tx/0x8d72063d24a21203edab79cf56d573f394c762f72a0dafa11f3035c57bc66be4) |
| 3 | Fund Wing with 1.5 tUSD8 | [0xede19753…](https://explorer-test.qday.info/tx/0xede19753c642279f49b31ea99b6b179e026d4a63fe24b49072caf3411b2f9e3c) |
| 4 | Open circle 'Sham Shui Po Biu Wui' (3 members, 0.5 tUSD8 a round) | [0x8bf3803b…](https://explorer-test.qday.info/tx/0x8bf3803b6e3e47afb17e0c018cf41c9c244e647fa4d41f52afb8618f96462004) |
| 5 | Ah Ming joins with a signed pledge (no gas) | [0x3b63b497…](https://explorer-test.qday.info/tx/0x3b63b4976c814344d6c8f6a49c157c27004574a3ea4573c06c9ef95403c5fa51) |
| 6 | Kitty joins with a signed pledge (no gas) | [0x370d6a91…](https://explorer-test.qday.info/tx/0x370d6a91376a782b710b780f7dda47db9e329762e4b5e6ff70b7aee7923405e2) |
| 7 | Wing joins with a signed pledge (no gas) | [0x161ae806…](https://explorer-test.qday.info/tx/0x161ae8060128a0b81b3af0f02fed89bfa8505fe863c5647142942a8bffa68a01) |
| 8 | Wing sets a standing order: 1 share a round, max 2 rounds, expires in 7 days (no gas) | [0xaa80b5b7…](https://explorer-test.qday.info/tx/0xaa80b5b73d1a2ac79b5d128af523a1444bf0db5c189e45b9436c5732ec97c15c) |
| 9 | Round 1: Kitty bids a 0.1 tUSD8 discount (signed, no gas) | [0x6f9db760…](https://explorer-test.qday.info/tx/0x6f9db7600a88e00f6647fb30e8c19330f794195c16fbbfa3306eb68bdf6bdb56) |
| 10 | Round 1: auction closed (anyone can call it) | [0xf3d1c4ea…](https://explorer-test.qday.info/tx/0xf3d1c4eafcd805228001f24e42ff4b454b0bbee5b10816d72e7b18e6c3b24f99) |
| 11 | Round 1: Ah Ming approves the release (signed, no gas) | [0x8ad53d87…](https://explorer-test.qday.info/tx/0x8ad53d874ed89bf61e9237228d76be4bbb9b1ac7f40da7479ce04e89b2677b8c) |
| 12 | Round 1: Wing approves the release (signed, no gas) | [0x40e2d66a…](https://explorer-test.qday.info/tx/0x40e2d66aee74bc404c89ab73f56a6b9277c7a92269ef078eb900ced603a24153) |
| 13 | Round 1: pot released to Kitty's locked payee | [0xed7a1fc2…](https://explorer-test.qday.info/tx/0xed7a1fc219221cc58327b1311099956f4fe02aacf68b06ebeed0f934deea692b) |
| 14 | Round 2: Ah Ming pays a signed share (no gas) | [0x4dc97554…](https://explorer-test.qday.info/tx/0x4dc9755405c6fdfdfbeaa2fe01bcbcdf66323766d16df9e87aa9cf613441b89f) |
| 15 | Round 2: Kitty pays a signed share (no gas) | [0x06721d2d…](https://explorer-test.qday.info/tx/0x06721d2d65fc25ec872c56902e2665ed409cda811f47c6083ddb47e9f55dd99f) |
| 16 | Round 2: standing order collects Wing's share | [0x4f74ae15…](https://explorer-test.qday.info/tx/0x4f74ae15f32cb5d703241873ee27ab870806d02e11b5a7e94b30fa26831fd1c0) |
| 17 | Payee lock: a change of Ah Ming's payout address is requested (waits 120 s, visible to all) | [0x3fe4d418…](https://explorer-test.qday.info/tx/0x3fe4d4185bcbaa707708a88ee4cb0e1dc3adaddc641fe450088795858326ab84) |
| 18 | Payee lock: Ah Ming cancels it with one signature before it takes effect | [0x6266f403…](https://explorer-test.qday.info/tx/0x6266f403becc555e1ff029f4013b760060e5cc5525397f3d1f7b7da8ab3cf32b) |
| 19 | Round 2: auction closed (anyone can call it) | [0x69c0c54a…](https://explorer-test.qday.info/tx/0x69c0c54a8345b95f42ad4bdfea6116b4a0080f62a2e4c59d9b52dbbc6975bc73) |
| 20 | Round 2: Ah Ming approves the release (signed, no gas) | [0x5e00c71c…](https://explorer-test.qday.info/tx/0x5e00c71c60628854f54bbdc73317d2d2b6d9658b9f3643191f4ae648ed7704b1) |
| 21 | Round 2: Kitty approves the release (signed, no gas) | [0x38c67da2…](https://explorer-test.qday.info/tx/0x38c67da261fadeef55b84b448015fc2952d2e5eba6c70b0ee0bceeb91dd91e04) |
| 22 | Round 2: pot released to Ah Ming's locked payee | [0x84009cc5…](https://explorer-test.qday.info/tx/0x84009cc505055ea9ffe037ee2febb17ab76d41bfb1af263fde55dfbb496b6998) |
| 23 | Round 3: Ah Ming pays a signed share (no gas) | [0x3b5521b7…](https://explorer-test.qday.info/tx/0x3b5521b7c0ea814d27bc61d6febda0878d6cb1a7daec3c5fa44bf5248fbed435) |
| 24 | Round 3: Kitty pays a signed share (no gas) | [0xf3d99054…](https://explorer-test.qday.info/tx/0xf3d9905447f31b5cd05167eb4c8878f8eb78cd0b2d9a1b4627e63a5c3c20342c) |
| 25 | Round 3: standing order collects Wing's share | [0x8e0283f7…](https://explorer-test.qday.info/tx/0x8e0283f7b23bdbb6c5b5e864682d6525a7468c5266254a314a30bdf9afa3d83b) |
| 26 | Round 3: auction closed (anyone can call it) | [0x2852b3df…](https://explorer-test.qday.info/tx/0x2852b3df76735a03c4028e75195fcdd9cd4349789a5ce15db4036239088d3338) |
| 27 | Round 3: Ah Ming approves the release (signed, no gas) | [0xe65f55c6…](https://explorer-test.qday.info/tx/0xe65f55c66fe308a940c5ca491c03617388619bdaa5b30245a7f7fd64d022122a) |
| 28 | Round 3: Kitty approves the release (signed, no gas) | [0x33e8bc2e…](https://explorer-test.qday.info/tx/0x33e8bc2e8fd209d3288b22391902bebc771dc5963da9cec4142eeb3d9962257d) |
| 29 | Round 3: pot released to Wing's locked payee | [0xc99eabbe…](https://explorer-test.qday.info/tx/0xc99eabbea4f6d78603ae30dd378412f83a27f20ea4f9ed0683acfa8cc392cf7d) |
| 30 | Pay out Ah Ming's dividend and security (0.528333 tUSD8) | [0xce81dc98…](https://explorer-test.qday.info/tx/0xce81dc98461899dfc711ff18f4d78537aeba93b725c25501e46cf0f487ea4454) |
| 31 | Pay out Kitty's dividend and security (0.728334 tUSD8) | [0x0437ddb3…](https://explorer-test.qday.info/tx/0x0437ddb391b057f75b7b36684a086c6658adca4f0c35787f04e89c359b473e77) |
| 32 | Pay out Wing's dividend and security (0.028333 tUSD8) | [0xe815261d…](https://explorer-test.qday.info/tx/0xe815261db254a1e35d728ab5b55206aed67dd55ea345982e4fb2a7373041464e) |

### Result

| Member | Started with | Ended with | Why |
|---|---|---|---|
| Ah Ming | 1.5 tUSD8 | 1.528333 | never bid; earned dividends from Kitty's discount |
| Kitty | 1.5 tUSD8 | 1.428334 | took the first pot early for a 0.1 discount |
| Wing | 1.5 tUSD8 | 1.528333 | paid by standing order; earned dividends |
| Organiser | | +0.015 | 1% fee, taken out of the discount |

Totals add up to 4.5 tUSD8: no money created or lost. Members' tQDAY balance before and after: **0**.
