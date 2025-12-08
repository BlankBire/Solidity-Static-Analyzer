/* Demo runner for analyzer with naming rules enabled */
const fs = require("fs");
const path = require("path");
const analyzer = require("../out/solidityAnalyzer");

const file = process.argv[2] || "test/test32.sol";
const abs = path.resolve(file);
const content = fs.readFileSync(abs, "utf8");
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
  legacyFallbackFunction: false,
  missingPayable: false,
  functionNaming: false,
  variableNaming: true,
  contractNaming: false,
  missingVisibility: false,
  unsafeAddressCast: false,
  deprecatedThisBalance: false,
  legacyConstructor: false,
  msgSenderTransfer: false,
  lowLevelCallNoData: false,
  uncheckedLowLevelCall: false,
  tryReturnShadowing: false,
  unusedTryReturnVariable: false,
  missingLicense: false,
  missingVersion: false,
};

const findings = analyzer.analyzeText(
  content,
  rules,
  200,
  undefined,
  true,
  undefined,
  abs
);
console.log("Findings for", abs);
for (const f of findings) {
  console.log(
    f.code,
    f.message,
    `@ ${f.range.start.line + 1}:${f.range.start.character + 1}`
  );
}
