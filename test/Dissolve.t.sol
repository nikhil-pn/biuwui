// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SovereignBase} from "./SovereignBase.t.sol";
import {SovereignCircle} from "../src/SovereignCircle.sol";

/// If a round stalls, anyone can dissolve the circle and the money left goes back pro rata.
contract DissolveTest is SovereignBase {
    function setUp() public override {
        super.setUp();
        fill();
    }

    function test_StalledCircleDissolvesAndRefunds() public {
        runRound(); // Ah Ming took round 1
        payAll();
        endBidding();
        vm.expectRevert(SovereignCircle.NotStalled.selector);
        circle.dissolve();
        vm.warp(block.timestamp + GRACE + 1); // nobody closed the auction
        circle.dissolve();
        assertEq(uint8(circle.phase()), uint8(SovereignCircle.Phase.Dissolved));
        // Ah Ming already took more than he paid in, so he gets nothing more; his held security
        // goes to the four who were never paid, in equal parts.
        assertEq(circle.withdrawable(people[0]), 0);
        uint256 each = circle.withdrawable(people[1]);
        for (uint256 i = 1; i < SIZE; ++i) {
            assertEq(circle.withdrawable(people[i]), each);
            circle.withdrawFor(people[i]);
        }
        assertLe(usd.balanceOf(address(circle)), SIZE); // only rounding dust can stay
        // pot 50 paid out as 25 + 25 held; round 2 collected 50: 75 shared by four who each put in 20
        assertEq(each, 75e6 / 4);
    }

    function test_NonStalledCannotDissolve() public {
        vm.expectRevert(SovereignCircle.NotStalled.selector);
        circle.dissolve();
    }
}
