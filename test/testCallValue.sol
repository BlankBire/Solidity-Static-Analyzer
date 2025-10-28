// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SendWithCall {
    address public owner;

    constructor() payable {
        owner = msg.sender;
    }

    // Cho contract nhận ETH
    receive() external payable {}

    // Gửi `amount` wei tới `recipient` bằng low-level call
    function sendTo(address payable recipient, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        require(address(this).balance >= amount, "Insufficient balance");

        // low-level call with value
        (bool success, bytes memory returnData) = recipient.call{value: amount}("");
        require(success, "Transfer failed");
        // returnData thường rỗng khi gọi fallback/receive
    }

    // Lấy số dư contract
    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}