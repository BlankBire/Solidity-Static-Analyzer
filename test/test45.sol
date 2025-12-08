// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/*
Note: cannot use web3 on JVM, so use the contract deployed on Goerli
Note: browser Web3 is old so use Web3 from truffle console

Contract deployed on Goerli
0x534E4Ce0ffF779513793cfd70308AF195827BD31
*/

/*
# Storage
- 2 ** 256 slots
- 32 bytes for each slot
- data is stored sequentially in the order of declaration
- storage is optimized to save space. If neighboring variables fit in a single
  32 bytes, then they are packed into the same slot, starting from the right
*/

contract Vault {
    // slot 0
    uint256 public count = 123;
    // slot 1
    address public owner = msg.sender;
    bool public isTrue = true;
    uint16 public u16 = 31;
    // slot 2
    bytes32 private password;

    // constants do not use storage
    uint256 public constant someConst = 123;

    // slot 3, 4, 5 (one for each array element)
    bytes32[3] public data;

    struct User {
        uint256 id;
        bytes32 password;
    }

    // slot 6 - length of array
    // starting from slot hash(6) - array elements
    // slot where array element is stored = keccak256(slot)) + (index * elementSize)
    // where slot = 6 and elementSize = 2 (1 (uint) +  1 (bytes32))
    User[] private users;

    // slot 7 - empty
    // entries are stored at hash(key, slot)
    // where slot = 7, key = map key
    mapping(uint256 => User) private idToUser;

    constructor(bytes32 _password) {
        password = _password;
    }

    function addUser(bytes32 _password) public {
        User memory user = User({id: users.length, password: _password});

        users.push(user);
        idToUser[user.id] = user;
    }

    function getArrayLocation(uint256 slot, uint256 index, uint256 elementSize)
        public
        pure
        returns (uint256)
    {
        return
            uint256(keccak256(abi.encodePacked(slot))) + (index * elementSize);
    }

    function getMapLocation(uint256 slot, uint256 key)
        public
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encodePacked(key, slot)));
    }
}