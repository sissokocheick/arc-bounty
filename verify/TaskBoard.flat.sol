◇ injected env (4) from .env // tip: ◈ encrypted .env [www.dotenvx.com]
// Sources flattened with hardhat v3.16.0 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/TaskBoard.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;

/// @title TaskBoard — micro-task escrow market for humans and autonomous agents
/// @notice Funds are escrowed in native USDC (Arc's gas asset, 18 decimals).
///         IMPORTANT: on Arc the native gas token uses 18 decimals while the
///         optional ERC-20 USDC interface uses 6. This contract only ever
///         touches msg.value (native, 18 decimals) — never call it with
///         ERC-20 amounts, the two differ by a factor of 1e12.
contract TaskBoard {
    struct Task {
        uint256 id;
        address creator;
        string title;
        string description;
        uint256 reward; // native USDC, 18 decimals
        address freelancer; // address(0) until work is submitted
        string proofUrl;
        bool submitted; // a submission is pending review
        bool completed; // approved and paid out
        bool cancelled; // creator cancelled and got refunded
        uint256 deadline; // unix seconds; block.timestamp on Arc is non-decreasing
    }

    uint256 public taskCount;
    mapping(uint256 => Task) public tasks;

    // Optional reputation feed: TaskBoard notifies the registry when an agent
    // gets paid, so agent profiles stay in sync without off-chain indexing.
    IAgentRegistry public immutable registry;

    event TaskPosted(uint256 indexed id, address indexed creator, uint256 reward, string title, uint256 deadline);
    event WorkSubmitted(uint256 indexed id, address indexed freelancer, string proofUrl);
    event WorkApproved(uint256 indexed id, address indexed freelancer, uint256 reward);
    event WorkRejected(uint256 indexed id, address indexed freelancer);
    event TaskCancelled(uint256 indexed id, address indexed creator, uint256 refund);
    event ReputationUpdated(address indexed agent, uint256 reward, bool success);

    error NotCreator();
    error IsCreator();
    error TaskNotFound();
    error AlreadySubmitted();
    error NotSubmitted();
    error AlreadyCompleted();
    error AlreadyCancelled();
    error Expired();
    error ZeroReward();
    error TransferFailed();

    constructor(address _registry) {
        registry = IAgentRegistry(_registry);
    }

    // ---------------------------------------------------------------- flows

    /// @notice Post a micro-task and escrow the reward in native USDC.
    function postTask(string calldata _title, string calldata _description, uint256 _deadline)
        external
        payable
    {
        if (msg.value == 0) revert ZeroReward();
        // A deadline in the past simply means the task is immediately expired,
        // so guard it to avoid unusable escrows.
        if (_deadline != 0 && _deadline < block.timestamp) revert Expired();

        uint256 id = taskCount;
        tasks[id] = Task({
            id: id,
            creator: msg.sender,
            title: _title,
            description: _description,
            reward: msg.value,
            freelancer: address(0),
            proofUrl: "",
            submitted: false,
            completed: false,
            cancelled: false,
            deadline: _deadline
        });

        emit TaskPosted(id, msg.sender, msg.value, _title, _deadline);
        taskCount = id + 1;
    }

    /// @notice Submit proof of work. Only one pending submission at a time:
    ///         the creator can `rejectWork` to reopen the task, which is what
    ///         makes the board spam-proof — a bad submission cannot lock funds.
    function submitWork(uint256 _id, string calldata _proofUrl) external {
        Task storage t = tasks[_id];
        if (t.creator == address(0)) revert TaskNotFound();
        if (msg.sender == t.creator) revert IsCreator();
        if (t.submitted) revert AlreadySubmitted();
        if (t.completed) revert AlreadyCompleted();
        if (t.cancelled) revert AlreadyCancelled();
        if (!_live(t)) revert Expired();

        t.freelancer = msg.sender;
        t.proofUrl = _proofUrl;
        t.submitted = true;

        emit WorkSubmitted(_id, msg.sender, _proofUrl);
    }

    /// @notice Approve the pending submission and pay the worker instantly.
    function approveWork(uint256 _id) external {
        Task storage t = tasks[_id];
        if (msg.sender != t.creator) revert NotCreator();
        // Check the terminal state first: re-approving a settled task should
        // report AlreadyCompleted, not "nothing to approve".
        if (t.completed) revert AlreadyCompleted();
        if (t.cancelled) revert AlreadyCancelled();
        if (!t.submitted) revert NotSubmitted();

        t.completed = true;
        t.submitted = false;

        // effects before interaction: mark settled before the value leaves.
        (bool ok, ) = t.freelancer.call{value: t.reward}("");
        if (!ok) revert TransferFailed();

        emit WorkApproved(_id, t.freelancer, t.reward);

        // Best-effort reputation update. A misconfigured registry must never
        // break a payout, so failures here are caught and surfaced as an event
        // rather than reverting the whole transaction.
        if (address(registry) != address(0)) {
            try registry.recordCompletion(t.freelancer, t.reward) {
                emit ReputationUpdated(t.freelancer, t.reward, true);
            } catch {
                emit ReputationUpdated(t.freelancer, t.reward, false);
            }
        }
    }

    /// @notice Reject a submission and reopen the task for other workers.
    function rejectWork(uint256 _id) external {
        Task storage t = tasks[_id];
        if (msg.sender != t.creator) revert NotCreator();
        if (t.completed) revert AlreadyCompleted();
        if (t.cancelled) revert AlreadyCancelled();
        if (!t.submitted) revert NotSubmitted();

        address rejected = t.freelancer;
        t.freelancer = address(0);
        t.proofUrl = "";
        t.submitted = false;

        emit WorkRejected(_id, rejected);
    }

    /// @notice Cancel an open task and refund the escrowed reward.
    function cancelTask(uint256 _id) external {
        Task storage t = tasks[_id];
        if (msg.sender != t.creator) revert NotCreator();
        if (t.completed) revert AlreadyCompleted();
        if (t.cancelled) revert AlreadyCancelled();
        // A task with work under review is no longer "open" — pay or reject it.
        if (t.submitted) revert AlreadySubmitted();

        t.cancelled = true;
        uint256 refund = t.reward;

        (bool ok, ) = t.creator.call{value: refund}("");
        if (!ok) revert TransferFailed();

        emit TaskCancelled(_id, t.creator, refund);
    }

    // --------------------------------------------------------------- views

    function _live(Task storage t) internal view returns (bool) {
        return t.deadline == 0 || block.timestamp <= t.deadline;
    }

    function getTask(uint256 _id) external view returns (Task memory) {
        return tasks[_id];
    }

    /// @notice Every task, newest first. Cheap-ish for view calls; the UI
    ///         paginates rather than rendering thousands of cards.
    function getAllTasks() external view returns (Task[] memory) {
        Task[] memory all = new Task[](taskCount);
        for (uint256 i = 0; i < taskCount; i++) {
            all[i] = tasks[i];
        }
        return all;
    }
}

/// @dev Minimal interface so TaskBoard compiles without importing the full
///      registry contract. Named with the I-prefix to avoid an artifact-name
///      collision with the concrete AgentRegistry contract.
interface IAgentRegistry {
    function recordCompletion(address agent, uint256 amount) external;
}

