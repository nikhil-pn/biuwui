// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStablecoin} from "./interfaces/IStablecoin.sol";

/// @title SovereignCircle
/// @notice One Sovereign circle: a savings circle where members bid for the pot. Every round each member
/// pays the same share. Members bid the discount they accept, the highest discount takes the pot, and
/// the discount is shared out as a dividend to everyone. Each member gets the pot exactly once.
///
/// How it stays safe:
/// - No owner, no admin, no upgrade. The organiser only receives a capped fee.
/// - The pot can only go to the winner's locked payee. Changing a payee takes `payeeDelay`, and every
///   member sees the change coming, so a stolen key cannot quietly redirect a pot.
/// - Members never need gas: every action has a signed version a relayer can submit
///   (EIP-3009 for money in, EIP-712 for everything else).
/// - A standing order lets anyone collect exactly one share per round from a member, at most
///   `maxRounds` times, until it expires or the member revokes it.
/// - Joining is a pledge: the first share is paid on joining. If the circle is not full by `joinBy`,
///   anyone can cancel it and every pledge goes back.
/// - If a round stalls, any member can dissolve the circle and the money left goes back pro rata.
contract SovereignCircle is EIP712, Nonces, ReentrancyGuard {
    // ---------------------------------------------------------------- limits

    /// @notice At most 50 members, so every per-member loop stays cheap.
    uint8 public constant MAX_MEMBERS = 50;
    /// @notice Discount cap: 40% of the pot, as India's Chit Funds Act 1982 allows.
    uint16 public constant MAX_DISCOUNT_CAP_BPS = 4000;
    /// @notice Organiser fee cap: 5% of the pot (the Act's s.21(1)(b) foreman cap; a 2019 amendment allows 7%).
    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice Display names are 1 to 32 bytes.
    uint256 public constant MAX_NAME_BYTES = 32;

    // ---------------------------------------------------------------- signed actions (EIP-712)

    bytes32 public constant BID_TYPEHASH =
        keccak256("Bid(address member,uint256 round,uint256 discount,uint256 nonce,uint256 deadline)");
    bytes32 public constant APPROVE_TYPEHASH =
        keccak256("ApproveRelease(address member,uint256 round,uint256 nonce,uint256 deadline)");
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "StandingOrder(address member,uint256 maxRounds,uint256 expiresAt,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant REVOKE_TYPEHASH =
        keccak256("RevokeStandingOrder(address member,uint256 nonce,uint256 deadline)");
    bytes32 public constant PAYEE_TYPEHASH =
        keccak256("ChangePayee(address member,address payout,string name,uint256 nonce,uint256 deadline)");
    bytes32 public constant CANCEL_PAYEE_TYPEHASH =
        keccak256("CancelPayeeChange(address member,uint256 nonce,uint256 deadline)");
    bytes32 public constant LEAVE_TYPEHASH = keccak256("Leave(address member,uint256 nonce,uint256 deadline)");

    /// @dev Tags that bind an EIP-3009 authorization to one action in this circle.
    bytes32 private constant JOIN_TAG = keccak256("SOVEREIGN-JOIN-V1");
    bytes32 private constant PAY_TAG = keccak256("SOVEREIGN-PAY-V1");

    // ---------------------------------------------------------------- types

    enum Phase {
        Forming,
        Running,
        Completed,
        Dissolved,
        Cancelled
    }

    struct Params {
        address token;
        uint256 share;
        uint8 size;
        uint32 joinWindow;
        uint32 roundLength;
        uint32 graceLength;
        uint32 payeeDelay;
        uint16 maxDiscountBps;
        uint16 feeBps;
        uint16 quorumBps;
        uint16 securityBps;
        string name;
    }

    struct Round {
        uint64 start;
        uint64 bidEnd;
        uint64 closedAt;
        address bestBidder;
        uint256 bestDiscount;
        uint256 collected;
        address winner;
        address payTo;
        uint256 discount;
        uint16 approvals;
        bool closed;
        bool released;
    }

    struct Payee {
        address payout;
        string name;
        address pendingPayout;
        string pendingName;
        uint64 pendingAt;
    }

    struct StandingOrder {
        uint64 expiresAt;
        uint16 maxRounds;
        uint16 used;
        bool active;
    }

    /// @notice An EIP-3009 ReceiveWithAuthorization signature (value is always `share`, `to` this circle).
    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // ---------------------------------------------------------------- config

    // Set once by `initialize` (each circle is a minimal clone of one implementation).
    IStablecoin public token;
    uint8 public size;
    uint16 public maxDiscountBps;
    uint16 public feeBps;
    uint16 public quorumBps;
    uint16 public securityBps;
    uint32 public roundLength;
    uint32 public graceLength;
    address public organiser;
    uint64 public joinBy;
    uint32 public payeeDelay;
    bool public initialized;
    uint256 public share;
    string public name;

    // ---------------------------------------------------------------- state

    Phase public phase;
    uint256 public currentRound;
    address[] internal _members;

    mapping(address => bool) public isMember;
    mapping(address => bool) public hasWon;
    mapping(address => uint256) public paidIn;
    mapping(address => uint256) public paidOut;
    mapping(address => uint256) public claimable;
    mapping(address => uint256) public security;
    mapping(address => uint256) public onTimeRounds;
    mapping(address => Payee) internal _payees;
    mapping(address => StandingOrder) internal _orders;

    uint256 public totalClaimable;
    uint256 public totalSecurity;

    mapping(uint256 => Round) internal _rounds;
    mapping(uint256 => mapping(address => bool)) public paid;
    mapping(uint256 => mapping(address => bool)) public approved;

    uint256 public refundPool;
    uint256 public refundBase;
    mapping(address => bool) public refunded;

    // ---------------------------------------------------------------- errors

    /// @notice A setup parameter is out of range. `field`: 0 token, 1 share, 2 size, 3 joinWindow,
    /// 4 roundLength, 5 graceLength, 6 payeeDelay, 7 maxDiscountBps, 8 feeBps, 9 quorumBps,
    /// 10 securityBps, 11 name.
    error BadParams(uint8 field);
    error AlreadyInitialized();
    error WrongPhase(Phase expected, Phase actual);
    error NotMember(address account);
    error AlreadyMember(address account);
    error CircleFull();
    error BadName();
    error ZeroAddress();
    error AlreadyPaid(uint256 round);
    error TooLate(uint256 round);
    error TooEarly(uint256 round);
    error NotEligible(address account);
    error DiscountTooHigh(uint256 discount, uint256 max);
    error BidNotHigher(uint256 discount, uint256 best);
    error AlreadyClosed(uint256 round);
    error NotClosed(uint256 round);
    error AlreadyApproved(uint256 round);
    error AlreadyReleased(uint256 round);
    error NoQuorum(uint16 approvals, uint16 needed);
    error NoWinner(uint256 round);
    error NotStalled();
    error NothingToWithdraw();
    error SignatureExpired(uint256 deadline);
    error BadSignature();
    error NoStandingOrder(address member);
    error StandingOrderUsedUp(address member);
    error StandingOrderExpired(address member);
    error BadStandingOrder();
    error NoPendingPayee(address member);
    error JoinWindowOpen();
    error JoinWindowClosed();
    error TokenCallFailed();

    // ---------------------------------------------------------------- events

    event CircleOpened(
        address indexed organiser, address indexed token, uint256 share, uint8 size, uint64 joinBy, string name
    );
    event Joined(address indexed member, uint256 index, address payout, string payeeName);
    event Left(address indexed member, uint256 refund);
    event Cancelled(uint256 members, uint256 pledged);
    event RoundStarted(uint256 indexed round, uint64 start, uint64 bidEnd);
    event Paid(uint256 indexed round, address indexed member, uint256 amount, uint8 how);
    event Bid(uint256 indexed round, address indexed member, uint256 discount);
    event SecurityApplied(uint256 indexed round, address indexed member, uint256 amount);
    event AuctionClosed(
        uint256 indexed round, address indexed winner, address payTo, uint256 discount, uint256 collected
    );
    event Approved(uint256 indexed round, address indexed member, uint16 approvals);
    event Released(
        uint256 indexed round,
        address indexed winner,
        address payTo,
        uint256 payout,
        uint256 discount,
        uint256 fee,
        uint256 securityHeld
    );
    event Completed();
    event StandingOrderSet(address indexed member, uint16 maxRounds, uint64 expiresAt);
    event StandingOrderRevoked(address indexed member);
    event PayeeChangeRequested(address indexed member, address payout, string payeeName, uint64 effectiveAt);
    event PayeeChangeCancelled(address indexed member);
    event PayeeChanged(address indexed member, address payout, string payeeName);
    event Withdrawn(address indexed member, address indexed to, uint256 amount);
    event Dissolved(uint256 indexed round, uint256 refundPool, uint256 refundBase);

    /// @dev How a share was paid, for the `Paid` event: 0 approve+pay, 1 signed (gasless), 2 standing order,
    /// 3 pledge on joining, 4 covered from the member's held security.
    uint8 internal constant HOW_DIRECT = 0;
    uint8 internal constant HOW_SIGNED = 1;
    uint8 internal constant HOW_ORDER = 2;
    uint8 internal constant HOW_PLEDGE = 3;
    uint8 internal constant HOW_SECURITY = 4;

    // ---------------------------------------------------------------- setup

    /// @dev The implementation itself can never be initialized; only its clones can, once each.
    constructor() EIP712("Sovereign", "1") {
        initialized = true;
    }

    /// @notice Set up a new circle. The factory calls this in the same transaction that creates the clone.
    function initialize(Params calldata p, address organiser_) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        if (p.token == address(0) || organiser_ == address(0)) revert ZeroAddress();
        // A call to an address with no code "succeeds" with empty return data.
        if (p.token.code.length == 0) revert BadParams(0);
        if (p.share == 0) revert BadParams(1);
        if (p.size < 2 || p.size > MAX_MEMBERS) revert BadParams(2);
        if (p.joinWindow < 60) revert BadParams(3);
        if (p.roundLength < 60) revert BadParams(4);
        if (p.graceLength < 60) revert BadParams(5);
        if (p.payeeDelay < 60) revert BadParams(6);
        if (p.maxDiscountBps > MAX_DISCOUNT_CAP_BPS) revert BadParams(7);
        if (p.feeBps > MAX_FEE_BPS) revert BadParams(8);
        if (p.quorumBps <= 5000 || p.quorumBps > 10000) revert BadParams(9);
        if (p.securityBps > 10000) revert BadParams(10);
        if (bytes(p.name).length == 0 || bytes(p.name).length > 64) revert BadParams(11);

        token = IStablecoin(p.token);
        organiser = organiser_;
        share = p.share;
        size = p.size;
        joinBy = uint64(block.timestamp) + p.joinWindow;
        roundLength = p.roundLength;
        graceLength = p.graceLength;
        payeeDelay = p.payeeDelay;
        maxDiscountBps = p.maxDiscountBps;
        feeBps = p.feeBps;
        quorumBps = p.quorumBps;
        securityBps = p.securityBps;
        name = p.name;

        emit CircleOpened(organiser_, p.token, p.share, p.size, joinBy, p.name);
    }

    modifier inPhase(Phase expected) {
        if (phase != expected) revert WrongPhase(expected, phase);
        _;
    }

    modifier onlyMember(address account) {
        if (!isMember[account]) revert NotMember(account);
        _;
    }

    // ---------------------------------------------------------------- views

    /// @notice Members in the order they joined.
    function members() external view returns (address[] memory) {
        return _members;
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function getRound(uint256 r) external view returns (Round memory) {
        return _rounds[r];
    }

    /// @notice The pot when everyone pays.
    function chitAmount() public view returns (uint256) {
        return share * size;
    }

    /// @notice The highest discount a bid may offer.
    function maxDiscount() public view returns (uint256) {
        return (chitAmount() * maxDiscountBps) / 10000;
    }

    /// @notice Approvals a release needs.
    function quorumNeeded() public view returns (uint16) {
        return uint16((uint256(size) * quorumBps + 9999) / 10000);
    }

    /// @notice Who `m` is paid to right now: the address and the name members see.
    function payeeOf(address m) public view returns (address payout, string memory payeeName) {
        Payee storage p = _payees[m];
        if (p.pendingAt != 0 && block.timestamp >= p.pendingAt) return (p.pendingPayout, p.pendingName);
        return (p.payout, p.name);
    }

    /// @notice A payee change waiting out its delay (zero address if none).
    function pendingPayeeOf(address m)
        external
        view
        returns (address payout, string memory payeeName, uint64 effectiveAt)
    {
        Payee storage p = _payees[m];
        if (p.pendingAt == 0 || block.timestamp >= p.pendingAt) return (address(0), "", 0);
        return (p.pendingPayout, p.pendingName, p.pendingAt);
    }

    function standingOrderOf(address m) external view returns (StandingOrder memory) {
        return _orders[m];
    }

    /// @notice True if `collect(m)` would succeed now (ignoring the member's token balance).
    function canCollect(address m) public view returns (bool) {
        if (phase != Phase.Running || !isMember[m]) return false;
        StandingOrder storage o = _orders[m];
        if (!o.active || o.used >= o.maxRounds || block.timestamp > o.expiresAt) return false;
        Round storage rd = _rounds[currentRound];
        if (paid[currentRound][m] || rd.closed || block.timestamp > rd.bidEnd) return false;
        return token.allowance(m, address(this)) >= share;
    }

    /// @notice The EIP-3009 nonce `member` signs to join with `payout` and `payeeName`. It binds the
    /// signature to this circle and to those exact details, so a relayer cannot change them.
    function joinNonce(address member, address payout, string calldata payeeName) public view returns (bytes32) {
        return keccak256(abi.encode(JOIN_TAG, address(this), member, payout, keccak256(bytes(payeeName))));
    }

    /// @notice The EIP-3009 nonce `member` signs to pay round `r` of this circle.
    function payNonce(address member, uint256 r) public view returns (bytes32) {
        return keccak256(abi.encode(PAY_TAG, address(this), member, r));
    }

    // ---------------------------------------------------------------- joining (a pledge)

    /// @notice Join by pledging the first share (approve this circle first). `payout` and `payeeName`
    /// are where and to whom your pot and refunds go; changing them later takes `payeeDelay`.
    function join(string calldata payeeName, address payout) external nonReentrant inPhase(Phase.Forming) {
        _join(msg.sender, payeeName, payout);
        _pull(msg.sender, share);
    }

    /// @notice Gasless join: `member` signed an EIP-3009 ReceiveWithAuthorization for exactly `share`,
    /// to this circle, with nonce `joinNonce(member, payout, payeeName)`. Anyone may submit it.
    function joinWithAuthorization(
        address member,
        string calldata payeeName,
        address payout,
        Authorization calldata auth
    ) external nonReentrant inPhase(Phase.Forming) {
        _join(member, payeeName, payout);
        _receive(member, joinNonce(member, payout, payeeName), auth);
    }

    function _join(address m, string calldata payeeName, address payout) internal {
        if (block.timestamp > joinBy) revert JoinWindowClosed();
        if (isMember[m]) revert AlreadyMember(m);
        if (_members.length >= size) revert CircleFull();
        if (payout == address(0)) revert ZeroAddress();
        uint256 len = bytes(payeeName).length;
        if (len == 0 || len > MAX_NAME_BYTES) revert BadName();

        isMember[m] = true;
        _members.push(m);
        _payees[m].payout = payout;
        _payees[m].name = payeeName;

        // The pledge is the first round's share.
        paid[1][m] = true;
        paidIn[m] += share;
        onTimeRounds[m] += 1;
        _rounds[1].collected += share;

        emit Joined(m, _members.length - 1, payout, payeeName);
        emit Paid(1, m, share, HOW_PLEDGE);

        if (_members.length == size) {
            phase = Phase.Running;
            _startRound(1);
        }
    }

    /// @notice Leave before the circle is full and take your pledge back (to your payee).
    function leave() external nonReentrant inPhase(Phase.Forming) onlyMember(msg.sender) {
        _leave(msg.sender);
    }

    function leaveWithSig(address member, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        inPhase(Phase.Forming)
        onlyMember(member)
    {
        _checkSig(member, keccak256(abi.encode(LEAVE_TYPEHASH, member, _useNonce(member), deadline)), deadline, sig);
        _leave(member);
    }

    function _leave(address m) internal {
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            if (_members[i] == m) {
                _members[i] = _members[n - 1];
                _members.pop();
                break;
            }
        }
        isMember[m] = false;
        paid[1][m] = false;
        onTimeRounds[m] -= 1;
        _rounds[1].collected -= share;
        uint256 refund = paidIn[m];
        paidIn[m] = 0;
        (address to,) = payeeOf(m);
        delete _payees[m];
        delete _orders[m];
        emit Left(m, refund);
        _push(to, refund);
    }

    /// @notice If the circle did not fill by `joinBy`, anyone can cancel it. Every pledge can then be
    /// withdrawn in full.
    function cancelUnfilled() external inPhase(Phase.Forming) {
        if (block.timestamp <= joinBy) revert JoinWindowOpen();
        phase = Phase.Cancelled;
        emit Cancelled(_members.length, _rounds[1].collected);
    }

    function _startRound(uint256 r) internal {
        currentRound = r;
        uint64 start = uint64(block.timestamp);
        uint64 bidEnd = start + roundLength;
        _rounds[r].start = start;
        _rounds[r].bidEnd = bidEnd;
        emit RoundStarted(r, start, bidEnd);
    }

    // ---------------------------------------------------------------- paying

    /// @notice Pay this round's share (approve this circle first). Open until bidding ends.
    function pay() external nonReentrant inPhase(Phase.Running) onlyMember(msg.sender) {
        _recordPay(msg.sender, HOW_DIRECT);
        _pull(msg.sender, share);
    }

    /// @notice Gasless payment of the current round: `member` signed an EIP-3009
    /// ReceiveWithAuthorization for exactly `share`, to this circle, with nonce `payNonce(member, round)`.
    function payWithAuthorization(address member, Authorization calldata auth)
        external
        nonReentrant
        inPhase(Phase.Running)
        onlyMember(member)
    {
        uint256 round = currentRound;
        _recordPay(member, HOW_SIGNED);
        _receive(member, payNonce(member, round), auth);
    }

    function _receive(address from, bytes32 nonce, Authorization calldata a) internal {
        token.receiveWithAuthorization(from, address(this), share, a.validAfter, a.validBefore, nonce, a.v, a.r, a.s);
    }

    /// @notice Collect this round's share from `member` under their standing order. Anyone may call
    /// it (the circle secretary bot does). It can only ever move exactly one share from the member
    /// into this circle, once per round, within the order's limits.
    function collect(address member) external nonReentrant inPhase(Phase.Running) onlyMember(member) {
        StandingOrder storage o = _orders[member];
        if (!o.active) revert NoStandingOrder(member);
        if (block.timestamp > o.expiresAt) revert StandingOrderExpired(member);
        if (o.used >= o.maxRounds) revert StandingOrderUsedUp(member);
        o.used += 1;
        _recordPay(member, HOW_ORDER);
        _pull(member, share);
    }

    function _recordPay(address m, uint8 how) internal {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (paid[r][m]) revert AlreadyPaid(r);
        if (rd.closed || block.timestamp > rd.bidEnd) revert TooLate(r);
        paid[r][m] = true;
        rd.collected += share;
        paidIn[m] += share;
        onTimeRounds[m] += 1;
        emit Paid(r, m, share, how);
    }

    // ---------------------------------------------------------------- standing orders

    /// @notice Let the circle collect your share each round, at most `maxRounds` times, until
    /// `expiresAt`. You also need a token allowance of `share * maxRounds` for this circle.
    function setStandingOrder(uint16 maxRounds, uint64 expiresAt) external onlyMember(msg.sender) {
        _setOrder(msg.sender, maxRounds, expiresAt);
    }

    /// @notice Gasless standing order: the member signs the order (EIP-712) and an EIP-2612 permit for
    /// `share * maxRounds`; anyone submits both in one transaction.
    /// @notice An EIP-2612 permit signature, kept in one struct to keep the stack small.
    struct PermitSig {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function setStandingOrderWithSig(
        address member,
        uint16 maxRounds,
        uint64 expiresAt,
        uint256 deadline,
        bytes calldata orderSig,
        PermitSig calldata permit
    ) external onlyMember(member) {
        _checkSig(
            member,
            keccak256(abi.encode(ORDER_TYPEHASH, member, maxRounds, expiresAt, _useNonce(member), deadline)),
            deadline,
            orderSig
        );
        // A front-runner may submit the permit first; then the allowance is already there.
        try token.permit(member, address(this), share * maxRounds, permit.deadline, permit.v, permit.r, permit.s) {}
            catch {}
        _setOrder(member, maxRounds, expiresAt);
    }

    function _setOrder(address m, uint16 maxRounds, uint64 expiresAt) internal {
        if (maxRounds == 0 || maxRounds > size || expiresAt <= block.timestamp) revert BadStandingOrder();
        _orders[m] = StandingOrder({expiresAt: expiresAt, maxRounds: maxRounds, used: 0, active: true});
        emit StandingOrderSet(m, maxRounds, expiresAt);
    }

    /// @notice Stop your standing order at once. (You can also set your token allowance to zero.)
    function revokeStandingOrder() external onlyMember(msg.sender) {
        _revoke(msg.sender);
    }

    function revokeStandingOrderWithSig(address member, uint256 deadline, bytes calldata sig)
        external
        onlyMember(member)
    {
        _checkSig(member, keccak256(abi.encode(REVOKE_TYPEHASH, member, _useNonce(member), deadline)), deadline, sig);
        _revoke(member);
    }

    function _revoke(address m) internal {
        _orders[m].active = false;
        emit StandingOrderRevoked(m);
    }

    // ---------------------------------------------------------------- payee lock

    /// @notice Ask to change where your pot and refunds go. It takes effect after `payeeDelay`, and
    /// every member is shown the new name and address while it waits. You can cancel it meanwhile.
    function requestPayeeChange(address payout, string calldata payeeName) external onlyMember(msg.sender) {
        _requestPayee(msg.sender, payout, payeeName);
    }

    function requestPayeeChangeWithSig(
        address member,
        address payout,
        string calldata payeeName,
        uint256 deadline,
        bytes calldata sig
    ) external onlyMember(member) {
        _checkSig(
            member,
            keccak256(
                abi.encode(
                    PAYEE_TYPEHASH, member, payout, keccak256(bytes(payeeName)), _useNonce(member), deadline
                )
            ),
            deadline,
            sig
        );
        _requestPayee(member, payout, payeeName);
    }

    function cancelPayeeChange() external onlyMember(msg.sender) {
        _cancelPayee(msg.sender);
    }

    function cancelPayeeChangeWithSig(address member, uint256 deadline, bytes calldata sig)
        external
        onlyMember(member)
    {
        _checkSig(
            member, keccak256(abi.encode(CANCEL_PAYEE_TYPEHASH, member, _useNonce(member), deadline)), deadline, sig
        );
        _cancelPayee(member);
    }

    function _requestPayee(address m, address payout, string calldata payeeName) internal {
        if (payout == address(0)) revert ZeroAddress();
        uint256 len = bytes(payeeName).length;
        if (len == 0 || len > MAX_NAME_BYTES) revert BadName();
        _settlePayee(m);
        Payee storage p = _payees[m];
        p.pendingPayout = payout;
        p.pendingName = payeeName;
        p.pendingAt = uint64(block.timestamp) + payeeDelay;
        emit PayeeChangeRequested(m, payout, payeeName, p.pendingAt);
    }

    function _cancelPayee(address m) internal {
        _settlePayee(m);
        Payee storage p = _payees[m];
        if (p.pendingAt == 0) revert NoPendingPayee(m);
        p.pendingPayout = address(0);
        p.pendingName = "";
        p.pendingAt = 0;
        emit PayeeChangeCancelled(m);
    }

    /// @dev Make a matured change permanent in storage.
    function _settlePayee(address m) internal {
        Payee storage p = _payees[m];
        if (p.pendingAt != 0 && block.timestamp >= p.pendingAt) {
            p.payout = p.pendingPayout;
            p.name = p.pendingName;
            p.pendingPayout = address(0);
            p.pendingName = "";
            p.pendingAt = 0;
            emit PayeeChanged(m, p.payout, p.name);
        }
    }

    // ---------------------------------------------------------------- auction

    /// @notice Bid the discount you accept to take this round's pot. A higher discount wins.
    /// Only members who paid this round and have not won before can bid.
    function bid(uint256 discount) external inPhase(Phase.Running) onlyMember(msg.sender) {
        _bid(msg.sender, discount);
    }

    function bidWithSig(address member, uint256 discount, uint256 deadline, bytes calldata sig)
        external
        inPhase(Phase.Running)
        onlyMember(member)
    {
        _checkSig(
            member,
            keccak256(abi.encode(BID_TYPEHASH, member, currentRound, discount, _useNonce(member), deadline)),
            deadline,
            sig
        );
        _bid(member, discount);
    }

    function _bid(address m, uint256 discount) internal {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (rd.closed || block.timestamp > rd.bidEnd) revert TooLate(r);
        if (hasWon[m] || !paid[r][m]) revert NotEligible(m);
        uint256 cap = maxDiscount();
        if (discount > cap) revert DiscountTooHigh(discount, cap);
        if (rd.bestBidder != address(0) && discount <= rd.bestDiscount) {
            revert BidNotHigher(discount, rd.bestDiscount);
        }
        rd.bestBidder = m;
        rd.bestDiscount = discount;
        emit Bid(r, m, discount);
    }

    /// @notice Close the auction once bidding is over. Anyone can call it: the result follows fixed
    /// rules. Past winners who did not pay are covered from the security held back from their pot.
    /// With no bid, the earliest-joined eligible member takes the pot at no discount. The winner's
    /// payee is fixed here, so a payee change that matures later cannot touch this pot.
    function closeAuction() external inPhase(Phase.Running) {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (rd.closed) revert AlreadyClosed(r);
        if (block.timestamp <= rd.bidEnd) revert TooEarly(r);

        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            address m = _members[i];
            if (!paid[r][m] && hasWon[m] && security[m] >= share) {
                security[m] -= share;
                totalSecurity -= share;
                paid[r][m] = true;
                paidIn[m] += share;
                rd.collected += share;
                emit SecurityApplied(r, m, share);
                emit Paid(r, m, share, HOW_SECURITY);
            }
        }

        address winner = rd.bestBidder;
        uint256 discount = rd.bestDiscount;
        if (winner == address(0)) {
            for (uint256 i; i < n; ++i) {
                address m = _members[i];
                if (!hasWon[m] && paid[r][m]) {
                    winner = m;
                    break;
                }
            }
            discount = 0;
        }
        if (winner == address(0)) revert NoWinner(r);

        _settlePayee(winner);
        address payTo = _payees[winner].payout;
        rd.closed = true;
        rd.closedAt = uint64(block.timestamp);
        rd.winner = winner;
        rd.payTo = payTo;
        rd.discount = discount;
        hasWon[winner] = true;
        emit AuctionClosed(r, winner, payTo, discount, rd.collected);
    }

    // ---------------------------------------------------------------- release

    /// @notice What a release of round `r` pays out, split into its parts.
    function quotePayout(uint256 r)
        public
        view
        returns (uint256 payout, uint256 fee, uint256 dividend, uint256 securityHeld)
    {
        Round storage rd = _rounds[r];
        if (!rd.closed) revert NotClosed(r);
        uint256 pot = rd.collected;
        uint256 discount = rd.discount;
        fee = (pot * feeBps) / 10000;
        if (fee > discount) fee = discount;
        dividend = discount - fee;
        uint256 gross = pot - discount;
        uint256 futureDues = share * (uint256(size) - r);
        securityHeld = (gross * securityBps) / 10000;
        if (securityHeld > futureDues) securityHeld = futureDues;
        payout = gross - securityHeld;
    }

    /// @notice Approve releasing this round's pot to the winner's locked payee.
    function approveRelease() external inPhase(Phase.Running) onlyMember(msg.sender) {
        _approve(msg.sender);
    }

    function approveReleaseWithSig(address member, uint256 deadline, bytes calldata sig)
        external
        inPhase(Phase.Running)
        onlyMember(member)
    {
        _checkSig(
            member,
            keccak256(abi.encode(APPROVE_TYPEHASH, member, currentRound, _useNonce(member), deadline)),
            deadline,
            sig
        );
        _approve(member);
    }

    function _approve(address m) internal {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (!rd.closed) revert NotClosed(r);
        if (rd.released) revert AlreadyReleased(r);
        if (approved[r][m]) revert AlreadyApproved(r);
        approved[r][m] = true;
        rd.approvals += 1;
        emit Approved(r, m, rd.approvals);
    }

    /// @notice Release this round's pot once a quorum approved. Anyone may call it; the money can
    /// only go to the payee fixed when the auction closed.
    function release() external nonReentrant inPhase(Phase.Running) {
        uint256 r = currentRound;
        Round storage rd = _rounds[r];
        if (!rd.closed) revert NotClosed(r);
        if (rd.released) revert AlreadyReleased(r);
        uint16 needed = quorumNeeded();
        if (rd.approvals < needed) revert NoQuorum(rd.approvals, needed);

        address winner = rd.winner;
        (uint256 payout, uint256 fee, uint256 dividend, uint256 held) = quotePayout(r);
        rd.released = true;
        paidOut[winner] += payout;
        if (held != 0) {
            security[winner] += held;
            totalSecurity += held;
        }
        _shareDividend(dividend, winner);

        emit Released(r, winner, rd.payTo, payout, rd.discount, fee, held);
        if (r == size) {
            phase = Phase.Completed;
            emit Completed();
        } else {
            _startRound(r + 1);
        }

        if (payout != 0) _push(rd.payTo, payout);
        if (fee != 0) _push(organiser, fee);
    }

    function _shareDividend(uint256 dividend, address winner) internal {
        if (dividend == 0) return;
        uint256 n = _members.length;
        uint256 each = dividend / n;
        for (uint256 i; i < n; ++i) {
            claimable[_members[i]] += each;
        }
        claimable[winner] += dividend - each * n;
        totalClaimable += dividend;
    }

    // ---------------------------------------------------------------- withdrawing, dissolving

    /// @notice True if the current round has stalled long enough for the circle to be dissolved.
    function isStalled() public view returns (bool) {
        if (phase != Phase.Running) return false;
        Round storage rd = _rounds[currentRound];
        if (!rd.closed) return block.timestamp > uint256(rd.bidEnd) + graceLength;
        return !rd.released && block.timestamp > uint256(rd.closedAt) + graceLength;
    }

    /// @notice What a member put in minus what they took out (never below zero).
    function netContribution(address m) public view returns (uint256) {
        uint256 inAmt = paidIn[m];
        uint256 outAmt = paidOut[m];
        return inAmt > outAmt ? inAmt - outAmt : 0;
    }

    /// @notice A member's refund: the whole pledge if the circle was cancelled, a pro-rata share of
    /// what is left if it was dissolved.
    function refundShare(address m) public view returns (uint256) {
        if (refunded[m]) return 0;
        if (phase == Phase.Cancelled) return paidIn[m];
        if (phase != Phase.Dissolved || refundBase == 0) return 0;
        return (refundPool * netContribution(m)) / refundBase;
    }

    /// @notice What `m` can withdraw now.
    function withdrawable(address m) public view returns (uint256 amount) {
        amount = claimable[m];
        if (phase == Phase.Completed) amount += security[m];
        amount += refundShare(m);
    }

    /// @notice Pay out a member's dividends, security and refund. Anyone may call it (the bot does,
    /// so members need no gas); the money only ever goes to the member's own payee.
    function withdrawFor(address member) external nonReentrant onlyMember(member) {
        uint256 amount = claimable[member];
        if (amount != 0) {
            claimable[member] = 0;
            totalClaimable -= amount;
        }
        if (phase == Phase.Completed) {
            uint256 sec = security[member];
            if (sec != 0) {
                security[member] = 0;
                totalSecurity -= sec;
                amount += sec;
            }
        }
        uint256 refund = refundShare(member);
        if (refund != 0) {
            refunded[member] = true;
            amount += refund;
        }
        if (amount == 0) revert NothingToWithdraw();
        _settlePayee(member);
        address to = _payees[member].payout;
        emit Withdrawn(member, to, amount);
        _push(to, amount);
    }

    /// @notice Dissolve a stalled circle. Anyone can call it once a round has stalled for the grace
    /// period. Everything left except dividends already earned goes back in proportion to what each
    /// member put in minus took out. Security held back from past winners joins that pool: it exists
    /// to cover what winners still owe, so it goes to the members who have not been paid yet.
    function dissolve() external inPhase(Phase.Running) {
        if (!isStalled()) revert NotStalled();
        uint256 balance = token.balanceOf(address(this));
        refundPool = balance > totalClaimable ? balance - totalClaimable : 0;
        totalSecurity = 0;
        uint256 base;
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            base += netContribution(_members[i]);
        }
        refundBase = base;
        phase = Phase.Dissolved;
        emit Dissolved(currentRound, refundPool, base);
    }

    // ---------------------------------------------------------------- token helpers

    /// @dev tUSD8 is USDC-style and returns true. Both helpers also accept tokens that return nothing,
    /// and revert on a false return or a failed call. Callers finish their state changes first.
    function _pull(address from, uint256 amount) internal {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeCall(token.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(token.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }

    // ---------------------------------------------------------------- signatures

    /// @dev EOA signatures and EIP-1271 smart-account signatures both work.
    function _checkSig(address signer, bytes32 structHash, uint256 deadline, bytes calldata sig) internal view {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        if (!SignatureChecker.isValidSignatureNow(signer, _hashTypedDataV4(structHash), sig)) revert BadSignature();
    }
}
