// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BiuWuiCircle} from "../src/BiuWuiCircle.sol";
import {BiuWuiFactory} from "../src/BiuWuiFactory.sol";
import {MockUSD8} from "./mocks/MockUSD8.sol";

/// @dev Shared setup: a mock tUSD8 (same EIP-712 domain, EIP-2612 and EIP-3009 as the real one), the
/// circle implementation, the factory, and five members with private keys so tests can sign the
/// same messages a wallet would.
abstract contract BiuWuiBase is Test {
    uint256 internal constant SHARE = 10e6; // 10 tUSD8 (6 decimals)
    uint8 internal constant SIZE = 5;
    uint32 internal constant JOIN = 3 days;
    uint32 internal constant ROUND = 1 days;
    uint32 internal constant GRACE = 2 days;
    uint32 internal constant PAYEE_DELAY = 2 days;

    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    MockUSD8 internal usd;
    BiuWuiCircle internal impl;
    BiuWuiFactory internal factory;
    BiuWuiCircle internal circle;

    address internal organiser = makeAddr("organiser");
    address internal relayer = makeAddr("relayer");
    address[] internal people;
    uint256[] internal keys;
    string[5] internal names = ["Ah Ming", "Kitty", "Wing", "Siu Mei", "Ka Ho"];

    function setUp() public virtual {
        usd = new MockUSD8();
        impl = new BiuWuiCircle();
        factory = new BiuWuiFactory(address(usd), address(impl));
        for (uint256 i; i < names.length; ++i) {
            (address a, uint256 k) = makeAddrAndKey(names[i]);
            people.push(a);
            keys.push(k);
            usd.mint(a, 1_000e6);
        }
        circle = openCircle(defaultParams());
    }

    function defaultParams() internal view returns (BiuWuiCircle.Params memory) {
        return BiuWuiCircle.Params({
            token: address(usd),
            share: SHARE,
            size: SIZE,
            joinWindow: JOIN,
            roundLength: ROUND,
            graceLength: GRACE,
            payeeDelay: PAYEE_DELAY,
            maxDiscountBps: 3000,
            feeBps: 200,
            quorumBps: 5001,
            securityBps: 5000,
            name: "Sham Shui Po Biu Wui"
        });
    }

    function openCircle(BiuWuiCircle.Params memory p) internal returns (BiuWuiCircle c) {
        vm.prank(organiser);
        c = factory.createCircle(p);
    }

    // ------------------------------------------------------------ signing, as a wallet would

    function _tokenDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", usd.DOMAIN_SEPARATOR(), structHash));
    }

    function _circleDomain(BiuWuiCircle c) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Biu Wui"),
                keccak256("1"),
                block.chainid,
                address(c)
            )
        );
    }

    function _sign(uint256 k, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, digest);
        return abi.encodePacked(r, s, v);
    }

    function signReceive(uint256 k, address from, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (BiuWuiCircle.Authorization memory a)
    {
        a.validAfter = 0;
        a.validBefore = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, from, to, value, a.validAfter, a.validBefore, nonce));
        (a.v, a.r, a.s) = vm.sign(k, _tokenDigest(structHash));
    }

    function signJoin(uint256 i, BiuWuiCircle c, address payout, string memory n)
        internal
        view
        returns (BiuWuiCircle.Authorization memory)
    {
        return signReceive(keys[i], people[i], address(c), SHARE, c.joinNonce(people[i], payout, n));
    }

    function signPay(uint256 i, uint256 r) internal view returns (BiuWuiCircle.Authorization memory) {
        return signReceive(keys[i], people[i], address(circle), SHARE, circle.payNonce(people[i], r));
    }

    function signPermit(uint256 i, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (BiuWuiCircle.PermitSig memory p)
    {
        p.deadline = deadline;
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, people[i], spender, value, usd.nonces(people[i]), deadline));
        (p.v, p.r, p.s) = vm.sign(keys[i], _tokenDigest(structHash));
    }

    function signAction(uint256 i, bytes32 structHash) internal view returns (bytes memory) {
        return _sign(keys[i], keccak256(abi.encodePacked("\x19\x01", _circleDomain(circle), structHash)));
    }

    function nonceOf(uint256 i) internal view returns (uint256) {
        return circle.nonces(people[i]);
    }

    function sigBid(uint256 i, uint256 discount, uint256 deadline) internal view returns (bytes memory) {
        return signAction(
            i,
            keccak256(
                abi.encode(circle.BID_TYPEHASH(), people[i], circle.currentRound(), discount, nonceOf(i), deadline)
            )
        );
    }

    function sigApprove(uint256 i, uint256 deadline) internal view returns (bytes memory) {
        return signAction(
            i, keccak256(abi.encode(circle.APPROVE_TYPEHASH(), people[i], circle.currentRound(), nonceOf(i), deadline))
        );
    }

    function sigOrder(uint256 i, uint16 maxRounds, uint64 expiresAt, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return signAction(
            i, keccak256(abi.encode(circle.ORDER_TYPEHASH(), people[i], maxRounds, expiresAt, nonceOf(i), deadline))
        );
    }

    function sigRevoke(uint256 i, uint256 deadline) internal view returns (bytes memory) {
        return signAction(i, keccak256(abi.encode(circle.REVOKE_TYPEHASH(), people[i], nonceOf(i), deadline)));
    }

    function sigPayee(uint256 i, address payout, string memory n, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return signAction(
            i,
            keccak256(
                abi.encode(circle.PAYEE_TYPEHASH(), people[i], payout, keccak256(bytes(n)), nonceOf(i), deadline)
            )
        );
    }

    function sigCancelPayee(uint256 i, uint256 deadline) internal view returns (bytes memory) {
        return signAction(i, keccak256(abi.encode(circle.CANCEL_PAYEE_TYPEHASH(), people[i], nonceOf(i), deadline)));
    }

    function sigLeave(uint256 i, uint256 deadline) internal view returns (bytes memory) {
        return signAction(i, keccak256(abi.encode(circle.LEAVE_TYPEHASH(), people[i], nonceOf(i), deadline)));
    }

    // ------------------------------------------------------------ flows

    /// @dev Everyone joins gaslessly through the relayer, paying out to themselves.
    function fill() internal {
        for (uint256 i; i < people.length; ++i) {
            BiuWuiCircle.Authorization memory a = signJoin(i, circle, people[i], names[i]);
            vm.prank(relayer);
            circle.joinWithAuthorization(people[i], names[i], people[i], a);
        }
    }

    function payAll() internal {
        uint256 r = circle.currentRound();
        for (uint256 i; i < people.length; ++i) {
            if (circle.paid(r, people[i])) continue;
            BiuWuiCircle.Authorization memory a = signPay(i, r);
            vm.prank(relayer);
            circle.payWithAuthorization(people[i], a);
        }
    }

    function endBidding() internal {
        vm.warp(circle.getRound(circle.currentRound()).bidEnd + 1);
    }

    function approveBy(uint256 count) internal {
        for (uint256 i; i < count; ++i) {
            uint256 deadline = block.timestamp + 1 hours;
            bytes memory sig = sigApprove(i, deadline);
            vm.prank(relayer);
            circle.approveReleaseWithSig(people[i], deadline, sig);
        }
    }

    /// @dev One whole round with no bids: pay, close, approve by quorum, release.
    function runRound() internal {
        payAll();
        endBidding();
        circle.closeAuction();
        approveBy(circle.quorumNeeded());
        circle.release();
    }

    function indexOf(address a) internal view returns (uint256) {
        for (uint256 i; i < people.length; ++i) {
            if (people[i] == a) return i;
        }
        revert("not a person");
    }
}
