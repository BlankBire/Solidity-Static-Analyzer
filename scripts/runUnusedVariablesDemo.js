const fs = require("fs");
const analyzer = require("../out/solidityAnalyzer");

// Analyze the consolidated sample and print only UNUSED_VARIABLE findings
const content = fs.readFileSync("scripts/testSample.sol", "utf8");
const rules = {
  txOrigin: false,
  selfdestruct: false,
  delegatecall: false,
  lowLevelCallValue: false,
  missingSemicolon: false,
  missingParentheses: false,
  missingBraces: false,
  missingReturn: false,
  wrongKeywords: false,
  missingDataType: false,
  missingPayable: false,
  functionNaming: false,
  variableNaming: false,
  contractNaming: false,
};

const findings = analyzer.analyzeText(content, rules, 200, undefined, true);
const unused = findings
  .filter((f) => f.code === "UNUSED_VARIABLE")
  .map((f) => ({ code: f.code, message: f.message, range: f.range }));

console.log(unused);
