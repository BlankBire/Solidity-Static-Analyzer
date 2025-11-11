const fs = require("fs");
const analyzer = require("../out/solidityAnalyzer");

// Read Solidity sample for naming/syntax issues from testSample.sol
const content = fs.readFileSync("scripts/testSample.sol", "utf8");

const rules = {
  txOrigin: false,
  selfdestruct: false,
  delegatecall: false,
  lowLevelCallValue: false,
  missingSemicolon: true,
  missingParentheses: true,
  missingBraces: true,
  missingReturn: true,
  wrongKeywords: true,
  missingDataType: true,
  missingPayable: false,
  functionNaming: true,
  variableNaming: true,
  contractNaming: true,
};
const naming = {
  functionPattern: "^[A-Za-z_][A-Za-z0-9_]*$",
  variablePattern: "^[A-Za-z_][A-Za-z0-9_]*$",
  constantPattern: "^[A-Za-z_][A-Za-z0-9_]*$",
  contractPattern: "^[A-Za-z_][A-Za-z0-9_]*$",
};

const findings = analyzer.analyzeText(content, rules, 200, naming, true);
console.log(
  findings.map((f) => ({ code: f.code, message: f.message, range: f.range }))
);
