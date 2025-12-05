// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// 1. IMPORT: Phải dùng tên file: "./Utilities.sol"
import "./Utilities.sol"; 

contract Consumer {
    // 2. SỬ DỤNG: Vẫn phải dùng tên Library: MathLib
    using MathLib for uint; 

    uint public product;

    function calculateProduct(uint x, uint y) public {
        // Gọi hàm của thư viện bằng tên MathLib đã khai báo bên trong file
        product = x.multiply(y); 
    }
}