// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./tilities.sol";

contract Consumer {
    using MathLib for uint;
    uint public product;
    function calculateProduct(uint x, uint y) public {
        product = x.multiply(y);
    }
}
