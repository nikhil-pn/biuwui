// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {SovereignCircle} from "../src/SovereignCircle.sol";
import {SovereignFactory} from "../src/SovereignFactory.sol";

/// @notice Deploys the circle implementation and the factory. On Aevum the token is the real tUSD8.
/// Set IMPLEMENTATION=<address> to reuse an existing circle implementation.
/// Run (legacy transactions, as on QDay's own faucet):
///   forge script script/Deploy.s.sol --rpc-url aevum --broadcast --legacy --account <keystore>
contract Deploy is Script {
    address internal constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;

    function run() external returns (SovereignFactory factory, SovereignCircle implementation) {
        address token = vm.envOr("TOKEN", TUSD8);
        address existing = vm.envOr("IMPLEMENTATION", address(0));
        vm.startBroadcast();
        implementation = existing == address(0) ? new SovereignCircle() : SovereignCircle(existing);
        factory = new SovereignFactory(token, address(implementation));
        vm.stopBroadcast();
        console.log("implementation", address(implementation));
        console.log("factory", address(factory));
        console.log("token", token);
    }
}
