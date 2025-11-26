// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ❌ Contract có lỗi Reentrancy (nguy hiểm)
contract VulnerableBank {
    mapping(address => uint256) public balances;

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    // ❌ Rút tiền trước -> update state sau → dễ bị hack reentrancy
    function withdraw() public {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        // BUG: cập nhật số dư sau khi gửi tiền
        balances[msg.sender] = 0;
    }
}
