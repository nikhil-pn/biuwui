// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BiuWuiBase} from "./BiuWuiBase.t.sol";
import {BiuWuiCircle} from "../src/BiuWuiCircle.sol";

/// The bid-for-the-pot auction (標會) and the quorum release.
contract AuctionReleaseTest is BiuWuiBase {
    function setUp() public override {
        super.setUp();
        fill();
    }

    function _bid(uint256 i, uint256 discount) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigBid(i, discount, deadline);
        vm.prank(relayer);
        circle.bidWithSig(people[i], discount, deadline, sig);
    }

    function test_HighestDiscountWinsAndDividendIsShared() public {
        _bid(2, 5e6);
        _bid(3, 8e6);
        vm.prank(people[4]);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.BidNotHigher.selector, 8e6, 8e6));
        circle.bid(8e6);

        endBidding();
        vm.prank(makeAddr("anyone"));
        circle.closeAuction();
        BiuWuiCircle.Round memory rd = circle.getRound(1);
        assertEq(rd.winner, people[3]);
        assertEq(rd.discount, 8e6);

        (uint256 payout, uint256 fee, uint256 dividend, uint256 held) = circle.quotePayout(1);
        // pot 50, discount 8: fee 2% of 50 = 1, dividend 7, gross 42, held min(50% of 42, 4 rounds x 10)
        assertEq(fee, 1e6);
        assertEq(dividend, 7e6);
        assertEq(held, 21e6);
        assertEq(payout, 21e6);

        approveBy(circle.quorumNeeded());
        uint256 before = usd.balanceOf(people[3]);
        circle.release();
        assertEq(usd.balanceOf(people[3]) - before, payout);
        assertEq(usd.balanceOf(organiser), fee);
        assertEq(circle.claimable(people[0]), 7e6 / 5);
        assertEq(circle.currentRound(), 2);
    }

    function test_DiscountCapAndEligibility() public {
        uint256 cap = circle.maxDiscount();
        vm.prank(people[0]);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.DiscountTooHigh.selector, cap + 1, cap));
        circle.bid(cap + 1);
        runRound(); // Ah Ming wins round 1 by default
        payAll();
        vm.prank(people[0]);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.NotEligible.selector, people[0]));
        circle.bid(1e6);
    }

    function test_UnpaidMemberCannotBid() public {
        runRound();
        vm.prank(people[1]);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.NotEligible.selector, people[1]));
        circle.bid(1e6);
    }

    function test_BidSignatureBoundToRoundAndNonce() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sigBid(2, 3e6, deadline);
        vm.expectRevert(BiuWuiCircle.BadSignature.selector);
        circle.bidWithSig(people[2], 4e6, deadline, sig); // relayer cannot change the amount
        circle.bidWithSig(people[2], 3e6, deadline, sig);
        vm.expectRevert(BiuWuiCircle.BadSignature.selector);
        circle.bidWithSig(people[2], 3e6, deadline, sig); // nor replay it
    }

    function test_CannotCloseEarlyOrTwice() public {
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.TooEarly.selector, 1));
        circle.closeAuction();
        endBidding();
        circle.closeAuction();
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.AlreadyClosed.selector, 1));
        circle.closeAuction();
    }

    function test_ReleaseNeedsQuorum() public {
        endBidding();
        circle.closeAuction();
        approveBy(circle.quorumNeeded() - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                BiuWuiCircle.NoQuorum.selector, circle.quorumNeeded() - 1, circle.quorumNeeded()
            )
        );
        circle.release();
    }

    function test_ApproveTwiceReverts() public {
        endBidding();
        circle.closeAuction();
        vm.startPrank(people[0]);
        circle.approveRelease();
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.AlreadyApproved.selector, 1));
        circle.approveRelease();
        vm.stopPrank();
    }

    function test_LateWinnerIsCoveredFromSecurity() public {
        runRound(); // Ah Ming wins round 1, part of the pot is held as security
        uint256 held = circle.security(people[0]);
        assertGt(held, 0);
        // round 2: everyone but Ah Ming pays
        for (uint256 i = 1; i < SIZE; ++i) {
            BiuWuiCircle.Authorization memory a = signPay(i, 2);
            circle.payWithAuthorization(people[i], a);
        }
        endBidding();
        circle.closeAuction();
        assertTrue(circle.paid(2, people[0]));
        assertEq(circle.security(people[0]), held - SHARE);
        assertEq(circle.getRound(2).collected, SHARE * SIZE);
    }

    function test_PayTooLateReverts() public {
        runRound();
        endBidding();
        BiuWuiCircle.Authorization memory a = signPay(1, 2);
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.TooLate.selector, 2));
        circle.payWithAuthorization(people[1], a);
    }

    function test_PaySignatureCannotBeReusedNextRound() public {
        runRound();
        BiuWuiCircle.Authorization memory a = signPay(1, 3); // signed for round 3, used in round 2
        vm.expectRevert();
        circle.payWithAuthorization(people[1], a);
    }

    function test_FullCircleCompletesAndEveryoneWinsOnce() public {
        for (uint256 r = 1; r <= SIZE; ++r) {
            runRound();
        }
        assertEq(uint8(circle.phase()), uint8(BiuWuiCircle.Phase.Completed));
        for (uint256 i; i < SIZE; ++i) {
            assertTrue(circle.hasWon(people[i]));
            if (circle.withdrawable(people[i]) != 0) circle.withdrawFor(people[i]);
        }
        // with no bids there is no discount: everyone ends exactly where they started
        for (uint256 i; i < SIZE; ++i) {
            assertEq(usd.balanceOf(people[i]), 1_000e6);
        }
        assertEq(usd.balanceOf(address(circle)), 0);
    }
}
