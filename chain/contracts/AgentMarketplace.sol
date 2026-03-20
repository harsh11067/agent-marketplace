// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IReputationRegistry {
    function reward(address agent) external;
}

contract AgentMarketplace is ReentrancyGuard {
    IERC20 public immutable usdc;
    IReputationRegistry public immutable reputationRegistry;

    enum JobStatus {
        Open,
        Assigned,
        Completed,
        Cancelled
    }

    struct Job {
        address poster;
        string taskURI;
        uint256 budget; // USDC (6 decimals)
        uint256 deadline;
        address winner;
        uint256 agreedPrice;
        JobStatus status;
        string resultURI;
    }

    struct Bid {
        address agent;
        uint256 price; // USDC (6 decimals)
        string metadataURI;
        uint256 submittedAt;
    }

    uint256 public jobCount;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Bid[]) private _bids;

    event JobPosted(uint256 indexed jobId, address indexed poster, uint256 budget, uint256 deadline, string taskURI);
    event BidSubmitted(uint256 indexed jobId, address indexed agent, uint256 price, string metadataURI);
    event JobAssigned(uint256 indexed jobId, address indexed winner, uint256 price);
    event JobCompleted(uint256 indexed jobId, address indexed winner, uint256 payout, string resultURI);
    event JobCancelled(uint256 indexed jobId);

    constructor(address _usdc, address _reputationRegistry) {
        usdc = IERC20(_usdc);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
    }

    function postJob(string calldata taskURI, uint256 budget, uint256 deadline) external returns (uint256 jobId) {
        require(budget > 0, "Budget must be > 0");
        require(deadline > block.timestamp, "Deadline in past");

        usdc.transferFrom(msg.sender, address(this), budget);

        jobId = ++jobCount;
        jobs[jobId] = Job({
            poster: msg.sender,
            taskURI: taskURI,
            budget: budget,
            deadline: deadline,
            winner: address(0),
            agreedPrice: 0,
            status: JobStatus.Open,
            resultURI: ""
        });

        emit JobPosted(jobId, msg.sender, budget, deadline, taskURI);
    }

    function submitBid(uint256 jobId, uint256 price, string calldata metadataURI) external {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Open, "Job not open");
        require(block.timestamp < job.deadline, "Deadline passed");
        require(price <= job.budget, "Bid exceeds budget");

        _bids[jobId].push(Bid({
            agent: msg.sender,
            price: price,
            metadataURI: metadataURI,
            submittedAt: block.timestamp
        }));

        emit BidSubmitted(jobId, msg.sender, price, metadataURI);
    }

    function getBids(uint256 jobId) external view returns (Bid[] memory) {
        return _bids[jobId];
    }

    function assignJob(uint256 jobId, address winner, uint256 agreedPrice) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.poster, "Not job poster");
        require(job.status == JobStatus.Open, "Job not open");
        require(winner != address(0), "Winner required");
        require(agreedPrice > 0, "Price must be > 0");
        require(agreedPrice <= job.budget, "Price exceeds budget");

        job.winner = winner;
        job.agreedPrice = agreedPrice;
        job.status = JobStatus.Assigned;

        emit JobAssigned(jobId, winner, agreedPrice);
    }

    function completeJob(uint256 jobId, string calldata resultURI) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Assigned, "Not assigned");
        require(msg.sender == job.winner, "Not winner");

        job.status = JobStatus.Completed;
        job.resultURI = resultURI;

        uint256 payout = job.agreedPrice;
        usdc.transfer(job.winner, payout);
        if (job.budget > payout) {
            usdc.transfer(job.poster, job.budget - payout);
        }
        reputationRegistry.reward(job.winner);

        emit JobCompleted(jobId, job.winner, payout, resultURI);
    }

    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(msg.sender == job.poster, "Not job poster");
        require(job.status == JobStatus.Open, "Can only cancel open");

        job.status = JobStatus.Cancelled;
        usdc.transfer(job.poster, job.budget);

        emit JobCancelled(jobId);
    }
}
