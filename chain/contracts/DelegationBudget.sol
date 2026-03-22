// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DelegationBudget {
    struct DelegationState {
        address delegator;
        address delegate;
        uint256 cap;
        uint256 spent;
        uint256 deadline;
        bool active;
    }

    mapping(bytes32 => DelegationState) public delegations;

    event DelegationRegistered(
        bytes32 indexed delegationHash,
        address indexed delegator,
        address indexed delegate,
        uint256 cap,
        uint256 deadline
    );
    event SpendRecorded(bytes32 indexed delegationHash, uint256 amount, uint256 totalSpent);
    event DelegationRevoked(bytes32 indexed delegationHash);

    function registerDelegation(
        bytes32 delegationHash,
        address delegator,
        address delegate,
        uint256 cap,
        uint256 deadline
    ) external {
        require(delegationHash != bytes32(0), "Invalid hash");
        require(delegator != address(0), "Invalid delegator");
        require(delegate != address(0), "Invalid delegate");
        require(cap > 0, "Cap must be > 0");
        require(deadline > block.timestamp, "Deadline in past");

        DelegationState storage state = delegations[delegationHash];
        require(!state.active, "Delegation already active");

        delegations[delegationHash] = DelegationState({
            delegator: delegator,
            delegate: delegate,
            cap: cap,
            spent: 0,
            deadline: deadline,
            active: true
        });

        emit DelegationRegistered(delegationHash, delegator, delegate, cap, deadline);
    }

    function recordSpend(bytes32 delegationHash, uint256 amount) external {
        DelegationState storage state = delegations[delegationHash];
        require(state.active, "Delegation inactive");
        require(state.deadline >= block.timestamp, "Delegation expired");
        require(msg.sender == state.delegate, "Not delegate");
        require(state.spent + amount <= state.cap, "Exceeds cap");

        state.spent += amount;
        emit SpendRecorded(delegationHash, amount, state.spent);
    }

    function revoke(bytes32 delegationHash) external {
        DelegationState storage state = delegations[delegationHash];
        require(state.active, "Delegation inactive");
        require(msg.sender == state.delegator, "Not delegator");

        state.active = false;
        emit DelegationRevoked(delegationHash);
    }
}
