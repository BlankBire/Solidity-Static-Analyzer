const fs = require("fs");
const path = require("path");
const cross = require("../out/rules/cross");
const content = fs.readFileSync("test/test31/Consumer_bad.sol", "utf8");
const declaredIdentifiers = new Set();
const declaredDeclarations = [];
const findings = [];
cross.runCrossFileChecks(
  content,
  path.resolve("test/test31/Consumer_bad.sol"),
  declaredIdentifiers,
  declaredDeclarations,
  (line, start, end, msg, code, sev) => {
    findings.push({ line, start, end, msg, code, sev });
  }
);
console.log("declaredIdentifiers", Array.from(declaredIdentifiers));
console.log(
  "declaredDeclarations",
  declaredDeclarations.map((d) => ({ name: d.name, imported: d.imported }))
);
console.log("findings", findings);
