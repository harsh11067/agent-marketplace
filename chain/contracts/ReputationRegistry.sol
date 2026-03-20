// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ReputationRegistry {
    mapping(address => uint256) public score;
    mapping(address => uint256) public completedJobs;
    address public marketplace;

    event ScoreUpdated(address indexed agent, uint256 newScore);

    constructor() {
        marketplace = msg.sender;
    }

    function setMarketplace(address _marketplace) external {
        require(msg.sender == marketplace, "Unauthorized");
        marketplace = _marketplace;
    }

    function reward(address agent) external {
        require(msg.sender == marketplace, "Only marketplace");
        score[agent] += 10;
        completedJobs[agent] += 1;
        emit ScoreUpdated(agent, score[agent]);
    }
}

