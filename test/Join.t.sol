// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SovereignBase} from "./SovereignBase.t.sol";
import {SovereignCircle} from "../src/SovereignCircle.sol";

/// Joining is a pledge: the first share is paid on joining. If the circle does not fill by joinBy,
/// it can be cancelled and every pledge comes back in full.
contract JoinTest is SovereignBase {
    function test_JoinDirectPaysPledge() public {
        vm.startPrank(people[0]);
        usd.approve(address(circle), SHARE);
        circle.join(names[0], people[0]);
        vm.stopPrank();
        assertTrue(circle.isMember(people[0]));
        assertTrue(circle.paid(1, people[0]));
        assertEq(usd.balanceOf(address(circle)), SHARE);
        (address payout, string memory n) = circle.payeeOf(people[0]);
        assertEq(payout, people[0]);
        assertEq(n, names[0]);
    }

    function test_GaslessJoinNeedsNoGasFromMember() public {
        uint256 before = people[0].balance;
        SovereignCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.prank(relayer);
        circle.joinWithAuthorization(people[0], names[0], people[0], a);
        assertTrue(circle.isMember(people[0]));
        assertEq(people[0].balance, before);
        assertEq(usd.balanceOf(people[0]), 1_000e6 - SHARE);
    }

    /// The signed nonce binds the payout address and name, so a relayer cannot swap them.
    function test_RelayerCannotChangeSignedPayout() public {
        SovereignCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.prank(relayer);
        vm.expectRevert();
        circle.joinWithAuthorization(people[0], names[0], relayer, a);
        vm.prank(relayer);
        vm.expectRevert();
        circle.joinWithAuthorization(people[0], "Relayer", people[0], a);
    }

    function test_SignatureForOneCircleFailsInAnother() public {
        SovereignCircle other = openCircle(defaultParams());
        SovereignCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.prank(relayer);
        vm.expectRevert();
        other.joinWithAuthorization(people[0], names[0], people[0], a);
    }

    function test_FillingStartsRoundOneWithEveryonePaid() public {
        fill();
        assertEq(uint8(circle.phase()), uint8(SovereignCircle.Phase.Running));
        assertEq(circle.currentRound(), 1);
        assertEq(circle.getRound(1).collected, SHARE * SIZE);
        for (uint256 i; i < SIZE; ++i) {
            assertTrue(circle.paid(1, people[i]));
        }
    }

    function test_CannotJoinTwiceOrWhenFull() public {
        SovereignCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        circle.joinWithAuthorization(people[0], names[0], people[0], a);
        vm.startPrank(people[0]);
        usd.approve(address(circle), SHARE);
        vm.expectRevert(abi.encodeWithSelector(SovereignCircle.AlreadyMember.selector, people[0]));
        circle.join(names[0], people[0]);
        vm.stopPrank();
    }

    function test_BadNamesRejected() public {
        vm.startPrank(people[0]);
        usd.approve(address(circle), SHARE);
        vm.expectRevert(SovereignCircle.BadName.selector);
        circle.join("", people[0]);
        vm.expectRevert(SovereignCircle.BadName.selector);
        circle.join("a name that is far longer than thirty-two bytes", people[0]);
        vm.expectRevert(SovereignCircle.ZeroAddress.selector);
        circle.join(names[0], address(0));
        vm.stopPrank();
    }

    function test_CannotJoinAfterWindow() public {
        vm.warp(block.timestamp + JOIN + 1);
        SovereignCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.expectRevert(SovereignCircle.JoinWindowClosed.selector);
        circle.joinWithAuthorization(people[0], names[0], people[0], a);
    }

    function test_LeaveRefundsPledgeToPayee() public {
        address wallet = makeAddr("Kitty savings");
        SovereignCircle.Authorization memory a = signJoin(1, circle, wallet, names[1]);
        circle.joinWithAuthorization(people[1], names[1], wallet, a);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigLeave(1, deadline);
        vm.prank(relayer);
        circle.leaveWithSig(people[1], deadline, sig);
        assertFalse(circle.isMember(people[1]));
        assertEq(usd.balanceOf(wallet), SHARE);
        assertEq(usd.balanceOf(address(circle)), 0);
        assertEq(circle.getRound(1).collected, 0);
    }

    /// Leaving keeps everyone else in join order, so "earliest-joined takes the pot when nobody bids" holds.
    function test_LeaveKeepsJoinOrder() public {
        for (uint256 i; i < 4; ++i) {
            SovereignCircle.Authorization memory a = signJoin(i, circle, people[i], names[i]);
            circle.joinWithAuthorization(people[i], names[i], people[i], a);
        }
        vm.prank(people[1]);
        circle.leave();
        address[] memory ms = circle.members();
        assertEq(ms.length, 3);
        assertEq(ms[0], people[0]);
        assertEq(ms[1], people[2]);
        assertEq(ms[2], people[3]);
    }

    function test_UnfilledCircleCancelsAndRefundsEveryPledge() public {
        for (uint256 i; i < 3; ++i) {
            SovereignCircle.Authorization memory a = signJoin(i, circle, people[i], names[i]);
            circle.joinWithAuthorization(people[i], names[i], people[i], a);
        }
        vm.expectRevert(SovereignCircle.JoinWindowOpen.selector);
        circle.cancelUnfilled();

        vm.warp(block.timestamp + JOIN + 1);
        vm.prank(relayer);
        circle.cancelUnfilled();
        assertEq(uint8(circle.phase()), uint8(SovereignCircle.Phase.Cancelled));

        for (uint256 i; i < 3; ++i) {
            assertEq(circle.withdrawable(people[i]), SHARE);
            vm.prank(relayer);
            circle.withdrawFor(people[i]);
            assertEq(usd.balanceOf(people[i]), 1_000e6);
            vm.expectRevert(SovereignCircle.NothingToWithdraw.selector);
            circle.withdrawFor(people[i]);
        }
        assertEq(usd.balanceOf(address(circle)), 0);
    }
}
