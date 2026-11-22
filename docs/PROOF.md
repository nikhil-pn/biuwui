# Proof on QDay Aevum testnet (chain 44005)

Everything below can be checked on the explorer. Contract sources are verified there.

## Contracts

| What | Address |
|---|---|
| SovereignFactory (verified; opens circles as clones, gasless `createCircleWithSig`) | [0xc81C215C64A5145067f56DD461Cb058f05A7c898](https://explorer-test.qday.info/address/0xc81C215C64A5145067f56DD461Cb058f05A7c898) |
| SovereignCircle implementation (verified) | [0x5a2F6Aa2659F196E8AbfA42FF85E8d11F4c83922](https://explorer-test.qday.info/address/0x5a2F6Aa2659F196E8AbfA42FF85E8d11F4c83922) |
| tUSD8 (QDay's test stablecoin) | [0x456569838f1d43009A91ebA4263147Afd7233483](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |
| Deploy transactions | [implementation](https://explorer-test.qday.info/tx/0x6209a41d78c622304331520e06bb259c16d7db2379ef1a19cf9b60f77bbdaf44) · [factory](https://explorer-test.qday.info/tx/0x046cd5161240b79c31665208f304e228fbb3eba617a6479771081a452c884187) |

Circles are EIP-1167 clones, so the explorer's transaction counter on the factory stays low: each circle has its own address and history.

## 1. A whole circle, live (2026-11-22 21:16 UTC)

Circle [`0xa6E05d1b8464ac07A701a4AE899E26D68B6F6831`](https://explorer-test.qday.info/address/0xa6E05d1b8464ac07A701a4AE899E26D68B6F6831): 3 members (Ah Ming, Kitty, Wing), 0.25 tUSD8 a round, 75-second rounds
for the demo. **The members hold no tQDAY at all: every one of their actions is a signature that our relayer submitted.**
Produced by `npx tsx scripts/demo-circle.ts`.

| # | Step | Transaction |
|---|---|---|
| 1 | Open circle 'Family Circle' (3 members, 0.25 tUSD8 a round) | [0x05d0f918…](https://explorer-test.qday.info/tx/0x05d0f9188d35f0ef2227131ac3a9b481ce4f1e5fa73ccb5ffc78ff2e10279099) |
| 2 | Ah Ming joins with a signed pledge (no gas) | [0xceb871df…](https://explorer-test.qday.info/tx/0xceb871df1e5266dc4d415e2a7538617116147aa94ec6d8efb8981c16f6b2e12d) |
| 3 | Kitty joins with a signed pledge (no gas) | [0xbadb69f0…](https://explorer-test.qday.info/tx/0xbadb69f0b7101e77ba26ef5a3b50b3b9cdba3e3cb7c2895e55d821344b80e8bd) |
| 4 | Wing joins with a signed pledge (no gas) | [0x79602afb…](https://explorer-test.qday.info/tx/0x79602afba987fc4f56da2b3513d855e59f10a72f93f5e770218f3eafd68281d9) |
| 5 | Wing sets a standing order: 1 share a round, max 2 rounds, expires in 7 days (no gas) | [0xc4f49328…](https://explorer-test.qday.info/tx/0xc4f49328a630c482991a05a7a03645cf060b6e8760e3f293b05a0222042c913f) |
| 6 | Round 1: Kitty bids a 0.1 tUSD8 discount (signed, no gas) | [0xc2114e56…](https://explorer-test.qday.info/tx/0xc2114e563b5935fc4b9e83be116ec0a353841f05d5948c5cb1b84b55ff088e52) |
| 7 | Round 1: auction closed (anyone can call it) | [0xdf3fb905…](https://explorer-test.qday.info/tx/0xdf3fb90512079c0a9334aa91fbd8626683e64ad8517421a0d83883b4a85a6d06) |
| 8 | Round 1: Ah Ming approves the release (signed, no gas) | [0x04151e12…](https://explorer-test.qday.info/tx/0x04151e12e9af731f6405060e9589580e4e4487ec1182b62386c144b5b1a264e7) |
| 9 | Round 1: Wing approves the release (signed, no gas) | [0xce3c5f38…](https://explorer-test.qday.info/tx/0xce3c5f3860aacc1722235f1294a998feb9beeb2bb6e26eff970118a1de86197a) |
| 10 | Round 1: pot released to Kitty's locked payee | [0x7fb70a67…](https://explorer-test.qday.info/tx/0x7fb70a6722e155ad9b1cbe8449c66fd8dd02e85cad3357458332b71b7ca277fd) |
| 11 | Round 2: Ah Ming pays a signed share (no gas) | [0x1e4c39cb…](https://explorer-test.qday.info/tx/0x1e4c39cb7ddbbba3abd366868aed9adecc1980d6cb75794d349cdc98fc6afe15) |
| 12 | Round 2: Kitty pays a signed share (no gas) | [0xbdab86d7…](https://explorer-test.qday.info/tx/0xbdab86d7333777dfa84a656781ca839edf61adfd9edb61a2813c94727b15ed63) |
| 13 | Round 2: standing order collects Wing's share | [0x7e5d431b…](https://explorer-test.qday.info/tx/0x7e5d431b1e4af28fac45ece2df9e959aedee6289a6f5619d90e38c88a4876ad7) |
| 14 | Payee lock: a change of Ah Ming's payout address is requested (waits 120 s, visible to all) | [0x3710b1c1…](https://explorer-test.qday.info/tx/0x3710b1c1566e6f15a0263ee44ad0527aabedd714e9ea42d6218b98da1ab6d4bd) |
| 15 | Payee lock: Ah Ming cancels it with one signature before it takes effect | [0x638a6619…](https://explorer-test.qday.info/tx/0x638a66194c0fdd686eaa4d2f933c15ba0945548feabfd3a7559b1b836ce30551) |
| 16 | Round 2: auction closed (anyone can call it) | [0x6090b31d…](https://explorer-test.qday.info/tx/0x6090b31d4fac05f45832fa23728a11004d142f8557ded371482daf82b09287e8) |
| 17 | Round 2: Ah Ming approves the release (signed, no gas) | [0x835fbb3e…](https://explorer-test.qday.info/tx/0x835fbb3e999fb74b0a03cff7fd57a10caf55c55698a31a0a5c1d361068fb7a18) |
| 18 | Round 2: Kitty approves the release (signed, no gas) | [0x974d781b…](https://explorer-test.qday.info/tx/0x974d781b9661f5dece36e96b1461a68e09fc9b45f9ecd64bc64404cd93201070) |
| 19 | Round 2: pot released to Ah Ming's locked payee | [0xb6b1b44f…](https://explorer-test.qday.info/tx/0xb6b1b44f70f70efb55105b26f3ee679872818d8e557d3957f5c351f7f01f7942) |
| 20 | Round 3: Ah Ming pays a signed share (no gas) | [0xd754166c…](https://explorer-test.qday.info/tx/0xd754166cf8d4d44234f1aa8eff782ee3188536662437f138d475778a42535d05) |
| 21 | Round 3: Kitty pays a signed share (no gas) | [0x328b376a…](https://explorer-test.qday.info/tx/0x328b376a81d5b593d04166dac68fdd7530928254d578586f12cdd8f4886a7197) |
| 22 | Round 3: standing order collects Wing's share | [0x791b69e5…](https://explorer-test.qday.info/tx/0x791b69e56d98c3487dd80964a0c9c56cc2534becaa6b305fab9f6b50b7cd78cc) |
| 23 | Round 3: auction closed (anyone can call it) | [0xa0a24d74…](https://explorer-test.qday.info/tx/0xa0a24d749fea90bdfd5b84e28b0ba617c718b65dfc17e270013e9a7d5aecbde7) |
| 24 | Round 3: Ah Ming approves the release (signed, no gas) | [0x195aea67…](https://explorer-test.qday.info/tx/0x195aea67594a88c45ed44f61f10de2fc1f57fb10d7650e20d5c226d7a298fe4d) |
| 25 | Round 3: Kitty approves the release (signed, no gas) | [0x0802d534…](https://explorer-test.qday.info/tx/0x0802d534185f19b6f96a9732e2b6bbb1db4dafbef13a27aad3bb1fe55e9cbcc0) |
| 26 | Round 3: pot released to Wing's locked payee | [0xb0f48fb3…](https://explorer-test.qday.info/tx/0xb0f48fb3d21f517618cc2b71d3d740cbed5142b6b6b889c16bea8dc087a12568) |
| 27 | Pay out Ah Ming's dividend and security (0.280833 tUSD8) | [0x9cebd527…](https://explorer-test.qday.info/tx/0x9cebd5278b13ba6c15508dd778ee8575816584817b0e0a7ea514037cb40dee29) |
| 28 | Pay out Kitty's dividend and security (0.355834 tUSD8) | [0x4c65efd0…](https://explorer-test.qday.info/tx/0x4c65efd0f2644a1315ffe0e1ff87cf6d2caf22f398176a0df00c96e9ad8edd9d) |
| 29 | Pay out Wing's dividend and security (0.030833 tUSD8) | [0x5f5cdb16…](https://explorer-test.qday.info/tx/0x5f5cdb166d895bd7eca8af7e4c340988f37335fc0ee25f5ff376fef327b0ec1c) |

| Member | Change | Why |
|---|---|---|
| Ah Ming | +0.030833 tUSD8 | never bid; earned dividends from Kitty's discount |
| Kitty | −0.069166 tUSD8 | took the first pot early for a 0.1 discount |
| Wing | +0.030833 tUSD8 | paid by standing order; earned dividends |
| Organiser | +0.0075 tUSD8 | 1% fee, taken out of the discount |

The changes add up to zero: no money created or lost. Members' tQDAY balance before and after: **0**.

## 2. The safety paths, live (2026-11-22 21:19 UTC)

Produced by `npx tsx scripts/edge-proofs.ts`: three more circles at 0.05 tUSD8 a round, sent by the gas-only relayer key.


### A. Circle does not fill: pledges refunded

| Step | Transaction |
|---|---|
| Open "Unfilled circle" (3 members, 0.05 tUSD8 a round) | [0x0953709b…](https://explorer-test.qday.info/tx/0x0953709bbabe7c1484823ea3582fd45874ce5c86c49556676624513d1f873fec) |
| Ah Ming joins with a signed pledge | [0x429da636…](https://explorer-test.qday.info/tx/0x429da6360313c134390e44000fd2c8039a61267edbd6eba7e6b38c101842366a) |
| Joining closed with 1 of 3 members: circle cancelled (anyone can call it) | [0xc5071cdb…](https://explorer-test.qday.info/tx/0xc5071cdb5625b9a3117b2486157898cd84a17ca5980307070b2dea0f80486e8f) |
| Ah Ming's whole pledge paid back to his payee | [0x500051a4…](https://explorer-test.qday.info/tx/0x500051a48b9dd2021d0666cf5d3860fc3ec6ce6f2a129e370d62e8a256b45624) |
| Refund check: Ah Ming got back 0.05 tUSD8 (his pledge was 0.05 tUSD8) | result |

### B. Round stalls: circle dissolved, refunds pro rata

| Step | Transaction |
|---|---|
| Open "Stalled circle" (2 members, 0.05 tUSD8 a round) | [0xab434c81…](https://explorer-test.qday.info/tx/0xab434c81a44c093b557f4295f2be4294af8613d10d9b9a0436011877f12db2f1) |
| Ah Ming joins with a signed pledge | [0xa19f9469…](https://explorer-test.qday.info/tx/0xa19f9469cc39c4fb0907d78cf0e8171e94d32a8be2b4159fa8b0fcd2c5182a35) |
| Kitty joins with a signed pledge | [0xe0d9b081…](https://explorer-test.qday.info/tx/0xe0d9b081160060e7816d2e03de383754aad4d3da0925fc23d312aa0d57c72dfd) |
| Nobody closed round 1 within the grace period: circle dissolved (anyone can call it) | [0xbc18c28a…](https://explorer-test.qday.info/tx/0xbc18c28a3dc0d0338ba416e36e40831f444507aee4ace7db25a82dfb8ca11b22) |
| Ah Ming's refund paid to his/her payee | [0x94490d03…](https://explorer-test.qday.info/tx/0x94490d0301940e341e42219ff684d7a18cf1aabeafdde9fb899cbe37b8ccfb42) |
| Kitty's refund paid to his/her payee | [0x62d716b0…](https://explorer-test.qday.info/tx/0x62d716b0b4c99abcfb17eecc0ce3abe28fba36a2e3b3d23052676b3550d4b128) |

### C. A past winner stops paying: held security pays the share

| Step | Transaction |
|---|---|
| Open "Security circle" (3 members, 0.05 tUSD8 a round) | [0xeba9f788…](https://explorer-test.qday.info/tx/0xeba9f788041ccac3eabecbd98ceb8e6a1426d8c8df30fc713c112506712c6666) |
| Ah Ming joins with a signed pledge | [0x0ca4fca1…](https://explorer-test.qday.info/tx/0x0ca4fca1c9c1fbaa79aabda00e4c5692dc1cf880e6bdbae220f649cea057743e) |
| Kitty joins with a signed pledge | [0xf674b90d…](https://explorer-test.qday.info/tx/0xf674b90de8930176dc91ab05d9e9bcca16ea7c55cc866e61c76f9fbba9437240) |
| Wing joins with a signed pledge | [0x7564a7ad…](https://explorer-test.qday.info/tx/0x7564a7ad3285159784bbfa7d6b18117779838840632cd83b4629ea1758dcdafe) |
| Round 1: auction closed | [0xc9a3d903…](https://explorer-test.qday.info/tx/0xc9a3d90314f256991df1b799296d5fae3ffb6d171108a5d9501496e65c1e396f) |
| Round 1: Kitty approves the release | [0x9c77304e…](https://explorer-test.qday.info/tx/0x9c77304eaab29277d6055adba0cf3125fa1ea7ad677f59a7137484a3e8854f9d) |
| Round 1: Wing approves the release | [0xf220f472…](https://explorer-test.qday.info/tx/0xf220f472f38cdb2b2e1d178e514eacc4dfe2247f1d48c8aab286e6f633f09f84) |
| Round 1: pot released to the winner's locked payee | [0x7e7cc890…](https://explorer-test.qday.info/tx/0x7e7cc8900bf0b403e4172cb2c1096ea0c520b35fd4b2961eb0b6c4f83c3645c4) |
| Ah Ming's held security after round 1: 0.075 tUSD8 | result |

### D. Standing order revoked: it can no longer collect

| Step | Transaction |
|---|---|
| Wing sets a standing order: 1 share a round, max 2 rounds, 1-day expiry | [0x7be8ebac…](https://explorer-test.qday.info/tx/0x7be8ebace8a0d4d61b7d36be2281517fd6d044b58b0dc50554279c4743147199) |
| Round 2: the standing order collects Wing's share | [0xb85f2123…](https://explorer-test.qday.info/tx/0xb85f2123d7d680caa2e7490cfa681e6095d6cf871e52d51b2d68c95e38ef6d03) |

### C. A past winner stops paying: held security pays the share

| Step | Transaction |
|---|---|
| Round 2: Kitty pays by signature | [0x7ba092e9…](https://explorer-test.qday.info/tx/0x7ba092e929dd40bbbc851203a1e6e45ffec3b2eb7256b237309cfb34b87842c6) |
| Round 2: auction closed | [0xe3bc409d…](https://explorer-test.qday.info/tx/0xe3bc409d89ecad7cb5576e6e6fa321da7b7f29db55ffcc70ec3a2055f9a6c7c0) |
| Round 2: Kitty approves the release | [0x23fbb34f…](https://explorer-test.qday.info/tx/0x23fbb34f0dd465332594dd08e980d4e674ec3415deb7b71448a1d1e6c9ae72fd) |
| Round 2: Wing approves the release | [0xf61c8caf…](https://explorer-test.qday.info/tx/0xf61c8caf7ca0e2c2ed3c7e28f6a2eeda22162449de42b361bc29dd86926dbfc6) |
| Round 2: pot released to the winner's locked payee | [0x98a640cf…](https://explorer-test.qday.info/tx/0x98a640cf2a1e1ee0770b9460c6c346d2fc92f8d00ab3db9cbbecdcffb314a769) |
| Round 2 closed with Ah Ming unpaid: his security paid his share (security left 0.025 tUSD8, round 2 pot 0.15 tUSD8) | result |

### D. Standing order revoked: it can no longer collect

| Step | Transaction |
|---|---|
| Wing revokes the standing order with one signature | [0x4cfc00b1…](https://explorer-test.qday.info/tx/0x4cfc00b11a25663f7942cf3d2c6b5eb3ba679c47e762c3ec590383e3bf1eebde) |
| Round 3: collecting again is refused by the contract (NoStandingOrder); no transaction is sent | result |

### E. The relayer refuses what would revert

| Step | Transaction |
|---|---|
| POST /api/relay closeAuction while round 3 bidding is open → HTTP 400 WOULD_REVERT: "Bidding is still open for this round." (simulated, refused, no gas spent) | result |

### C. A past winner stops paying: held security pays the share

| Step | Transaction |
|---|---|
| Round 3: Kitty pays by signature | [0xb85043ba…](https://explorer-test.qday.info/tx/0xb85043ba3bb6965f4484036e22935df5f87d27d43eea0869a45e7929f2fc10ec) |
| Round 3: Wing pays by signature | [0x54bcdf94…](https://explorer-test.qday.info/tx/0x54bcdf943e6a5a5bb7b46e0413b3c58f7e77f541b05d70c21ea9262467388829) |
| Round 3: auction closed | [0xda7c7006…](https://explorer-test.qday.info/tx/0xda7c7006a42e088b43973f4b9cf572d5ca1a4df4a0e77a1b6189407577c55d27) |
| Round 3: Kitty approves the release | [0x06b6e0d3…](https://explorer-test.qday.info/tx/0x06b6e0d320a5e5f6b777cf090658148d520bf3d6685d22e803f8167f9ffdca64) |
| Round 3: Wing approves the release | [0xbc71a8f2…](https://explorer-test.qday.info/tx/0xbc71a8f2cefe4791cd0728942e05077325a80d1076b56908b5daddf869a6feb3) |
| Round 3: pot released to the winner's locked payee | [0xa8995cc4…](https://explorer-test.qday.info/tx/0xa8995cc482b2d5e593490ee414364f7b6f821f04a157db6d79494cc995c30f2d) |
| Pay out Ah Ming's dividends and remaining security | [0x268a29ff…](https://explorer-test.qday.info/tx/0x268a29ff5bc62f717392b42a40ef285a0f3531f24b8e1b3944d3acb40da32f49) |
| Pay out Kitty's dividends and remaining security | [0x5ee4853e…](https://explorer-test.qday.info/tx/0x5ee4853e03c3e62ff54af9e173cf77ba5cfe20a4c683faafe9693d84b79e8300) |
