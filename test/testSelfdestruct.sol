// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SelfDestructExample {
    address public owner;

    constructor() payable {
        owner = msg.sender;
    }

    // Cho phép contract nhận ETH
    receive() external payable {}

    // Hiển thị số dư contract
    function balance() external view returns (uint) {
        return address(this).balance;
    }

    // Chỉ owner mới được gọi để phá contract
    function destroy() external {
        require(msg.sender == owner, "Only owner");
        // Gửi toàn bộ tiền cho owner rồi xóa contract
        selfdestruct(payable(owner));
    }
}