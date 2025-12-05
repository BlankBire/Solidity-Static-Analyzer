const fs = require("fs");
const c = fs.readFileSync("test/test31/Consumer_bad.sol", "utf8");
const rx = /import\s+(?:[^;]*?from\s+)?(?:"|')([^"']+)(?:"|')\s*;/g;
let m;
while ((m = rx.exec(c)) !== null) {
  console.log("MATCH", m[1], "at", m.index);
}
console.log("done");
