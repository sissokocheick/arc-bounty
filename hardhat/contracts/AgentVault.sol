// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentVault — a policy-governed wallet for autonomous AI agents
/// @notice Arc's native gas asset IS USDC, so an agent with a funded wallet can
///         transact autonomously without wrapping or approving ERC-20s. The
///         risk, of course, is an agent draining its budget on a bug or a
///         prompt-injected shopping spree. This vault makes that safe:
///         spending is bounded by an owner-defined policy.
///
///         A vault is not immortal: `terminate()` pays the owner everything
///         that remains and freezes the vault for good. After it, the agent
///         can neither spend nor be funded again — an engagement ends, and the
///         chain reflects that instead of holding a live budget open forever.
///
///         All amounts are native USDC in 18 decimals.
contract AgentVault {
    struct Policy {
        uint256 perSpendCap; // max single spend
        uint256 dailyBudget; // max total spend per UTC day
        bool whitelistEnabled; // restrict recipients to an allow-list
        bool paused; // kill switch
    }

    address public owner; // human who funds and controls the vault
    address public agent; // the autonomous EOA permitted to spend
    string public label; // human-readable agent name, e.g. "ARC-1 researcher"

    Policy public policy;
    mapping(address => bool) public whitelisted;

    // Daily budget accounting. block.timestamp on Arc is non-decreasing, so the
    // UTC day index only ever advances and the reset below is safe.
    uint256 public lastDay; // block.timestamp / 1 days
    uint256 public spentToday;

    uint256 public totalSpent;
    uint256 public spendCount;

    // Terminal state. Set once, in terminate(), and never cleared: a vault that
    // could be revived would let a "closed" engagement start spending again.
    bool public terminated;
    uint256 public terminatedAt;

    event Funded(address indexed by, uint256 amount, uint256 balance);
    event Spent(uint256 indexed index, address indexed to, uint256 amount, string reason);
    event Withdrawn(address indexed to, uint256 amount);
    event PolicyUpdated(uint256 perSpendCap, uint256 dailyBudget, bool whitelistEnabled);
    event WhitelistSet(address indexed who, bool allowed);
    event AgentSet(address indexed agent);
    event Paused(bool paused);
    event Terminated(address indexed by, uint256 paidOut, uint256 totalSpent);

    error OnlyOwner();
    error OnlyAgent();
    error VaultPaused();
    error VaultTerminated();
    error ZeroAddress();
    error ExceedsPerSpendCap(uint256 cap);
    error ExceedsDailyBudget(uint256 remaining);
    error NotWhitelisted(address who);
    error InsufficientBalance(uint256 available);

    constructor(address _agent, string memory _label) payable {
        owner = msg.sender;
        agent = _agent;
        label = _label;
        lastDay = block.timestamp / 1 days;
        if (msg.value > 0) emit Funded(msg.sender, msg.value, msg.value);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
        _;
    }

    /// @notice The agent spends native USDC within the bounds of its policy.
    /// @param to       recipient
    /// @param amount   native USDC (18 decimals)
    /// @param reason   machine-readable purpose, recorded on-chain for audit
    function spend(address to, uint256 amount, string calldata reason) external onlyAgent {
        if (terminated) revert VaultTerminated();
        if (policy.paused) revert VaultPaused();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InsufficientBalance(0);
        // A zero cap means "unbounded" — only the daily budget applies.
        if (perSpendCap() != 0 && amount > perSpendCap()) {
            revert ExceedsPerSpendCap(perSpendCap());
        }

        _rolloverDay();

        if (policy.dailyBudget == 0) revert ExceedsDailyBudget(0);
        uint256 remaining = policy.dailyBudget - spentToday;
        if (amount > remaining) revert ExceedsDailyBudget(remaining);
        // balance check is enforced by the transfer itself, but give a clearer
        // error than a bare failed call.
        if (amount > address(this).balance) revert InsufficientBalance(address(this).balance);

        if (policy.whitelistEnabled && !whitelisted[to]) revert NotWhitelisted(to);

        spentToday += amount;
        totalSpent += amount;
        uint256 index = spendCount++;

        emit Spent(index, to, amount, reason);

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert InsufficientBalance(address(this).balance);
    }

    /// @notice Advance the daily window. Called on every spend; idempotent.
    function _rolloverDay() internal {
        uint256 today = block.timestamp / 1 days;
        if (today != lastDay) {
            lastDay = today;
            spentToday = 0;
        }
    }

    /// @dev Per-spend cap has no zero default: an unset policy (0) means
    ///      per-spend is unbounded and only the daily budget applies.
    function perSpendCap() public view returns (uint256) {
        return policy.perSpendCap;
    }

    /// @notice Remaining spendable amount in the current day.
    function dailyRemaining() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 spent = (today == lastDay) ? spentToday : 0;
        return policy.dailyBudget > spent ? policy.dailyBudget - spent : 0;
    }

    // ------------------------------------------------------------- owner ops

    function fund() external payable onlyOwner {
        if (terminated) revert VaultTerminated();
        emit Funded(msg.sender, msg.value, address(this).balance);
    }

    function withdraw(uint256 amount) external onlyOwner {
        if (amount > address(this).balance) revert InsufficientBalance(address(this).balance);
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert InsufficientBalance(address(this).balance);
        emit Withdrawn(owner, amount);
    }

    function withdrawAll() external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert InsufficientBalance(address(this).balance);
        emit Withdrawn(owner, amount);
    }

    function setPolicy(uint256 _perSpendCap, uint256 _dailyBudget, bool _whitelistEnabled) external onlyOwner {
        policy.perSpendCap = _perSpendCap;
        policy.dailyBudget = _dailyBudget;
        policy.whitelistEnabled = _whitelistEnabled;
        emit PolicyUpdated(_perSpendCap, _dailyBudget, _whitelistEnabled);
    }

    function setWhitelist(address who, bool allowed) external onlyOwner {
        whitelisted[who] = allowed;
        emit WhitelistSet(who, allowed);
    }

    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        agent = _agent;
        emit AgentSet(_agent);
    }

    function setPaused(bool _paused) external onlyOwner {
        policy.paused = _paused;
        emit Paused(_paused);
    }

    /// @notice Close the engagement. Pays the owner everything that remains and
    ///         freezes the vault permanently — the agent can neither spend nor
    ///         be funded again. The audit trail (totalSpent, spendCount) stays
    ///         readable, so a terminated vault is still proof of what the agent
    ///         did, just no longer a live budget.
    function terminate() external onlyOwner {
        if (terminated) revert VaultTerminated();
        uint256 payout = address(this).balance;

        // Effects before the interaction: mark it closed first, so a call that
        // re-enters finds a vault that has already ended.
        terminated = true;
        terminatedAt = block.timestamp;
        emit Terminated(msg.sender, payout, totalSpent);

        if (payout > 0) {
            (bool ok, ) = owner.call{value: payout}("");
            if (!ok) revert InsufficientBalance(payout);
        }
    }

    receive() external payable {
        // A terminated vault must not accept funds again — it would silently
        // trap them, since spend and fund both revert afterwards.
        if (terminated) revert VaultTerminated();
        // anyone can tip/fund the vault; owner-only withdrawal protects it
        emit Funded(msg.sender, msg.value, address(this).balance);
    }
}
