// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract InsecureWallet {
    address public owner;

    constructor() {
        owner = msg.sender;
    }
    function withdraw() public {
        require(tx.origin == owner, "Not authorized");
        payable(msg.sender).transfer(address(this).balance);
    }

    // Nạp tiền vào contract
    receive() external payable {}
}