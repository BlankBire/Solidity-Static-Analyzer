const fs = require("fs");
const analyzer = require("../out/solidityAnalyzer");

const content = fs.readFileSync("scripts/testSample.sol", "utf8");
const rules = {
  txOrigin: false,
  selfdestruct: true,
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
const findings = analyzer.analyzeText(content, rules, 100, undefined, true);
console.log(
  findings
    .filter((f) => f.code === "SELFDESTRUCT")
    .map((f) => ({
      code: f.code,
      message: f.message,
      range: f.range,
    }))
);
