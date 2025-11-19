pragma solidity ^0.8.0;

contract Overflow_Add {
    uint public balance = 1;

    function add(uint256 deposit) public {
        balance += deposit;
    }
}