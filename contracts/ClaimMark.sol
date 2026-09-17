// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Claim Marks — in-game currency wrapped on-chain.
/// Factory ticks, plots, and ore trades stay off-chain.
/// Only wrap/unwrap of whole Marks hits this contract.
contract ClaimMark {
    string public constant name = "Claim Marks";
    string public constant symbol = "MARKS";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public minter;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Unwrap(address indexed from, uint256 amount);

    constructor() {
        minter = msg.sender;
    }

    function setMinter(address next) external {
        require(msg.sender == minter, "not minter");
        minter = next;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        require(to != address(0), "zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit Unwrap(msg.sender, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
