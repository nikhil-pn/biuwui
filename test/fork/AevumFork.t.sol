// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BiuWuiCircle} from "../../src/BiuWuiCircle.sol";
import {BiuWuiFactory} from "../../src/BiuWuiFactory.sol";
import {IStablecoin} from "../../src/interfaces/IStablecoin.sol";

interface ITUSD8 is IStablecoin {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address) external view returns (uint256);
}

/// @notice A whole gasless circle against the REAL tUSD8 on a local fork of Aevum testnet: joins
/// signed with EIP-3009, a standing order with the real EIP-2612 permit, signed bids and approvals.
/// `deal` writes balances into the fork only; no funds needed.
/// Run: forge test --match-path 'test/fork/*' --fork-url aevum --evm-version shanghai -vv
contract AevumForkTest is Test {
    ITUSD8 internal constant TUSD8 = ITUSD8(0x456569838f1d43009A91ebA4263147Afd7233483);
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    uint256 internal constant SHARE = 1e6;

    BiuWuiCircle internal circle;
    address[3] internal who;
    uint256[3] internal key;
    string[3] internal names = ["Ah Ming", "Kitty", "Wing"];
    address internal relayer = makeAddr("relayer");

    function setUp() public {
        if (block.chainid != 44005) return;
        BiuWuiFactory factory = new BiuWuiFactory(address(TUSD8), address(new BiuWuiCircle()));
        circle = factory.createCircle(
            BiuWuiCircle.Params({
                token: address(TUSD8),
                share: SHARE,
                size: 3,
                joinWindow: 1 days,
                roundLength: 1 hours,
                graceLength: 1 hours,
                payeeDelay: 1 hours,
                maxDiscountBps: 3000,
                feeBps: 100,
                quorumBps: 6000,
                securityBps: 5000,
                name: "Fork Biu Wui"
            })
        );
        for (uint256 i; i < 3; ++i) {
            (who[i], key[i]) = makeAddrAndKey(names[i]);
            deal(address(TUSD8), who[i], 10e6);
        }
    }

    function _digest(bytes32 domain, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _auth(uint256 i, bytes32 nonce) internal view returns (BiuWuiCircle.Authorization memory a) {
        a.validBefore = block.timestamp + 1 hours;
        bytes32 h = keccak256(abi.encode(RECEIVE_TYPEHASH, who[i], address(circle), SHARE, 0, a.validBefore, nonce));
        (a.v, a.r, a.s) = vm.sign(key[i], _digest(TUSD8.DOMAIN_SEPARATOR(), h));
    }

    function _circleSig(uint256 i, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Biu Wui"),
                keccak256("1"),
                block.chainid,
                address(circle)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key[i], _digest(domain, structHash));
        return abi.encodePacked(r, s, v);
    }

    function test_fork_wholeGaslessCircleOnRealTusd8() public {
        vm.skip(block.chainid != 44005);

        // 1. three gasless joins (EIP-3009 pledges)
        for (uint256 i; i < 3; ++i) {
            BiuWuiCircle.Authorization memory a = _auth(i, circle.joinNonce(who[i], who[i], names[i]));
            vm.prank(relayer);
            circle.joinWithAuthorization(who[i], names[i], who[i], a);
            assertEq(who[i].balance, 0, "members hold no gas token");
        }
        assertEq(uint8(circle.phase()), uint8(BiuWuiCircle.Phase.Running));

        // 2. Kitty bids a discount, signed
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory bidSig = _circleSig(
            1, keccak256(abi.encode(circle.BID_TYPEHASH(), who[1], uint256(1), uint256(2e5), uint256(0), deadline))
        );
        vm.prank(relayer);
        circle.bidWithSig(who[1], 2e5, deadline, bidSig);

        // 3. close, two signed approvals, release
        vm.warp(block.timestamp + 1 hours + 1);
        circle.closeAuction();
        for (uint256 i; i < 2; ++i) {
            bytes memory s = _circleSig(
                i,
                keccak256(
                    abi.encode(circle.APPROVE_TYPEHASH(), who[i], uint256(1), circle.nonces(who[i]), deadline + 2 hours)
                )
            );
            vm.prank(relayer);
            circle.approveReleaseWithSig(who[i], deadline + 2 hours, s);
        }
        uint256 before = TUSD8.balanceOf(who[1]);
        circle.release();
        assertGt(TUSD8.balanceOf(who[1]), before, "Kitty got the pot");

        // 4. Wing sets a standing order with the real EIP-2612 permit; anyone collects round 2
        uint64 exp = uint64(block.timestamp + 7 days);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory orderSig = _circleSig(
            2, keccak256(abi.encode(circle.ORDER_TYPEHASH(), who[2], uint256(2), uint256(exp), circle.nonces(who[2]), dl))
        );
        BiuWuiCircle.PermitSig memory p;
        p.deadline = dl;
        (p.v, p.r, p.s) = vm.sign(
            key[2],
            _digest(
                TUSD8.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, who[2], address(circle), 2 * SHARE, TUSD8.nonces(who[2]), dl))
            )
        );
        vm.prank(relayer);
        circle.setStandingOrderWithSig(who[2], 2, exp, dl, orderSig, p);
        assertEq(TUSD8.allowance(who[2], address(circle)), 2 * SHARE);
        circle.collect(who[2]);
        assertTrue(circle.paid(2, who[2]));
    }
}
