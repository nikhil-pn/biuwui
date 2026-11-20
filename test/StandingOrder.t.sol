// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BiuWuiBase} from "./BiuWuiBase.t.sol";
import {BiuWuiCircle} from "../src/BiuWuiCircle.sol";

/// A standing order is a scoped, capped, expiring, revocable permission: anyone (the secretary bot)
/// may collect exactly one share per round, at most maxRounds times, until it expires or is revoked.
contract StandingOrderTest is BiuWuiBase {
    function setUp() public override {
        super.setUp();
        fill();
        runRound(); // round 1 done; round 2 is open
    }

    function _giveOrder(uint256 i, uint16 maxRounds, uint64 expiresAt) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigOrder(i, maxRounds, expiresAt, deadline);
        BiuWuiCircle.PermitSig memory p = signPermit(i, address(circle), SHARE * maxRounds, deadline);
        vm.prank(relayer);
        circle.setStandingOrderWithSig(people[i], maxRounds, expiresAt, deadline, sig, p);
    }

    function test_GaslessOrderSetsAllowanceAndOrder() public {
        _giveOrder(0, 3, uint64(block.timestamp + 30 days));
        BiuWuiCircle.StandingOrder memory o = circle.standingOrderOf(people[0]);
        assertTrue(o.active);
        assertEq(o.maxRounds, 3);
        assertEq(usd.allowance(people[0], address(circle)), SHARE * 3);
        assertTrue(circle.canCollect(people[0]));
    }

    function test_CollectTakesExactlyOneShareOncePerRound() public {
        _giveOrder(0, 3, uint64(block.timestamp + 30 days));
        uint256 before = usd.balanceOf(people[0]);
        vm.prank(makeAddr("anyone"));
        circle.collect(people[0]);
        assertEq(before - usd.balanceOf(people[0]), SHARE);
        assertTrue(circle.paid(2, people[0]));
        assertFalse(circle.canCollect(people[0]));
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.AlreadyPaid.selector, 2));
        circle.collect(people[0]);
    }

    function test_OrderIsUsedUpAfterMaxRounds() public {
        _giveOrder(0, 1, uint64(block.timestamp + 30 days));
        circle.collect(people[0]);
        // finish round 2, open round 3
        payAll();
        endBidding();
        circle.closeAuction();
        approveBy(circle.quorumNeeded());
        circle.release();
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.StandingOrderUsedUp.selector, people[0]));
        circle.collect(people[0]);
    }

    function test_OrderExpires() public {
        _giveOrder(0, 3, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.StandingOrderExpired.selector, people[0]));
        circle.collect(people[0]);
    }

    function test_RevokeWithSigStopsCollection() public {
        _giveOrder(0, 3, uint64(block.timestamp + 30 days));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigRevoke(0, deadline);
        vm.prank(relayer);
        circle.revokeStandingOrderWithSig(people[0], deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.NoStandingOrder.selector, people[0]));
        circle.collect(people[0]);
    }

    function test_ZeroAllowanceStopsCollectionToo() public {
        _giveOrder(0, 3, uint64(block.timestamp + 30 days));
        vm.prank(people[0]);
        usd.approve(address(circle), 0);
        assertFalse(circle.canCollect(people[0]));
        vm.expectRevert();
        circle.collect(people[0]);
    }

    function test_NoOrderNoCollect() public {
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.NoStandingOrder.selector, people[1]));
        circle.collect(people[1]);
    }

    function test_OrderLimitsAreChecked() public {
        uint256 deadline = block.timestamp + 1 hours;
        BiuWuiCircle.PermitSig memory p = signPermit(0, address(circle), SHARE, deadline);
        bytes memory sig = sigOrder(0, 0, uint64(block.timestamp + 1 days), deadline);
        vm.expectRevert(BiuWuiCircle.BadStandingOrder.selector);
        circle.setStandingOrderWithSig(people[0], 0, uint64(block.timestamp + 1 days), deadline, sig, p);
        sig = sigOrder(0, SIZE + 1, uint64(block.timestamp + 1 days), deadline);
        vm.expectRevert(BiuWuiCircle.BadStandingOrder.selector);
        circle.setStandingOrderWithSig(people[0], SIZE + 1, uint64(block.timestamp + 1 days), deadline, sig, p);
    }

    function test_SignedOrderCannotBeReplayedOrAltered() public {
        uint64 exp = uint64(block.timestamp + 30 days);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigOrder(0, 2, exp, deadline);
        BiuWuiCircle.PermitSig memory p = signPermit(0, address(circle), SHARE * 2, deadline);
        // a relayer that raises maxRounds breaks the signature
        vm.expectRevert(BiuWuiCircle.BadSignature.selector);
        circle.setStandingOrderWithSig(people[0], 5, exp, deadline, sig, p);
        circle.setStandingOrderWithSig(people[0], 2, exp, deadline, sig, p);
        // the nonce moved on, so the same signature fails a second time
        vm.expectRevert(BiuWuiCircle.BadSignature.selector);
        circle.setStandingOrderWithSig(people[0], 2, exp, deadline, sig, p);
    }

    function test_FrontRunPermitDoesNotBlockOrder() public {
        uint64 exp = uint64(block.timestamp + 30 days);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigOrder(0, 2, exp, deadline);
        BiuWuiCircle.PermitSig memory p = signPermit(0, address(circle), SHARE * 2, deadline);
        usd.permit(people[0], address(circle), SHARE * 2, p.deadline, p.v, p.r, p.s); // griefer submits it first
        circle.setStandingOrderWithSig(people[0], 2, exp, deadline, sig, p);
        assertTrue(circle.standingOrderOf(people[0]).active);
    }

    function test_ExpiredSignatureRejected() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigOrder(0, 2, uint64(block.timestamp + 30 days), deadline);
        BiuWuiCircle.PermitSig memory p = signPermit(0, address(circle), SHARE * 2, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.SignatureExpired.selector, deadline));
        circle.setStandingOrderWithSig(people[0], 2, uint64(block.timestamp + 30 days), deadline, sig, p);
    }
}
