// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ============================================================================
// Demo 1: TX.ORIGIN (authorization anti-pattern)
// ============================================================================
contract InsecureWallet {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    // Anti-pattern: kiểm tra quyền bằng tx.origin
    function withdraw() public {
        require(tx.origin == owner, "Not authorized");
        payable(msg.sender).transfer(address(this).balance);
    }

    receive() external payable {}
}

// ============================================================================
// Demo 2: SELFDESTRUCT
// ============================================================================
contract SelfDestructExample {
    address public owner;

    constructor() payable {
        owner = msg.sender;
    }

    receive() external payable {}

    function balance() external view returns (uint) {
        return address(this).balance;
    }

    function destroy() external {
        require(msg.sender == owner, "Only owner");
        // Warning: selfdestruct
        selfdestruct(payable(owner));
    }
}

// ============================================================================
// Demo 3: DELEGATECALL
// ============================================================================
contract Logic {
    // dummy logic, uses storage slot 0 implicitly via inline assembly style in example
    function change(uint x) public {
        assembly {
            sstore(0, x)
        }
    }
}

contract Proxy {
    uint public number; // slot 0
    address public owner; // slot 1

    function execute(address logic, uint x) public {
        // Warning: delegatecall
        (bool success, ) = logic.delegatecall(
            abi.encodeWithSignature("change(uint256)", x)
        );
        require(success);
    }
}

// ============================================================================
// Demo 4: LOW-LEVEL CALL WITH VALUE + UNUSED VARIABLE
// ============================================================================
contract SendWithCall {
    address public owner;

    constructor() payable {
        owner = msg.sender;
    }

    receive() external payable {}

    function sendTo(address payable recipient, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        require(address(this).balance >= amount, "Insufficient balance");

        // Warning: low-level call with value
        (bool success, bytes memory returnData) = recipient.call{value: amount}("");
        require(success, "Transfer failed");
        // returnData intentionally unused to trigger UNUSED_VARIABLE
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}

// ============================================================================
// Demo 5: MISSING PAYABLE (functions reading msg.value without payable)
// ============================================================================
contract PayableExamples {
    event Received(address sender, uint value);

    // Reads msg.value but not payable → should be flagged MISSING_PAYABLE
    function deposit() external {
        require(msg.value > 0, "no value");
        emit Received(msg.sender, msg.value);
    }

    // Constructor reads msg.value without payable → flagged MISSING_PAYABLE
    constructor() {
        uint x = msg.value;
        x;
    }

    // Proper payable receive
    receive() external payable {}

    function balance() external view returns (uint) {
        return address(this).balance;
    }
}

// ============================================================================
// Demo 6: NAMING & SYNTAX edge cases
// These snippets intentionally include minor syntax/name issues to exercise
// linter-style rules (semicolon, parentheses, identifier and parameter typing).
// Tree-sitter will still build a tree with error nodes; analyzer's regex checks
// will flag these lines without preventing other demos from working.
// ============================================================================
contract NamingSyntaxDemo{
    // Missing semicolon at end of declaration
    uint public number

    // function name starts with digit (invalid identifier)
    function 1abc() public {}

    // Missing data types in parameters
    function badParams(a, b) public {
        emit Ev(a);
    }
    event Ev(uint x);

    // Missing parentheses: looks like a call but no '()'
    function f() public {
        transfer msg.sender;
    }
}
