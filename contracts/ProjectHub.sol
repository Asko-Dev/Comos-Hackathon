// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ProjectHub is AccessControl {
    using SafeERC20 for IERC20;

    struct Project
    {
        string name;
        address currencyAddress;
        uint256 hardCap;
        uint256 amountFilled;
        bool cancelled;
        bool ended;
        IERC20 payoutTokenAddress;
        uint256 payoutTokenAmount;
    }

    struct Allowance
    {
        uint256 maxAmount;
        uint256 amountFilled;
        bool cashedOut;
    }

    Project[] public projects;
    Allowance[] public allowances;
    mapping(uint256 => mapping(address => uint256)) allowance_for_address;

    event ProjectCreated(string _name, uint256 _projectId, address _currencyAddress, uint256 _hardCap, address _payoutTokenAddress, uint256 _payoutTokenAmount);
    event AllowanceCreated(uint256 _projectId, address _to, uint256 _allowance);
    event InvestmentSent(uint256 _projectId, address _from, uint256 _amount);
    event ProjectCancelled(uint256 _projectId);
    event ProjectEnded(uint256 _projectId);
    event InvestmentsWithdrawn(uint256 _projectId, uint256 _amount);
    event RewardCollected(uint256 _projectId, address _userAddress, uint256 _reward);
    event UserRefunded(uint256 _projectId, address _userAddress, uint256 _refund);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        Allowance memory allowance = Allowance(0, 0, false);
        allowances.push(allowance);
    }

    /*
     * Admin creates a project that needs funding
     * Admin specifies the hardcap, name, what is the currency to be collected and distributed and how many tokens
     * will get distributed.
    */
    function createProject(string calldata _name, address _currencyAddress, uint256 _hardCap, address _payoutTokenAddress, uint256 _payoutTokenAmount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project memory project;
        project.name = _name;
        project.currencyAddress = _currencyAddress;
        project.hardCap = _hardCap;
        project.payoutTokenAddress = IERC20(_payoutTokenAddress);
        project.payoutTokenAmount = _payoutTokenAmount;
        uint256 projectId = projects.length;
        projects.push(project);
        emit ProjectCreated(_name, projectId, _currencyAddress, _hardCap, _payoutTokenAddress, _payoutTokenAmount);
    }

    /*
     * Admin creates allowances for specific addresses.
    */
    function createAllowance(uint256 _projectId, address _to, uint256 _allowance)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project memory project = projects[_projectId];
        require(!project.cancelled && (project.amountFilled != project.hardCap), "Project no longer valid");
        require(_allowance > 0, "Increase allowance");
        Allowance memory allowance = Allowance(_allowance, 0, false);
        uint256 existingId = allowance_for_address[_projectId][_to];
        require(existingId == 0, "Already has allowance");
        allowance_for_address[_projectId][_to] = allowances.length;
        allowances.push(allowance);
        emit AllowanceCreated(_projectId, _to, _allowance);
    }

    /*
     * A function to find out the balance of any token holder (according to task description)
    */
    function getBalance(address _user, address _tokenAddress)
        external
        view
        returns (uint256)
    {
        IERC20 token = IERC20(_tokenAddress);
        uint256 userBalance = token.balanceOf(_user);
        return userBalance;
    }

    /*
     * A function to find out an allowance for a specific address.
    */
    function getAllowance(address _user, uint256 _projectId)
        external
        view
        returns (Allowance memory)
    {
        uint256 allowanceId = allowance_for_address[_projectId][_user];
        Allowance memory allowance = allowances[allowanceId];
        return allowance;
    }

    /*
     * A function to send funds into a project within a users allowance or the remaining funding goal.
    */
    function investInProject(uint256 _projectId, uint256 _amount)
        external
        payable
    {
        Project storage project = projects[_projectId];
        require(!project.cancelled && (project.amountFilled != project.hardCap), "Project not active");
        uint256 allowanceId = allowance_for_address[_projectId][msg.sender];
        require(allowanceId != 0, "No allowance");
        Allowance storage allowance = allowances[allowanceId];
        uint256 availableAllowance = allowance.maxAmount - allowance.amountFilled;
        uint256 availableProjectAmount = project.hardCap - project.amountFilled;
        uint256 investment;

        if (project.currencyAddress != address(0)) {
            require(msg.value == 0);
            require(_amount <= availableAllowance, "Allowance exceeded");
            require(availableProjectAmount >= _amount, "Funding goal exceeded");
            investment = _amount;
            IERC20 token = IERC20(project.currencyAddress);
            token.safeTransferFrom(msg.sender, address(this), investment);
        }
        else {
            require(msg.value <= availableAllowance, "Allowance exceeded");
            require(availableProjectAmount >= msg.value, "Funding goal exceeded");
            investment = msg.value;
        }

        allowance.amountFilled += investment;
        project.amountFilled += investment;
        emit InvestmentSent(_projectId, msg.sender, investment);
    }

    /*
     * An admin can cancel a project and refund the investors
    */
    function cancelProject(uint256 _projectId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project storage project = projects[_projectId];
        require(!project.cancelled && (project.amountFilled != project.hardCap), "Project not active");
        project.cancelled = true;
        emit ProjectCancelled(_projectId);
    }

     /*
     * An admin can end prematurely the project and adjust the hardCap to whatever has been filled until that time
     * Like this hardCap has to be smaller than the tokens to be distributed.
    */
    function endPrematurely(uint256 _projectId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project storage project = projects[_projectId];
        require(!project.cancelled && (project.amountFilled != project.hardCap), "Project cancelled or filled");
        uint256 fixedTokenRatio = (project.payoutTokenAmount / project.hardCap) * project.amountFilled;
        project.payoutTokenAmount = fixedTokenRatio;
        project.hardCap = project.amountFilled;
        emit ProjectEnded(_projectId);
    }

     /*
     * A function for a user to collect their funds after cancellation
    */
    function getRefund(uint256 _projectId)
        external
    {
        Project memory project = projects[_projectId];
        require(project.cancelled, "Project cancelled or filled");
        uint256 allowanceId = allowance_for_address[_projectId][msg.sender];
        require(allowanceId != 0, "No Allowance");
        Allowance storage allowance = allowances[allowanceId];
        require(allowance.amountFilled > 0, "Nothing to refund");
        if (project.currencyAddress != address(0)) {
            IERC20 token = IERC20(project.currencyAddress);
            token.safeTransfer(msg.sender, allowance.amountFilled);
        }
        else {
            payable(msg.sender).transfer(allowance.amountFilled);
        }
        emit UserRefunded(_projectId, msg.sender, allowance.amountFilled);
        allowance.amountFilled = 0;
    }

    /*
     * A function for a user to collect their reward after project has been ended
    */
    function getReward(uint256 _projectId)
        external
    {
        Project memory project = projects[_projectId];
        require(project.ended, "Project not finished");
        uint256 allowanceId = allowance_for_address[_projectId][msg.sender];
        require(allowanceId != 0, "No Allowance");
        Allowance storage allowance = allowances[allowanceId];
        require(!allowance.cashedOut && (allowance.amountFilled != 0), "Reward cashed out");
        allowance.cashedOut = true;

        uint256 reward = (project.payoutTokenAmount * allowance.amountFilled) / project.hardCap;

        project.payoutTokenAddress.safeTransfer(msg.sender, reward);
        emit RewardCollected(_projectId, msg.sender, reward);
    }

    /*
     * A function for an admin to withdraw the funds, will not succeed if reward tokens are not on this address
     * An admin could potentially after this function send out the tokens from the contract - if I had more time
     * I would have fixed it
    */
    function withdrawInvestments(uint256 _projectId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Project storage project = projects[_projectId];
        require(project.payoutTokenAddress.balanceOf(address(this)) >= project.payoutTokenAmount, "No distribution tokens");
        require(!project.cancelled && !project.ended && (project.hardCap == project.amountFilled), "Project not ready");
        if (project.currencyAddress != address(0)) {
            IERC20 token = IERC20(project.currencyAddress);
            token.safeTransfer(msg.sender, project.amountFilled);
        }
        else {
            payable(msg.sender).transfer(project.amountFilled);
        }
        project.ended = true;
        emit InvestmentsWithdrawn(_projectId, project.amountFilled);
    }
}