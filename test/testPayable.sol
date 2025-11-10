// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Test {
    // error: dùng msg.value nhưng không có payable
    function deposit() external {
        require(msg.value > 0, "no value");
    }

    // Not error: gửi ETH nhưng không đọc msg.value
    function pay(address payable to, uint amount) external {
        to.transfer(amount);
    }

    // error: receive thiếu payable
    receive() external {}

    // constructor đọc msg.value
    constructor() {
        uint x = msg.value;
    }

    // Not error: view function chỉ đọc balance
    function balance() external view returns (uint) {
        return address(this).balance;
    }

    // error: dùng msg.value nhưng thiếu payable
    event Received(address sender, uint value);
    function fallback() external {
        emit Received(msg.sender, msg.value);
    }
}