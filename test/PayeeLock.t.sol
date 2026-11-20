// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BiuWuiBase} from "./BiuWuiBase.t.sol";
import {BiuWuiCircle} from "../src/BiuWuiCircle.sol";

/// Confirmation of payee, on chain: each member's pot goes to a named, locked payee. A change waits
/// `payeeDelay`, is visible to every member meanwhile, and can be cancelled without gas.
contract PayeeLockTest is BiuWuiBase {
    address internal thief = makeAddr("thief");

    function setUp() public override {
        super.setUp();
        fill();
    }

    function _requestChange(uint256 i, address to, string memory n) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigPayee(i, to, n, deadline);
        vm.prank(relayer);
        circle.requestPayeeChangeWithSig(people[i], to, n, deadline, sig);
    }

    function test_ChangeWaitsOutTheDelayAndIsVisible() public {
        _requestChange(0, thief, "Ah Ming new");
        (address payout,) = circle.payeeOf(people[0]);
        assertEq(payout, people[0]);
        (address pending, string memory n, uint64 at) = circle.pendingPayeeOf(people[0]);
        assertEq(pending, thief);
        assertEq(n, "Ah Ming new");
        assertEq(at, block.timestamp + PAYEE_DELAY);

        vm.warp(at);
        (payout, n) = circle.payeeOf(people[0]);
        assertEq(payout, thief);
        assertEq(n, "Ah Ming new");
    }

    /// A stolen key asks to redirect the pot; the member sees it and cancels gaslessly in time.
    function test_StolenKeyRedirectIsCancelledInTime() public {
        _requestChange(0, thief, "Ah Ming");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigCancelPayee(0, deadline);
        vm.prank(relayer);
        circle.cancelPayeeChangeWithSig(people[0], deadline, sig);
        vm.warp(block.timestamp + PAYEE_DELAY + 1);
        (address payout,) = circle.payeeOf(people[0]);
        assertEq(payout, people[0]);
    }

    /// The payee is fixed when the auction closes: a change that matures afterwards cannot touch the pot.
    function test_PotGoesToPayeeFixedAtClose() public {
        // Ah Ming (index 0) is the default winner of round 1 (no bids, earliest joined).
        endBidding();
        circle.closeAuction();
        assertEq(circle.getRound(1).payTo, people[0]);

        _requestChange(0, thief, "Ah Ming");
        vm.warp(block.timestamp + PAYEE_DELAY + 1); // the change has matured...
        approveBy(circle.quorumNeeded());
        // ...but release still pays the payee fixed at close.
        uint256 before = usd.balanceOf(people[0]);
        circle.release();
        assertGt(usd.balanceOf(people[0]), before);
        assertEq(usd.balanceOf(thief), 0);
    }

    function test_MaturedChangeAppliesToLaterWithdrawals() public {
        _requestChange(1, makeAddr("Kitty bank"), "Kitty (bank)");
        vm.warp(block.timestamp + PAYEE_DELAY + 1);
        (address payout, string memory n) = circle.payeeOf(people[1]);
        assertEq(payout, makeAddr("Kitty bank"));
        assertEq(n, "Kitty (bank)");
    }

    function test_CancelWithoutPendingReverts() public {
        vm.prank(people[2]);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.NoPendingPayee.selector, people[2]));
        circle.cancelPayeeChange();
    }

    function test_RelayerCannotAlterSignedPayee() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigPayee(0, makeAddr("good"), "Ah Ming", deadline);
        vm.expectRevert(BiuWuiCircle.BadSignature.selector);
        circle.requestPayeeChangeWithSig(people[0], thief, "Ah Ming", deadline, sig);
    }

    function test_NonMemberCannotRequest() public {
        vm.prank(thief);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.NotMember.selector, thief));
        circle.requestPayeeChange(thief, "x");
    }
}
