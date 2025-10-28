// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Count{
    function countLongStrings(string[] memory words) public pure returns (uint) {
        uint count = 0;
        for (uint i = 0; i < words.length; i++) {
            if (bytes(words[i]).length > 5) {
                count++;
            }
        }
        return count;
    }
    function contains(address[] memory addrs, address target) public pure returns (bool) {
        for (uint i = 0; i < addrs.length; i++) {
            if (addrs[i] == target) {
                return true;
            }
        }
        return false;
    }
    uint[] a;
}

contract test{function strix() public pure returns (uint){return 2;}}