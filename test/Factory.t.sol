// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SovereignBase} from "./SovereignBase.t.sol";
import {SovereignCircle} from "../src/SovereignCircle.sol";
import {SovereignFactory} from "../src/SovereignFactory.sol";
import {MockUSD8} from "./mocks/MockUSD8.sol";

contract FactoryTest is SovereignBase {
    function test_FactoryListsCircles() public view {
        assertEq(factory.circleCount(), 1);
        assertTrue(factory.isCircle(address(circle)));
        assertEq(address(factory.circlesOf(organiser)[0]), address(circle));
        assertEq(circle.organiser(), organiser);
        assertEq(circle.name(), "Family Circle");
    }

    function test_FactoryForcesItsOwnToken() public {
        SovereignCircle.Params memory p = defaultParams();
        p.token = address(new MockUSD8());
        SovereignCircle c = openCircle(p);
        assertEq(address(c.token()), address(usd));
    }

    function test_CloneCannotBeInitializedTwice() public {
        vm.expectRevert(SovereignCircle.AlreadyInitialized.selector);
        circle.initialize(defaultParams(), address(this));
    }

    function test_ImplementationCannotBeInitialized() public {
        vm.expectRevert(SovereignCircle.AlreadyInitialized.selector);
        impl.initialize(defaultParams(), address(this));
    }

    function _openSig(uint256 k, address org, SovereignCircle.Params memory p, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    factory.OPEN_TYPEHASH(), org, p.share, p.size, p.joinWindow, p.roundLength, p.graceLength, p.payeeDelay
                ),
                abi.encode(
                    p.maxDiscountBps, p.feeBps, p.quorumBps, p.securityBps, keccak256(bytes(p.name)), factory.nonces(org), deadline
                )
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Sovereign Factory"),
                keccak256("1"),
                block.chainid,
                address(factory)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_GaslessOpenMakesSignerTheOrganiser() public {
        SovereignCircle.Params memory p = defaultParams();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _openSig(keys[3], people[3], p, deadline);
        vm.prank(relayer);
        SovereignCircle c = factory.createCircleWithSig(p, people[3], deadline, sig);
        assertEq(c.organiser(), people[3]);
        assertTrue(factory.isCircle(address(c)));
        // replay fails (nonce used), and a relayer cannot change any parameter
        vm.expectRevert(SovereignFactory.BadSignature.selector);
        factory.createCircleWithSig(p, people[3], deadline, sig);
        p.feeBps = 500;
        sig = _openSig(keys[3], people[3], defaultParams(), deadline);
        vm.expectRevert(SovereignFactory.BadSignature.selector);
        factory.createCircleWithSig(p, people[3], deadline, sig);
    }

    function test_BadParamsRejected() public {
        SovereignCircle.Params memory p = defaultParams();
        p.size = 1;
        vm.expectRevert(abi.encodeWithSelector(SovereignCircle.BadParams.selector, uint8(2)));
        openCircle(p);
        p = defaultParams();
        p.feeBps = 501;
        vm.expectRevert(abi.encodeWithSelector(SovereignCircle.BadParams.selector, uint8(8)));
        openCircle(p);
        p = defaultParams();
        p.quorumBps = 5000;
        vm.expectRevert(abi.encodeWithSelector(SovereignCircle.BadParams.selector, uint8(9)));
        openCircle(p);
    }
}
