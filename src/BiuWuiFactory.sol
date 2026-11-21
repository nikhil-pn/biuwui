// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {BiuWuiCircle} from "./BiuWuiCircle.sol";

/// @title BiuWuiFactory
/// @notice Opens Biu Wui circles in one stablecoin (tUSD8 on Aevum) and lists them. It has no owner
/// and holds no money: each circle is its own contract with its own pot. `isCircle` lets the relayer
/// and the app refuse anything this factory did not create.
contract BiuWuiFactory is EIP712, Nonces {
    address public immutable token;
    /// @notice The circle code every clone runs. It cannot be initialized itself.
    address public immutable implementation;

    BiuWuiCircle[] internal _circles;
    mapping(address => BiuWuiCircle[]) internal _byOrganiser;
    mapping(address => bool) public isCircle;

    event CircleCreated(address indexed circle, address indexed organiser, string name);

    error ZeroAddress();
    error SignatureExpired(uint256 deadline);
    error BadSignature();

    /// @notice What an organiser signs to open a circle without paying gas.
    bytes32 public constant OPEN_TYPEHASH = keccak256(
        "OpenCircle(address organiser,uint256 share,uint8 size,uint32 joinWindow,uint32 roundLength,uint32 graceLength,uint32 payeeDelay,uint16 maxDiscountBps,uint16 feeBps,uint16 quorumBps,uint16 securityBps,string name,uint256 nonce,uint256 deadline)"
    );

    constructor(address token_, address implementation_) EIP712("Biu Wui Factory", "1") {
        if (token_ == address(0) || implementation_ == address(0)) revert ZeroAddress();
        token = token_;
        implementation = implementation_;
    }

    /// @notice Open a new circle with the caller as organiser. The token is always this factory's.
    function createCircle(BiuWuiCircle.Params calldata params) external returns (BiuWuiCircle circle) {
        return _create(params, msg.sender);
    }

    /// @notice Gasless: open a circle for `organiser`, who signed an EIP-712 `OpenCircle` message.
    /// Anyone (the relayer) may submit it; the organiser, not the submitter, becomes the organiser.
    function createCircleWithSig(
        BiuWuiCircle.Params calldata params,
        address organiser,
        uint256 deadline,
        bytes calldata sig
    ) external returns (BiuWuiCircle circle) {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    OPEN_TYPEHASH,
                    organiser,
                    params.share,
                    params.size,
                    params.joinWindow,
                    params.roundLength,
                    params.graceLength,
                    params.payeeDelay
                ),
                abi.encode(
                    params.maxDiscountBps,
                    params.feeBps,
                    params.quorumBps,
                    params.securityBps,
                    keccak256(bytes(params.name)),
                    _useNonce(organiser),
                    deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(organiser, _hashTypedDataV4(structHash), sig)) revert BadSignature();
        return _create(params, organiser);
    }

    function _create(BiuWuiCircle.Params calldata params, address organiser) internal returns (BiuWuiCircle circle) {
        BiuWuiCircle.Params memory p = params;
        p.token = token;
        // A minimal clone (EIP-1167), created and initialized in one transaction so nobody can
        // initialize it first.
        circle = BiuWuiCircle(Clones.clone(implementation));
        circle.initialize(p, organiser);
        _circles.push(circle);
        _byOrganiser[organiser].push(circle);
        isCircle[address(circle)] = true;
        emit CircleCreated(address(circle), organiser, p.name);
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
