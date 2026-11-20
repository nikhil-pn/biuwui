// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BiuWuiBase} from "./BiuWuiBase.t.sol";
import {BiuWuiCircle} from "../src/BiuWuiCircle.sol";
import {MockUSD8} from "./mocks/MockUSD8.sol";

contract FactoryTest is BiuWuiBase {
    function test_FactoryListsCircles() public view {
        assertEq(factory.circleCount(), 1);
        assertTrue(factory.isCircle(address(circle)));
        assertEq(address(factory.circlesOf(organiser)[0]), address(circle));
        assertEq(circle.organiser(), organiser);
        assertEq(circle.name(), "Sham Shui Po Biu Wui");
    }

    function test_FactoryForcesItsOwnToken() public {
        BiuWuiCircle.Params memory p = defaultParams();
        p.token = address(new MockUSD8());
        BiuWuiCircle c = openCircle(p);
        assertEq(address(c.token()), address(usd));
    }

    function test_CloneCannotBeInitializedTwice() public {
        vm.expectRevert(BiuWuiCircle.AlreadyInitialized.selector);
        circle.initialize(defaultParams(), address(this));
    }

    function test_ImplementationCannotBeInitialized() public {
        vm.expectRevert(BiuWuiCircle.AlreadyInitialized.selector);
        impl.initialize(defaultParams(), address(this));
    }

    function test_BadParamsRejected() public {
        BiuWuiCircle.Params memory p = defaultParams();
        p.size = 1;
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.BadParams.selector, uint8(2)));
        openCircle(p);
        p = defaultParams();
        p.feeBps = 501;
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.BadParams.selector, uint8(8)));
        openCircle(p);
        p = defaultParams();
        p.quorumBps = 5000;
        vm.expectRevert(abi.encodeWithSelector(BiuWuiCircle.BadParams.selector, uint8(9)));
        openCircle(p);
    }
}
