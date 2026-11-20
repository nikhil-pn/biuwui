// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {BiuWuiCircle} from "./BiuWuiCircle.sol";

/// @title BiuWuiFactory
/// @notice Opens Biu Wui circles in one stablecoin (tUSD8 on Aevum) and lists them. It has no owner
/// and holds no money: each circle is its own contract with its own pot. `isCircle` lets the relayer
/// and the app refuse anything this factory did not create.
contract BiuWuiFactory {
    address public immutable token;
    /// @notice The circle code every clone runs. It cannot be initialized itself.
    address public immutable implementation;

    BiuWuiCircle[] internal _circles;
    mapping(address => BiuWuiCircle[]) internal _byOrganiser;
    mapping(address => bool) public isCircle;

    event CircleCreated(address indexed circle, address indexed organiser, string name);

    error ZeroAddress();

    constructor(address token_, address implementation_) {
        if (token_ == address(0) || implementation_ == address(0)) revert ZeroAddress();
        token = token_;
        implementation = implementation_;
    }

    /// @notice Open a new circle with the caller as organiser. The token is always this factory's.
    function createCircle(BiuWuiCircle.Params calldata params) external returns (BiuWuiCircle circle) {
        BiuWuiCircle.Params memory p = params;
        p.token = token;
        // A minimal clone (EIP-1167), created and initialized in one transaction so nobody can
        // initialize it first.
        circle = BiuWuiCircle(Clones.clone(implementation));
        circle.initialize(p, msg.sender);
        _circles.push(circle);
        _byOrganiser[msg.sender].push(circle);
        isCircle[address(circle)] = true;
        emit CircleCreated(address(circle), msg.sender, p.name);
    }

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    /// @notice All circles, oldest first.
    function circles() external view returns (BiuWuiCircle[] memory) {
        return _circles;
    }

    /// @notice Circles opened by `organiser`.
    function circlesOf(address organiser) external view returns (BiuWuiCircle[] memory) {
        return _byOrganiser[organiser];
    }
}
