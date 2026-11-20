// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BiuWuiBase} from "./BiuWuiBase.t.sol";
import {BiuWuiCircle} from "../src/BiuWuiCircle.sol";

/// Joining is a pledge: the first share is paid on joining. If the circle does not fill by joinBy,
/// it can be cancelled and every pledge comes back in full.
contract JoinTest is BiuWuiBase {
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
        BiuWuiCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.prank(relayer);
        circle.joinWithAuthorization(people[0], names[0], people[0], a);
        assertTrue(circle.isMember(people[0]));
        assertEq(people[0].balance, before);
        assertEq(usd.balanceOf(people[0]), 1_000e6 - SHARE);
    }

    /// The signed nonce binds the payout address and name, so a relayer cannot swap them.
    function test_RelayerCannotChangeSignedPayout() public {
        BiuWuiCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.prank(relayer);
        vm.expectRevert();
        circle.joinWithAuthorization(people[0], names[0], relayer, a);
        vm.prank(relayer);
        vm.expectRevert();
        circle.joinWithAuthorization(people[0], "Relayer", people[0], a);
    }

    function test_SignatureForOneCircleFailsInAnother() public {
        BiuWuiCircle other = openCircle(defaultParams());
        BiuWuiCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.prank(relayer);
        vm.expectRevert();
        other.joinWithAuthorization(people[0], names[0], people[0], a);
    }

    function test_FillingStartsRoundOneWithEveryonePaid() public {
        fill();
        assertEq(uint8(circle.phase()), uint8(BiuWuiCircle.Phase.Running));
        assertEq(circle.currentRound(), 1);
        assertEq(circle.getRound(1).collected, SHARE * SIZE);
        for (uint256 i; i < SIZE; ++i) {
            assertTrue(circle.paid(1, people[i]));
        }
    }

    function test_CannotJoinTwiceOrWhenFull() public {
        BiuWuiCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        circle.joinWithAuthorization(people[0], names[0], people[0], a);
        vm.startPrank(people[0]);
        usd.approve(address(circle), SHARE);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.AlreadyMember.selector, people[0]));
        circle.join(names[0], people[0]);
        vm.stopPrank();
    }

    function test_BadNamesRejected() public {
        vm.startPrank(people[0]);
        usd.approve(address(circle), SHARE);
        vm.expectRevert(BiuWuiCircle.BadName.selector);
        circle.join("", people[0]);
        vm.expectRevert(BiuWuiCircle.BadName.selector);
        circle.join("a name that is far longer than thirty-two bytes", people[0]);
        vm.expectRevert(BiuWuiCircle.ZeroAddress.selector);
        circle.join(names[0], address(0));
        vm.stopPrank();
    }

    function test_CannotJoinAfterWindow() public {
        vm.warp(block.timestamp + JOIN + 1);
        BiuWuiCircle.Authorization memory a = signJoin(0, circle, people[0], names[0]);
        vm.expectRevert(BiuWuiCircle.JoinWindowClosed.selector);
        circle.joinWithAuthorization(people[0], names[0], people[0], a);
    }

    function test_LeaveRefundsPledgeToPayee() public {
        address wallet = makeAddr("Kitty savings");
        BiuWuiCircle.Authorization memory a = signJoin(1, circle, wallet, names[1]);
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

    function test_UnfilledCircleCancelsAndRefundsEveryPledge() public {
        for (uint256 i; i < 3; ++i) {
            BiuWuiCircle.Authorization memory a = signJoin(i, circle, people[i], names[i]);
            circle.joinWithAuthorization(people[i], names[i], people[i], a);
        }
        vm.expectRevert(BiuWuiCircle.JoinWindowOpen.selector);
        circle.cancelUnfilled();

        vm.warp(block.timestamp + JOIN + 1);
        vm.prank(relayer);
        circle.cancelUnfilled();
        assertEq(uint8(circle.phase()), uint8(BiuWuiCircle.Phase.Cancelled));

        for (uint256 i; i < 3; ++i) {
            assertEq(circle.withdrawable(people[i]), SHARE);
            vm.prank(relayer);
            circle.withdrawFor(people[i]);
            assertEq(usd.balanceOf(people[i]), 1_000e6);
            vm.expectRevert(BiuWuiCircle.NothingToWithdraw.selector);
            circle.withdrawFor(people[i]);
        }
        assertEq(usd.balanceOf(address(circle)), 0);
    }
}
