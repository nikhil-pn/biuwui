# Third-party code and licenses

| What | Where it is used | License |
|---|---|---|
| [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit), Copyright (c) 2026 PQA Labs | `tools/check-shanghai.mjs` (copied, path changed); the gasless-payment pattern (EIP-3009 `receiveWithAuthorization` with a nonce bound to the action) and the relayer's safety rails are modelled on its `Checkout.sol` and `api/relay` | MIT |
| [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5.1.0 | `EIP712`, `ECDSA`, `SignatureChecker`, `SafeERC20` (git submodule `lib/openzeppelin-contracts`) | MIT |
| [forge-std](https://github.com/foundry-rs/forge-std) v1.9.6 | tests and scripts (git submodule `lib/forge-std`) | MIT / Apache-2.0 |
