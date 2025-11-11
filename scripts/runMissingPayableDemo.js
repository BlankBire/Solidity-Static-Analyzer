const fs = require("fs");
const analyzer = require("../out/solidityAnalyzer");

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
  missingPayable: true,
  functionNaming: false,
  variableNaming: false,
  contractNaming: false,
};
const findings = analyzer.analyzeText(content, rules, 200, undefined, true, {
  enabled: true,
  pattern:
    "deposit|buy|mint|stake|fund|contribute|donate|tip|payIn|addLiquidity",
});
console.log(
  findings
    .filter((f) => f.code === "MISSING_PAYABLE")
    .map((f) => ({
      code: f.code,
      message: f.message,
      range: f.range,
    }))
);
