◇ injected env (4) from .env // tip: ◈ secrets for agents [www.dotenvx.com]
// Sources flattened with hardhat v3.16.0 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/AgentRegistry.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentRegistry — identity and on-chain reputation for AI agents
/// @notice Autonomous agents are first-class participants on Arc: they hold
///         USDC, they pay for services, they get paid for work. This registry
///         gives each agent a persistent, verifiable profile — handle,
///         capabilities, vault address and lifetime earnings — so a task
///         poster can judge an agent's track record before trusting it.
contract AgentRegistry {
    struct Agent {
        string handle; // e.g. "ARC-1"
        string capabilities; // e.g. "research,code-review,sentiment"
        string metadataUri; // off-chain payload (model, version, attestation)
        address vault; // optional AgentVault holding the agent's budget
        bool registered;
        uint256 tasksCompleted;
        uint256 totalEarned; // native USDC, 18 decimals
        uint256 registeredAt;
    }

    mapping(address => Agent) public agents;
    address[] public agentList;
    uint256 public agentCount;

    // Sole writer of reputation data. Keeping it permissioned means the
    // numbers shown on an agent's profile can't be inflated by self-reports.
    address public authority;

    event AgentRegistered(address indexed agent, string handle, address vault);
    event AgentUpdated(address indexed agent, string capabilities, string metadataUri);
    event CompletionRecorded(address indexed agent, uint256 amount, uint256 total);

    error NotRegistered();
    error AlreadyRegistered();
    error NotAuthority();
    error EmptyHandle();

    constructor() {
        authority = msg.sender;
    }

    function setAuthority(address _authority) external {
        if (msg.sender != authority) revert NotAuthority();
        authority = _authority;
    }

    /// @notice Register a new agent. Call once; use `updateProfile` after.
    function register(
        string calldata _handle,
        string calldata _capabilities,
        string calldata _metadataUri,
        address _vault
    ) external {
        if (bytes(_handle).length == 0) revert EmptyHandle();
        if (agents[msg.sender].registered) revert AlreadyRegistered();

        agents[msg.sender] = Agent({
            handle: _handle,
            capabilities: _capabilities,
            metadataUri: _metadataUri,
            vault: _vault,
            registered: true,
            tasksCompleted: 0,
            totalEarned: 0,
            registeredAt: block.timestamp
        });
        agentList.push(msg.sender);
        agentCount++;

        emit AgentRegistered(msg.sender, _handle, _vault);
    }

    function updateProfile(string calldata _capabilities, string calldata _metadataUri) external {
        if (!agents[msg.sender].registered) revert NotRegistered();
        agents[msg.sender].capabilities = _capabilities;
        agents[msg.sender].metadataUri = _metadataUri;
        emit AgentUpdated(msg.sender, _capabilities, _metadataUri);
    }

    function setVault(address _vault) external {
        if (!agents[msg.sender].registered) revert NotRegistered();
        agents[msg.sender].vault = _vault;
        emit AgentUpdated(msg.sender, agents[msg.sender].capabilities, agents[msg.sender].metadataUri);
    }

    /// @notice Called by the TaskBoard authority when an agent is paid.
    ///         Reverts only in the unregistered case — but the caller wraps it
    ///         in try/catch, so a human payout never breaks the flow.
    function recordCompletion(address _agent, uint256 _amount) external {
        if (msg.sender != authority) revert NotAuthority();
        if (!agents[_agent].registered) revert NotRegistered();

        Agent storage a = agents[_agent];
        a.tasksCompleted += 1;
        a.totalEarned += _amount;

        emit CompletionRecorded(_agent, _amount, a.totalEarned);
    }

    function getAgent(address _agent) external view returns (Agent memory) {
        return agents[_agent];
    }

    function getAllAgents() external view returns (Agent[] memory) {
        Agent[] memory all = new Agent[](agentCount);
        for (uint256 i = 0; i < agentCount; i++) {
            all[i] = agents[agentList[i]];
        }
        return all;
    }
}

