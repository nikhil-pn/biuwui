// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {BiuWuiCircle} from "../src/BiuWuiCircle.sol";
import {BiuWuiFactory} from "../src/BiuWuiFactory.sol";
import {MockUSD8} from "./mocks/MockUSD8.sol";

/// @dev Drives one circle through random sequences of every public action.
contract Handler is Test {
    BiuWuiCircle public circle;
    MockUSD8 public usd;
    address[] public people;
    uint256 public calls;
    uint256 public releases;
    uint256 public joins;

    constructor(BiuWuiCircle c, MockUSD8 u, address[] memory p) {
        circle = c;
        usd = u;
        people = p;
    }

    function _who(uint256 seed) internal view returns (address) {
        return people[seed % people.length];
    }

    function join(uint256 seed) external {
        address m = _who(seed);
        vm.startPrank(m);
        usd.approve(address(circle), type(uint256).max);
        try circle.join("member", m) {
            joins++;
        } catch {}
        vm.stopPrank();
        calls++;
    }

    function leave(uint256 seed) external {
        vm.prank(_who(seed));
        try circle.leave() {} catch {}
        calls++;
    }

    function pay(uint256 seed) external {
        vm.prank(_who(seed));
        try circle.pay() {} catch {}
        calls++;
    }

    function order(uint256 seed, uint16 rounds) external {
        vm.prank(_who(seed));
        try circle.setStandingOrder(uint16(bound(rounds, 1, 5)), uint64(block.timestamp + 20 days)) {} catch {}
        calls++;
    }

    function collect(uint256 seed) external {
        try circle.collect(_who(seed)) {} catch {}
        calls++;
    }

    function bid(uint256 seed, uint256 discount) external {
        vm.prank(_who(seed));
        try circle.bid(bound(discount, 0, 20e6)) {} catch {}
        calls++;
    }

    function close() external {
        try circle.closeAuction() {} catch {}
        calls++;
    }

    function approve(uint256 seed) external {
        vm.prank(_who(seed));
        try circle.approveRelease() {} catch {}
        calls++;
    }

    function release() external {
        try circle.release() {
            releases++;
        } catch {}
        calls++;
    }

    function changePayee(uint256 seed, uint256 to) external {
        vm.prank(_who(seed));
        try circle.requestPayeeChange(_who(to), "moved") {} catch {}
        calls++;
    }

    function cancel() external {
        try circle.cancelUnfilled() {} catch {}
        calls++;
    }

    function dissolve() external {
        try circle.dissolve() {} catch {}
        calls++;
    }

    function withdraw(uint256 seed) external {
        try circle.withdrawFor(_who(seed)) {} catch {}
        calls++;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 30 hours));
        calls++;
    }

    /// One step that moves the circle forward; listed several times so random runs go deep.
    function _advance(uint256 seed) internal {
        calls++;
        BiuWuiCircle.Phase ph = circle.phase();
        if (ph == BiuWuiCircle.Phase.Forming) {
            for (uint256 i; i < people.length; ++i) {
                address m = people[(seed + i) % people.length];
                if (circle.isMember(m)) continue;
                vm.startPrank(m);
                usd.approve(address(circle), type(uint256).max);
                try circle.join("member", m) {
                    joins++;
                } catch {}
                vm.stopPrank();
                return;
            }
            return;
        }
        if (ph != BiuWuiCircle.Phase.Running) return;
        uint256 r = circle.currentRound();
        BiuWuiCircle.Round memory rd = circle.getRound(r);
        address[] memory ms = circle.members();
        if (!rd.closed && block.timestamp <= rd.bidEnd) {
            for (uint256 i; i < ms.length; ++i) {
                if (circle.paid(r, ms[i]) || (seed >> i) & 1 == 0) continue;
                vm.prank(ms[i]);
                try circle.pay() {} catch {}
            }
            vm.warp(rd.bidEnd + 1);
        } else if (!rd.closed) {
            try circle.closeAuction() {} catch {}
        } else {
            for (uint256 i; i < ms.length && circle.getRound(r).approvals < circle.quorumNeeded(); ++i) {
                vm.prank(ms[i]);
                try circle.approveRelease() {} catch {}
            }
            try circle.release() {
                releases++;
            } catch {}
        }
    }

    function advanceA(uint256 seed) external {
        _advance(seed);
    }

    function advanceB(uint256 seed) external {
        _advance(seed);
    }

    function advanceC(uint256 seed) external {
        _advance(seed);
    }

    function advanceD(uint256 seed) external {
        _advance(seed);
    }
}

contract InvariantTest is Test {
    MockUSD8 internal usd;
    BiuWuiCircle internal circle;
    Handler internal handler;
    address internal organiser = makeAddr("organiser");
    address[] internal people;
    uint256 internal supply;

    function setUp() public {
        usd = new MockUSD8();
        BiuWuiFactory factory = new BiuWuiFactory(address(usd), address(new BiuWuiCircle()));
        for (uint256 i; i < 6; ++i) {
            address a = makeAddr(string(abi.encodePacked("p", vm.toString(i))));
            people.push(a);
            usd.mint(a, 500e6);
        }
        supply = usd.totalSupply();
        vm.prank(organiser);
        circle = factory.createCircle(
            BiuWuiCircle.Params({
                token: address(usd),
                share: 10e6,
                size: 4,
                joinWindow: 2 days,
                roundLength: 1 days,
                graceLength: 1 days,
                payeeDelay: 1 days,
                maxDiscountBps: 4000,
                feeBps: 300,
                quorumBps: 5001,
                securityBps: 6000,
                name: "fuzz"
            })
        );
        handler = new Handler(circle, usd, people);
        targetContract(address(handler));
    }

    function afterInvariant() public view {
        console.log("phase", uint8(circle.phase()), "releases", handler.releases());
    }

    /// Money is never created or destroyed: it is only ever in members' wallets, the organiser's
    /// wallet or the circle.
    function invariant_conservation() public view {
        uint256 sum = usd.balanceOf(address(circle)) + usd.balanceOf(organiser);
        for (uint256 i; i < people.length; ++i) {
            sum += usd.balanceOf(people[i]);
        }
        assertEq(sum, supply);
    }

    /// The circle can always pay every dividend and security it owes.
    function invariant_solvent() public view {
        assertGe(usd.balanceOf(address(circle)), circle.totalClaimable() + circle.totalSecurity());
    }

    /// Nobody wins twice, and the round number never passes the circle size.
    function invariant_rounds() public view {
        assertLe(circle.currentRound(), circle.size());
        uint256 winners;
        for (uint256 i; i < people.length; ++i) {
            if (circle.hasWon(people[i])) winners++;
        }
        uint256 r = circle.currentRound();
        if (r == 0) assertEq(winners, 0);
        else assertLe(winners, r);
    }

    /// While running, what is withdrawable never exceeds the balance.
    function invariant_withdrawableCovered() public view {
        uint256 owed;
        for (uint256 i; i < people.length; ++i) {
            if (circle.isMember(people[i])) owed += circle.withdrawable(people[i]);
        }
        assertLe(owed, usd.balanceOf(address(circle)));
    }
}
