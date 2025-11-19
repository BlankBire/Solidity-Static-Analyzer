// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Logic {
    // logic assume slot 0 là "owner"
    function change(uint x) public {
        assembly {
            sstore(0, x)
        }
    }
}

contract Proxy {
    uint public number; // slot 0
    address public owner; // slot 1
    // delegatecall
    function execute(address logic, uint x) public {
        (bool success, ) = logic.delegatecall(
            abi.encodeWithSignature("change(uint256)", x)
        );
        require (success);
    }
}