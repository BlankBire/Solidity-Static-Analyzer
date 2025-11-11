/**
 * Serialize Tree-sitter Solidity AST to JSON for machine-friendly inspection.
 * Usage: node scripts/dumpAstJson.js [--file scripts/testSample.sol] [--out scripts/astDump.json] [--maxDepth N]
 */
const fs = require("fs");
const path = require("path");
const Parser = require("tree-sitter");
const Solidity = require("tree-sitter-solidity");

// Simple arg parser
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  if (i !== -1 && i + 1 < args.length) return args[i + 1];
  return def;
};
const hasFlag = (flag) => args.includes(flag);

const inputFile = getArg("--file", "scripts/testSample.sol");
const outFile = getArg("--out", "scripts/astDump.json");
const maxDepth = parseInt(getArg("--maxDepth", "100"), 10);
const includeUnnamed = hasFlag("--includeUnnamed");

if (!fs.existsSync(inputFile)) {
  console.error("Input file not found:", inputFile);
  process.exit(1);
}
const content = fs.readFileSync(inputFile, "utf8");
const parser = new Parser();
parser.setLanguage(Solidity);
const tree = parser.parse(content);

function nodeToJson(node, depth = 0) {
  if (!node) return null;
  if (depth > maxDepth) return { type: node.type, truncated: true };
  const obj = {
    type: node.type,
    isNamed: !!node.isNamed,
    start: node.startPosition,
    end: node.endPosition,
  };
  const kids = node.namedChildren || [];
  obj.children = kids.map((c) => nodeToJson(c, depth + 1));
  if (includeUnnamed && node.children && node.children.length) {
    obj.unnamedChildren = node.children
      .filter((c) => !c.isNamed)
      .map((c) => ({
        type: c.type,
        start: c.startPosition,
        end: c.endPosition,
      }));
  }
  return obj;
}

const jsonAst = nodeToJson(tree.rootNode);

// Attach lightweight metadata
const output = {
  source: path.basename(inputFile),
  generatedAt: new Date().toISOString(),
  maxDepth,
  includeUnnamed,
  ast: jsonAst,
};

fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");
console.log("AST JSON written to", outFile);
