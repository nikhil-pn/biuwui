// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The parts of tUSD8 (QDay Aevum testnet, USDC-style, 6 decimals) that Biu Wui uses:
/// plain ERC-20, EIP-2612 `permit` (for standing orders) and EIP-3009 `receiveWithAuthorization`
/// (for gasless pledges and payments).
interface IStablecoin is IERC20 {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
