"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeText = analyzeText;
const vscode = __importStar(require("vscode"));
// =============================================================================
// HÀM PHÂN TÍCH CHÍNH
// =============================================================================
/**
 * Hàm chính phân tích mã Solidity
 * @param content Nội dung file Solidity
 * @param rules Cấu hình các rules cần kiểm tra
 * @param maxProblems Giới hạn số lượng lỗi tối đa
 * @returns Danh sách các findings (lỗi/cảnh báo)
 */
function analyzeText(content, rules, maxProblems, naming, useAST, payableHeuristic) {
    const findings = [];
    // Reported keys to deduplicate diagnostics
    // (moved declarations earlier to enable AST traversal to populate them)
    // Nếu user bật useASTAnalyzer, sẽ dùng tree-sitter để tìm chính xác comment
    // và loại bỏ chúng trước khi phân tích theo dòng. Nếu không có AST hoặc lỗi,
    // fallback về nội dung gốc và dùng stripping regex sau.
    let contentNoComments = content;
    // Parser/tree được khởi tạo nếu useAST được bật và tree-sitter tồn tại
    let parser = undefined;
    let tree = undefined;
    // commentRanges and ignoredRanges will be filled if AST parsing succeeds
    let commentRanges = [];
    let ignoredRanges = [];
    // Theo dõi các identifier bị thiếu kiểu để cảnh báo khi được sử dụng ở các dòng sau
    const missingTypeIdentifiers = new Set();
    // Theo dõi các identifier đã được khai báo (có type)
    const declaredIdentifiers = new Set();
    // store declaration positions for better diagnostics
    const declaredIdentifierPositions = new Map();
    // identifiers used (populated when AST available)
    const usedIdentifiers = new Set();
    // detailed declared declarations with scope info
    const declaredDeclarations = [];
    if (useAST) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Parser = require("tree-sitter");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const SolidityLang = require("tree-sitter-solidity");
            parser = new Parser();
            parser.setLanguage(SolidityLang);
            tree = parser.parse(content);
            // Collect comment node ranges
            commentRanges = [];
            const collectComments = (node) => {
                if (!node)
                    return;
                const t = String(node.type).toLowerCase();
                if (t.includes("comment")) {
                    commentRanges.push([node.startIndex, node.endIndex]);
                }
                const kids = node.namedChildren || node.children || [];
                for (const c of kids)
                    collectComments(c);
            };
            if (tree && tree.rootNode)
                collectComments(tree.rootNode);
            // Collect ranges to ignore for parentheses checks (e.g., return/emit statements)
            const ignoreNodeTypes = new Set(["return_statement", "emit_statement"]);
            ignoredRanges = [];
            const collectIgnored = (node) => {
                if (!node)
                    return;
                if (ignoreNodeTypes.has(String(node.type))) {
                    ignoredRanges.push([node.startIndex, node.endIndex]);
                }
                const kids = node.namedChildren || node.children || [];
                for (const c of kids)
                    collectIgnored(c);
            };
            if (tree && tree.rootNode)
                collectIgnored(tree.rootNode);
            // Remove comment ranges from content (iterate từ cuối về đầu để tránh ảnh hưởng chỉ số)
            if (commentRanges.length > 0) {
                commentRanges.sort((a, b) => b[0] - a[0]);
                for (const [s, e] of commentRanges) {
                    contentNoComments =
                        contentNoComments.slice(0, s) + contentNoComments.slice(e);
                }
            }
            // Collect declared identifiers from AST: state vars, parameters, and local var declarations
            try {
                const collectDeclared = (node) => {
                    if (!node)
                        return;
                    const t = String(node.type).toLowerCase();
                    // state variable declarations (tree-sitter-solidity: state_variable_declaration)
                    if (t === "state_variable_declaration" ||
                        t === "variable_declaration") {
                        const kids = node.namedChildren || node.children || [];
                        for (const c of kids) {
                            try {
                                if (c.type === "identifier" ||
                                    String(c.type).toLowerCase() === "identifier") {
                                    const name = content.slice(c.startIndex, c.endIndex);
                                    declaredIdentifiers.add(name);
                                    // determine scope node: nearest enclosing function/contract/block
                                    const scopeTypes = new Set([
                                        "function_definition",
                                        "function_declaration",
                                        "contract_definition",
                                        "block",
                                        "if_statement",
                                        "for_statement",
                                        "while_statement",
                                    ]);
                                    let scopeNode = node;
                                    try {
                                        let cur = c.parent;
                                        while (cur && !scopeTypes.has(String(cur.type))) {
                                            cur = cur.parent;
                                        }
                                        scopeNode = cur || tree.rootNode;
                                    }
                                    catch (_) {
                                        scopeNode = tree.rootNode;
                                    }
                                    declaredIdentifierPositions.set(name, {
                                        startIndex: c.startIndex,
                                        endIndex: c.endIndex,
                                        startPosition: c.startPosition,
                                    });
                                    declaredDeclarations.push({
                                        name,
                                        declNode: c,
                                        scopeNode,
                                        startIndex: c.startIndex,
                                        startPosition: c.startPosition,
                                        scopeType: String(scopeNode.type),
                                    });
                                }
                                else if (c.namedChildren && c.namedChildren.length > 0) {
                                    for (const cc of c.namedChildren) {
                                        if (cc.type === "identifier") {
                                            const name = content.slice(cc.startIndex, cc.endIndex);
                                            declaredIdentifiers.add(name);
                                            // find scope node
                                            const scopeTypes2 = new Set([
                                                "function_definition",
                                                "function_declaration",
                                                "contract_definition",
                                                "block",
                                                "if_statement",
                                                "for_statement",
                                                "while_statement",
                                            ]);
                                            let scopeNode2 = node;
                                            try {
                                                let cur2 = cc.parent;
                                                while (cur2 && !scopeTypes2.has(String(cur2.type))) {
                                                    cur2 = cur2.parent;
                                                }
                                                scopeNode2 = cur2 || tree.rootNode;
                                            }
                                            catch (_) {
                                                scopeNode2 = tree.rootNode;
                                            }
                                            declaredIdentifierPositions.set(name, {
                                                startIndex: cc.startIndex,
                                                endIndex: cc.endIndex,
                                                startPosition: cc.startPosition,
                                            });
                                            declaredDeclarations.push({
                                                name,
                                                declNode: cc,
                                                scopeNode: scopeNode2,
                                                startIndex: cc.startIndex,
                                                startPosition: cc.startPosition,
                                                scopeType: String(scopeNode2.type),
                                            });
                                        }
                                    }
                                }
                            }
                            catch (_) {
                                // noop
                            }
                        }
                    }
                    // function parameters
                    if (t === "parameter_list" || t === "parameter") {
                        const kids = node.namedChildren || node.children || [];
                        for (const c of kids) {
                            if (c.type === "identifier") {
                                const name = content.slice(c.startIndex, c.endIndex);
                                declaredIdentifiers.add(name);
                                // parameter scope -> enclosing function
                                let scopeNodeP = tree.rootNode;
                                try {
                                    let curP = c.parent;
                                    while (curP &&
                                        !/function_definition|function_declaration/i.test(String(curP.type))) {
                                        curP = curP.parent;
                                    }
                                    scopeNodeP = curP || tree.rootNode;
                                }
                                catch (_) {
                                    scopeNodeP = tree.rootNode;
                                }
                                declaredIdentifierPositions.set(name, {
                                    startIndex: c.startIndex,
                                    endIndex: c.endIndex,
                                    startPosition: c.startPosition,
                                });
                                declaredDeclarations.push({
                                    name,
                                    declNode: c,
                                    scopeNode: scopeNodeP,
                                    startIndex: c.startIndex,
                                    startPosition: c.startPosition,
                                    scopeType: String(scopeNodeP.type),
                                });
                            }
                        }
                    }
                    // local variable declarations may appear as variable_declaration_statement
                    if (t === "variable_declaration_list" ||
                        t === "variable_declaration_statement") {
                        const kids = node.namedChildren || node.children || [];
                        for (const c of kids) {
                            if (c.type === "identifier") {
                                const name = content.slice(c.startIndex, c.endIndex);
                                declaredIdentifiers.add(name);
                                declaredIdentifierPositions.set(name, {
                                    startIndex: c.startIndex,
                                    endIndex: c.endIndex,
                                    startPosition: c.startPosition,
                                });
                                // scope -> nearest enclosing function/block
                                let scopeNodeV = tree.rootNode;
                                try {
                                    let curV = c.parent;
                                    const scopeTypesV = new Set([
                                        "function_definition",
                                        "function_declaration",
                                        "block",
                                    ]);
                                    while (curV && !scopeTypesV.has(String(curV.type))) {
                                        curV = curV.parent;
                                    }
                                    scopeNodeV = curV || tree.rootNode;
                                }
                                catch (_) {
                                    scopeNodeV = tree.rootNode;
                                }
                                declaredDeclarations.push({
                                    name,
                                    declNode: c,
                                    scopeNode: scopeNodeV,
                                    startIndex: c.startIndex,
                                    startPosition: c.startPosition,
                                    scopeType: String(scopeNodeV.type),
                                });
                            }
                        }
                    }
                    const kids = node.namedChildren || node.children || [];
                    for (const c of kids)
                        collectDeclared(c);
                };
                if (tree && tree.rootNode)
                    collectDeclared(tree.rootNode);
            }
            catch (e) {
                // ignore
            }
        }
        catch (err) {
            // Nếu không có tree-sitter hoặc parse lỗi → fallback về stripping regex
            contentNoComments = content;
            parser = undefined;
            tree = undefined;
        }
    }
    // Split into lines after comments have been removed (from AST or fallback)
    const lines = contentNoComments.split(/\r?\n/);
    const reportedKeys = new Set();
    // Hàm helper để thêm finding vào danh sách
    const pushFinding = (lineIndex, start, end, message, code, severity) => {
        if (findings.length >= maxProblems) {
            return;
        }
        const key = `${lineIndex}:${start}:${end}:${code}`;
        if (reportedKeys.has(key)) {
            return;
        }
        reportedKeys.add(key);
        findings.push({
            message,
            code,
            severity,
            range: {
                start: { line: lineIndex, character: start },
                end: { line: lineIndex, character: end },
            },
        });
    };
    // =============================================================================
    // PRAGMA RULES - Kiểm tra license và version
    // =============================================================================
    // Kiểm tra license (SPDX-License-Identifier) - sử dụng content gốc vì license là comment
    if (rules.missingLicense) {
        const originalLines = content.split(/\r?\n/);
        let hasLicense = false;
        // Kiểm tra trong 10 dòng đầu (license thường ở đầu file)
        for (let i = 0; i < Math.min(10, originalLines.length); i++) {
            const line = originalLines[i].trim();
            // Kiểm tra SPDX license identifier (có thể là // hoặc /* */)
            if (/^\/\/\s*SPDX-License-Identifier\s*:/.test(line) ||
                /^\/\*\s*SPDX-License-Identifier\s*:/.test(line)) {
                hasLicense = true;
                break;
            }
        }
        if (!hasLicense) {
            pushFinding(0, 0, 1, "Missing SPDX-License-Identifier. Add a license identifier at the top of the file (e.g., // SPDX-License-Identifier: MIT).", "MISSING_LICENSE", vscode.DiagnosticSeverity.Warning);
        }
    }
    // Kiểm tra version (pragma solidity) - sử dụng content gốc
    if (rules.missingVersion) {
        const originalLines = content.split(/\r?\n/);
        let hasVersion = false;
        let versionLineIndex = -1;
        // Kiểm tra trong 20 dòng đầu (pragma thường ở đầu file)
        for (let i = 0; i < Math.min(20, originalLines.length); i++) {
            const line = originalLines[i];
            // Kiểm tra pragma solidity (bỏ qua comment)
            const noCommentLine = line.split("//")[0].trim();
            if (/^pragma\s+solidity\s+/.test(noCommentLine)) {
                hasVersion = true;
                versionLineIndex = i;
                break;
            }
        }
        if (!hasVersion) {
            pushFinding(0, 0, 1, "Missing pragma solidity version. Add a version declaration at the top of the file (e.g., pragma solidity ^0.8.0;).", "MISSING_VERSION", vscode.DiagnosticSeverity.Warning);
        }
    }
    // Nếu AST đã parse thành công phía trên, dùng lại tree để kiểm tra 'missingReturn' chính xác hơn.
    if (tree) {
        try {
            // Helper: tìm return_statement trong subtree
            const hasReturnInNode = (node) => {
                if (!node)
                    return false;
                if (node.type === "return_statement")
                    return true;
                const kids = node.namedChildren || node.children || [];
                for (const c of kids) {
                    if (hasReturnInNode(c))
                        return true;
                }
                return false;
            };
            // Duyệt AST để detect function definitions với 'returns' nhưng không có 'return'
            const walk = (node) => {
                if (!node)
                    return;
                // Node type names depend on grammar; tree-sitter-solidity uses 'function_definition'
                if (node.type === "function_definition" ||
                    node.type === "function_declaration") {
                    const nodeText = content.slice(node.startIndex, node.endIndex);
                    if (/returns\s*\(/i.test(nodeText)) {
                        if (!hasReturnInNode(node)) {
                            const pos = node.startPosition || { row: 0, column: 0 };
                            pushFinding(pos.row, pos.column, pos.column + 1, "Missing return statement in function with return type.", "MISSING_RETURN", vscode.DiagnosticSeverity.Error);
                        }
                    }
                }
                const kids = node.namedChildren || node.children || [];
                for (const c of kids) {
                    walk(c);
                }
            };
            walk(tree.rootNode);
        }
        catch (err) {
            // ignore AST traversal errors and continue with heuristic checks
        }
    }
    // AST-based expression statement detection for missing parentheses
    if (tree && rules.missingParentheses) {
        try {
            const isInsideIgnored = (sidx, eidx) => ignoredRanges.some(([s, e]) => sidx >= s && eidx <= e);
            const walkExprs = (node) => {
                if (!node)
                    return;
                // expression_statement nodes often wrap bare expressions like `transfer msg.sender;`
                if (String(node.type) === "expression_statement") {
                    const expr = node.namedChildren && node.namedChildren[0];
                    if (expr) {
                        const exprType = String(expr.type);
                        // If expression is a 'identifier' or 'member_expression' (member access) but not a call_expression
                        if ((exprType === "identifier" || exprType === "member_expression") &&
                            expr.type !== "call_expression") {
                            const text = content.slice(expr.startIndex, expr.endIndex);
                            // Skip if identifier is a declared identifier (assignment target or var)
                            const idName = text.split(/\.|\s/)[0];
                            if (declaredIdentifiers.has(idName)) {
                                // skip -- it's likely a bare variable usage
                            }
                            else if (!isInsideIgnored(expr.startIndex, expr.endIndex)) {
                                const pos = expr.startPosition || { row: 0, column: 0 };
                                pushFinding(pos.row, pos.column, pos.column + idName.length, "Missing parentheses for function call.", "MISSING_PARENTHESES", vscode.DiagnosticSeverity.Error);
                            }
                        }
                    }
                }
                const kids = node.namedChildren || node.children || [];
                for (const c of kids)
                    walkExprs(c);
            };
            walkExprs(tree.rootNode);
        }
        catch (e) {
            // ignore
        }
    }
    // If AST present, perform scope-aware unused-declaration detection
    if (tree) {
        try {
            const findUsageInScope = (scopeNode, name, declStartIdx) => {
                let found = false;
                const walk = (n) => {
                    if (!n || found)
                        return;
                    if (String(n.type) === "identifier") {
                        try {
                            const nm = content.slice(n.startIndex, n.endIndex);
                            if (nm === name && n.startIndex !== declStartIdx) {
                                found = true;
                                return;
                            }
                        }
                        catch (_) { }
                    }
                    const kids = n.namedChildren || n.children || [];
                    for (const c of kids) {
                        if (found)
                            break;
                        walk(c);
                    }
                };
                walk(scopeNode);
                return found;
            };
            for (const decl of declaredDeclarations) {
                // Skip intentionally ignored names
                if (decl.name.startsWith("_"))
                    continue;
                const used = findUsageInScope(decl.scopeNode, decl.name, decl.declNode.startIndex);
                if (!used) {
                    // report at declaration
                    let lineNum = 0;
                    let colNum = 0;
                    if (decl.startPosition &&
                        typeof decl.startPosition.row === "number") {
                        lineNum = decl.startPosition.row;
                        colNum = decl.startPosition.column;
                    }
                    else {
                        const before = content.slice(0, decl.startIndex).split(/\r?\n/);
                        lineNum = before.length - 1;
                        colNum = before[before.length - 1].length;
                    }
                    pushFinding(lineNum, colNum, colNum + decl.name.length, `Declared variable '${decl.name}' is never used.`, "UNUSED_VARIABLE", vscode.DiagnosticSeverity.Warning);
                }
            }
        }
        catch (e) {
            // ignore
        }
    }
    // If AST present, collect identifier usages and report unused declared variables
    if (tree) {
        try {
            const declParentTypes = new Set([
                "variable_declaration",
                "state_variable_declaration",
                "parameter",
                "parameter_list",
                "function_definition",
                "function_declaration",
                "variable_declaration_statement",
            ]);
            const collectUsages = (node) => {
                if (!node)
                    return;
                if (String(node.type) === "identifier") {
                    const parent = node.parent;
                    const ptype = parent ? String(parent.type) : "";
                    const name = content.slice(node.startIndex, node.endIndex);
                    if (!declParentTypes.has(ptype)) {
                        usedIdentifiers.add(name);
                    }
                }
                const kids = node.namedChildren || node.children || [];
                for (const c of kids)
                    collectUsages(c);
            };
            if (tree && tree.rootNode)
                collectUsages(tree.rootNode);
            // Now compare declaredIdentifiers against usedIdentifiers and warn about unused
            for (const name of declaredIdentifiers) {
                if (!usedIdentifiers.has(name)) {
                    const posInfo = declaredIdentifierPositions.get(name);
                    if (!posInfo)
                        continue;
                    // Skip state variables by default (they may be read externally)
                    if (posInfo.scope === "state")
                        continue;
                    // Skip intentionally-ignored names like those starting with '_'
                    if (name.startsWith("_"))
                        continue;
                    let lineNum = 0;
                    let colNum = 0;
                    if (posInfo.startPosition &&
                        typeof posInfo.startPosition.row === "number") {
                        lineNum = posInfo.startPosition.row;
                        colNum = posInfo.startPosition.column;
                    }
                    else {
                        const before = content.slice(0, posInfo.startIndex).split(/\r?\n/);
                        lineNum = before.length - 1;
                        colNum = before[before.length - 1].length;
                    }
                    pushFinding(lineNum, colNum, colNum + name.length, `Declared variable '${name}' is never used.`, "UNUSED_VARIABLE", vscode.DiagnosticSeverity.Warning);
                }
            }
        }
        catch (e) {
            // ignore AST usage collection errors
        }
    }
    // AST-based MISSING_PAYABLE detection (more accurate than line heuristic)
    if (tree && rules.missingPayable) {
        try {
            const root = tree.rootNode;
            const walkFunctions = (node) => {
                if (!node)
                    return;
                const t = String(node.type);
                const isStdFunction = t === "function_definition" || t === "function_declaration";
                const isReceiveNode = t === "receive_function_definition"; // tree-sitter special node
                const isFallbackNode = t === "fallback_function_definition"; // tree-sitter special node
                if (isStdFunction || isReceiveNode || isFallbackNode) {
                    const bodyNode = (node.namedChildren || node.children || []).find((c) => String(c.type) === "function_body" || String(c.type) === "block");
                    const headerStart = node.startIndex;
                    const headerEnd = bodyNode ? bodyNode.startIndex : node.endIndex;
                    // Slice header (excluding body) for modifier checks
                    const headerText = content.slice(headerStart, headerEnd);
                    const hasPayable = /\bpayable\b/.test(headerText);
                    // For explicit node types we treat as receive/fallback even if pattern not found (robust to formatting)
                    const isReceive = isReceiveNode || /\breceive\s*\(/.test(headerText);
                    const isFallback = isFallbackNode || /\bfallback\s*\(/.test(headerText);
                    const isConstructor = /\bconstructor\s*\(/.test(headerText);
                    let usesMsgValue = false;
                    if (bodyNode) {
                        const bodyText = content.slice(bodyNode.startIndex, bodyNode.endIndex);
                        usesMsgValue = /\bmsg\s*\.\s*value\b/.test(bodyText);
                    }
                    // Escalate severity for receive(): must be external payable by spec.
                    const shouldWarn = !hasPayable &&
                        (isReceive || usesMsgValue || (isConstructor && usesMsgValue));
                    if (shouldWarn) {
                        let hlStart = headerStart;
                        let hlLen = 8;
                        const tryMark = (kw) => {
                            const m = headerText.match(new RegExp(`\\b${kw}\\b`));
                            if (m && m.index !== undefined) {
                                hlStart = headerStart + m.index;
                                hlLen = m[0].length;
                            }
                        };
                        if (isReceive)
                            tryMark("receive");
                        else if (isFallback)
                            tryMark("fallback");
                        else if (isConstructor)
                            tryMark("constructor");
                        else {
                            const fm = headerText.match(/\bfunction\b\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
                            if (fm && fm.index !== undefined) {
                                const name = fm[1];
                                const nameIdx = headerText.indexOf(name, fm.index);
                                if (nameIdx >= 0) {
                                    hlStart = headerStart + nameIdx;
                                    hlLen = name.length;
                                }
                            }
                        }
                        const before = content.slice(0, hlStart).split(/\r?\n/);
                        const line = before.length - 1;
                        const col = before[before.length - 1].length;
                        const severity = isReceive
                            ? vscode.DiagnosticSeverity.Error
                            : vscode.DiagnosticSeverity.Error; // escalate all confirmed Ether-receiving paths to Error
                        const message = isReceive
                            ? "'receive' function must be marked payable to accept ETH."
                            : isFallback
                                ? "'fallback' function receiving Ether must be payable."
                                : isConstructor && usesMsgValue
                                    ? "Constructor receiving Ether must be payable."
                                    : "Function receiving Ether (reads msg.value) must be payable.";
                        pushFinding(line, col, col + hlLen, message, "MISSING_PAYABLE", severity);
                    }
                }
                const kids = node.namedChildren || node.children || [];
                for (const c of kids)
                    walkFunctions(c);
            };
            if (root)
                walkFunctions(root);
        }
        catch (e) {
            // ignore AST payable detection errors
        }
    }
    // Heuristic: function name suggests accepting Ether (only if not already flagged)
    if (tree && rules.missingPayable && payableHeuristic?.enabled) {
        try {
            const pattern = new RegExp(`^(?:${payableHeuristic.pattern})$`, "i");
            const flaggedKeySet = new Set(findings
                .filter((f) => f.code === "MISSING_PAYABLE")
                .map((f) => `${f.range.start.line}:${f.range.start.character}`));
            const root = tree.rootNode;
            const walk = (node) => {
                if (!node)
                    return;
                const t = String(node.type);
                if (t === "function_definition" || t === "function_declaration") {
                    const bodyNode = (node.namedChildren || node.children || []).find((c) => String(c.type) === "function_body" || String(c.type) === "block");
                    const headerStart = node.startIndex;
                    const headerEnd = bodyNode ? bodyNode.startIndex : node.endIndex;
                    const headerText = content.slice(headerStart, headerEnd);
                    const hasPayable = /\bpayable\b/.test(headerText);
                    const isViewOrPure = /\b(view|pure)\b/.test(headerText);
                    if (!hasPayable && !isViewOrPure) {
                        const nameMatch = headerText.match(/\bfunction\b\s+([A-Za-z_][A-Za-z0-9_]*)/);
                        if (nameMatch && nameMatch[1]) {
                            const fname = nameMatch[1];
                            if (pattern.test(fname)) {
                                // compute location for highlighting name
                                const nameIdx = headerText.indexOf(fname, nameMatch.index);
                                if (nameIdx >= 0) {
                                    const absStart = headerStart + nameIdx;
                                    const before = content.slice(0, absStart).split(/\r?\n/);
                                    const line = before.length - 1;
                                    const col = before[before.length - 1].length;
                                    const key = `${line}:${col}`;
                                    if (!flaggedKeySet.has(key)) {
                                        pushFinding(line, col, col + fname.length, "Function name suggests it should accept Ether; consider adding 'payable'.", "MISSING_PAYABLE", vscode.DiagnosticSeverity.Warning);
                                        flaggedKeySet.add(key);
                                    }
                                }
                            }
                        }
                    }
                }
                const kids = node.namedChildren || node.children || [];
                for (const c of kids)
                    walk(c);
            };
            walk(root);
        }
        catch (e) {
            // ignore heuristic errors
        }
    }
    // =============================================================================
    // PHÂN TÍCH CÚ PHÁP - KIỂM TRA DẤU NGOẶC NHỌN (Phương pháp Stack-based)
    // =============================================================================
    if (rules.missingBraces) {
        const stack = [];
        let extraClosingReported = false;
        // Duyệt qua từng ký tự để kiểm tra dấu ngoặc nhọn khớp nhau
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                if (char === "{") {
                    stack.push({ line: i, col: j });
                }
                else if (char === "}") {
                    if (stack.length === 0) {
                        // Dấu ngoặc nhọn đóng thừa - chỉ báo lỗi 1 lần
                        if (!extraClosingReported) {
                            pushFinding(i, j, j + 1, "Extra closing brace.", "MISSING_BRACES", vscode.DiagnosticSeverity.Error);
                            extraClosingReported = true;
                        }
                    }
                    else {
                        stack.pop();
                    }
                }
            }
        }
        // Nếu còn dấu { chưa được đóng → báo lỗi cho dấu { cuối cùng
        if (stack.length > 0) {
            const lastBrace = stack[stack.length - 1];
            pushFinding(lastBrace.line, lastBrace.col, lastBrace.col + 1, "Missing closing brace.", "MISSING_BRACES", vscode.DiagnosticSeverity.Error);
        }
    }
    // =============================================================================
    // PHÂN TÍCH TỪNG DÒNG
    // =============================================================================
    for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i];
        // Loại bỏ inline comment '//' trên cùng 1 dòng (block comments đã bị xóa phía trên)
        const stripInlineComments = (s) => s.split("//")[0];
        const line = stripInlineComments(rawLine);
        const lineNoInlineComment = line;
        const lineLower = line.toLowerCase();
        const getLastCodeCharIndex = (s) => {
            const codePart = stripInlineComments(s);
            // vị trí ký tự code cuối cùng (bỏ khoảng trắng cuối)
            for (let k = codePart.length - 1; k >= 0; k -= 1) {
                const ch = codePart[k];
                if (ch !== " " && ch !== "\t") {
                    return k;
                }
            }
            return Math.max(0, codePart.length - 1);
        };
        const makeRegex = (pattern) => {
            try {
                return new RegExp(pattern);
            }
            catch (_) {
                return undefined;
            }
        };
        // =============================================================================
        // SECURITY RULES - Cảnh báo các vấn đề bảo mật
        // =============================================================================
        // 1. TX_ORIGIN - Cảnh báo sử dụng tx.origin cho authorization
        if (rules.txOrigin) {
            const idx = lineLower.indexOf("tx.origin");
            if (idx !== -1) {
                pushFinding(i, idx, idx + "tx.origin".length, "Avoid using tx.origin for authorization. Use msg.sender instead.", "TX_ORIGIN", vscode.DiagnosticSeverity.Warning);
            }
        }
        // 2. SELFDESTRUCT - Cảnh báo sử dụng selfdestruct/suicide
        if (rules.selfdestruct) {
            const kw = /(selfdestruct|suicide)\s*\(/i;
            const match = line.match(kw);
            if (match && match.index !== undefined) {
                const idx = match.index;
                pushFinding(i, idx, idx + match[1].length, "selfdestruct can permanently remove contract code. Ensure this is intended and access controlled.", "SELFDESTRUCT", vscode.DiagnosticSeverity.Warning);
            }
        }
        // 3. DELEGATECALL - Cảnh báo sử dụng delegatecall
        if (rules.delegatecall) {
            const kw = /\.delegatecall\s*\(/i;
            const match = line.match(kw);
            if (match && match.index !== undefined) {
                const idx = match.index + 1; // skip the dot
                pushFinding(i, idx, idx + "delegatecall".length, "delegatecall can lead to unexpected context changes. Validate target and data.", "DELEGATECALL", vscode.DiagnosticSeverity.Warning);
            }
        }
        // 4. LOW_LEVEL_CALL_VALUE - Cảnh báo low-level call với value (reentrancy risk)
        if (rules.lowLevelCallValue) {
            const kw1 = /\.call\s*\{\s*value\s*:\s*/i;
            const kw2 = /\.call\.value\s*\(/i; // old style (pre-0.6)
            const match = line.match(kw1) || line.match(kw2);
            if (match && match.index !== undefined) {
                const idx = match.index + 1; // skip the dot
                pushFinding(i, idx, idx +
                    (match[0].toLowerCase().includes("call.value")
                        ? "call.value".length
                        : "call{value:".length), "Low-level call with value can introduce reentrancy. Use Checks-Effects-Interactions and consider .transfer/.send limitations.", "LOW_LEVEL_CALL_VALUE", vscode.DiagnosticSeverity.Warning);
            }
        }
        // =============================================================================
        // SYNTAX RULES - Phát hiện lỗi cú pháp cơ bản
        // =============================================================================
        // 5. MISSING_SEMICOLON - Kiểm tra thiếu dấu chấm phẩy
        if (rules.missingSemicolon) {
            const trimmedLine = line.trim();
            const isCommentOrBlank = (s) => {
                const t = s.trim();
                return t === "" || t.startsWith("//") || t.startsWith("/*");
            };
            // 5.1 Phát hiện khai báo biến rộng rãi (hỗ trợ modifiers) không có dấu chấm phẩy cuối
            // Ví dụ: `uint public number` hoặc `address owner` hoặc `mapping(address => uint) balances`
            const typeKeywordPattern = /^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\()/i;
            const modifierKeywords = new Set([
                "public",
                "private",
                "internal",
                "external",
                "view",
                "pure",
                "payable",
                "constant",
                "immutable",
                "memory",
                "storage",
                "calldata",
            ]);
            const lineForDeclCheck = stripInlineComments(line).trim();
            if (typeKeywordPattern.test(lineForDeclCheck) &&
                !lineForDeclCheck.includes(" function ") &&
                !lineForDeclCheck.startsWith("function ") &&
                !lineForDeclCheck.endsWith(";") &&
                !lineForDeclCheck.endsWith("{") &&
                !lineForDeclCheck.endsWith("}")) {
                // Tránh false positives cho danh sách tham số bằng cách bỏ qua các dòng chứa '(' trừ khi là mapping(
                if (!lineForDeclCheck.includes("(") ||
                    /\bmapping\s*\(/i.test(lineForDeclCheck)) {
                    const tokens = lineForDeclCheck
                        .replace(/\b(mapping\s*\([^)]*\))/gi, "mapping")
                        .split(/\s+/)
                        .filter(Boolean);
                    // Tìm một identifier token hợp lý không phải là modifier hoặc type keyword
                    let hasIdentifier = false;
                    for (let tIndex = 1; tIndex < tokens.length; tIndex += 1) {
                        const tok = tokens[tIndex];
                        const isModifier = modifierKeywords.has(tok.toLowerCase());
                        const isType = typeKeywordPattern.test(tok);
                        const isArray = /\[.*\]$/.test(tok);
                        const isIdentifier = /[A-Za-z_][A-Za-z0-9_]*/.test(tok);
                        if (!isModifier && !isType && isIdentifier && !isArray) {
                            hasIdentifier = true;
                            break;
                        }
                    }
                    if (hasIdentifier) {
                        const idx = getLastCodeCharIndex(line);
                        pushFinding(i, idx, idx + 1, "Missing semicolon at end of declaration.", "MISSING_SEMICOLON", vscode.DiagnosticSeverity.Error);
                    }
                }
            }
            // 5.2 Các câu lệnh một dòng yêu cầu dấu chấm phẩy
            const needsSemicolon = [
                /^\s*\w+\s*=\s*[^=]/i, // Câu lệnh gán
                /^\s*(require|assert|revert)\s*\(/i, // Require/assert/revert
                /^\s*(emit|return|break|continue)\b/i, // Luồng điều khiển
            ];
            for (const pattern of needsSemicolon) {
                if (pattern.test(stripInlineComments(line))) {
                    if (!stripInlineComments(trimmedLine).endsWith(";") &&
                        !stripInlineComments(trimmedLine).endsWith("{") &&
                        !stripInlineComments(trimmedLine).endsWith("}") &&
                        !isCommentOrBlank(trimmedLine)) {
                        const idx = getLastCodeCharIndex(line);
                        pushFinding(i, idx, idx + 1, "Missing semicolon at end of statement.", "MISSING_SEMICOLON", vscode.DiagnosticSeverity.Error);
                        break;
                    }
                }
            }
            // 5.3 Câu lệnh nhiều dòng kết thúc bằng ')' mà không có ';'
            // Ví dụ: assignment hoặc call được chia thành nhiều dòng, dòng cuối kết thúc bằng ')'
            if (stripInlineComments(trimmedLine).endsWith(")") &&
                !stripInlineComments(trimmedLine).endsWith(";") &&
                !isCommentOrBlank(trimmedLine)) {
                // Nhìn lại tối đa 5 dòng để tìm starter cần dấu chấm phẩy
                const lookbackLimit = Math.max(0, i - 5);
                let foundStarter = false;
                let isLastLineOfStatement = true;
                // Kiểm tra xem đây có phải là dòng cuối của câu lệnh nhiều dòng không
                // bằng cách xem dòng không trống tiếp theo
                for (let k = i + 1; k < lines.length; k++) {
                    const nextLine = stripInlineComments(lines[k]).trim();
                    if (nextLine === "") {
                        continue; // Bỏ qua dòng trống
                    }
                    // Nếu dòng tiếp theo bắt đầu một câu lệnh mới hoặc là dấu ngoặc nhọn đóng, đây là dòng cuối
                    if (nextLine.startsWith("require") ||
                        nextLine.startsWith("emit") ||
                        nextLine.startsWith("return") ||
                        nextLine.startsWith("}") ||
                        nextLine.startsWith("function") ||
                        nextLine.startsWith("contract") ||
                        nextLine.startsWith("modifier") ||
                        nextLine.startsWith("event") ||
                        nextLine.startsWith("struct") ||
                        nextLine.startsWith("enum")) {
                        break;
                    }
                    // Nếu dòng tiếp theo là một phần của cùng một câu lệnh (không bắt đầu với từ khóa câu lệnh),
                    // thì đây không phải là dòng cuối
                    isLastLineOfStatement = false;
                    break;
                }
                if (!isLastLineOfStatement) {
                    continue; // Bỏ qua nếu đây không phải là dòng cuối của câu lệnh
                }
                for (let j = i - 1; j >= lookbackLimit; j -= 1) {
                    const prev = lines[j];
                    const prevNoComment = stripInlineComments(prev).trim();
                    if (isCommentOrBlank(prevNoComment)) {
                        continue;
                    }
                    // Nếu gặp dòng đã kết thúc bằng ';' hoặc bắt đầu/kết thúc block, dừng lại
                    if (prevNoComment.endsWith(";") ||
                        prevNoComment.endsWith("{") ||
                        prevNoComment.endsWith("}")) {
                        break;
                    }
                    // Kiểm tra các pattern khác nhau cần dấu chấm phẩy
                    const needsSemicolonPatterns = [
                        /^\s*\w+\s*=\s*[^=]/i, // Câu lệnh gán
                        /^\s*(require|assert|revert|emit|return)\b/i, // Luồng điều khiển
                        /^\s*\([^)]*\)\s*=/i, // Tuple assignment như "(bool success, ) = ..."
                        /^\s*\w+\.\w+\s*\(/i, // Method calls như "logic.delegatecall("
                        /^\s*\w+\s*\(/i, // Function calls
                    ];
                    const hasPattern = needsSemicolonPatterns.some((pattern) => pattern.test(prevNoComment));
                    if (hasPattern) {
                        foundStarter = true;
                        break;
                    }
                }
                if (foundStarter) {
                    const idx = getLastCodeCharIndex(line);
                    pushFinding(i, idx, idx + 1, "Missing semicolon at end of statement.", "MISSING_SEMICOLON", vscode.DiagnosticSeverity.Error);
                }
            }
            // 5.4 Identifier đơn lẻ ở cuối dòng mà không có dấu chấm phẩy (như "logic" trong ví dụ của user)
            // Điều này bắt các trường hợp một identifier đơn lẻ bị treo ở cuối dòng
            const singleIdentifierPattern = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*$/;
            if (singleIdentifierPattern.test(stripInlineComments(trimmedLine)) &&
                !isCommentOrBlank(trimmedLine)) {
                // Đảm bảo nó không phải là function declaration, modifier, hoặc các câu lệnh single-word hợp lệ khác
                const isFunctionDeclaration = /^\s*(function|modifier|event|struct|enum|contract|interface|library)\b/i.test(trimmedLine);
                const isImportStatement = /^\s*(import|pragma)\b/i.test(trimmedLine);
                const isUsingStatement = /^\s*using\b/i.test(trimmedLine);
                const isConstructor = /^\s*constructor\b/i.test(trimmedLine);
                if (!isFunctionDeclaration &&
                    !isImportStatement &&
                    !isUsingStatement &&
                    !isConstructor) {
                    const idx = getLastCodeCharIndex(line);
                    pushFinding(i, idx, idx + 1, "Missing semicolon at end of statement.", "MISSING_SEMICOLON", vscode.DiagnosticSeverity.Error);
                }
            }
        }
        // 6. MISSING_PARENTHESES - improved checks
        if (rules.missingParentheses) {
            // First: character-level pass over the whole comment-stripped content to find
            // unmatched parentheses (extra closing or missing closing).
            // We'll do this only once per analysis (so guard by a flag on first line i==0).
            if (i === 0) {
                const parenStack = [];
                let lineIdx = 0;
                let colIdx = 0;
                // Use original content indices for accurate mapping to AST node ranges
                const text = content;
                for (let p = 0; p < text.length; p += 1) {
                    const ch = text[p];
                    // skip characters that are inside comment ranges
                    const inComment = commentRanges.some(([s, e]) => p >= s && p < e);
                    if (inComment) {
                        if (ch === "\n") {
                            lineIdx += 1;
                            colIdx = 0;
                        }
                        else {
                            colIdx += 1;
                        }
                        continue;
                    }
                    if (ch === "\n") {
                        lineIdx += 1;
                        colIdx = 0;
                        continue;
                    }
                    if (ch === "(") {
                        parenStack.push({ line: lineIdx, col: colIdx, idx: p });
                    }
                    else if (ch === ")") {
                        if (parenStack.length === 0) {
                            // Extra closing parenthesis — decide whether it's an unmatched ')' or
                            // a missing opening '(' after a keyword like `require`.
                            const inIgnored = ignoredRanges.some(([s, e]) => p >= s && p < e);
                            const currentLine = content.split(/\r?\n/)[lineIdx] || "";
                            const currentLineText = currentLine;
                            // Look for keywords that normally take parentheses
                            const callKeywords = /\b(require|assert|revert|emit)\b/gi;
                            let lastMatch = null;
                            let mTmp;
                            while ((mTmp = callKeywords.exec(currentLineText)) !== null) {
                                if (mTmp.index < colIdx)
                                    lastMatch = mTmp;
                                else
                                    break;
                            }
                            if (!inIgnored && lastMatch) {
                                const kwStart = lastMatch.index;
                                const kwName = lastMatch[1] ||
                                    currentLineText.slice(kwStart).split(/\s+/)[0];
                                const kwEnd = kwStart + kwName.length;
                                // If there is no '(' between keyword end and this ')' then it's likely
                                // a missing opening parenthesis after the keyword. Report at keyword.
                                const between = currentLineText.slice(kwEnd, colIdx);
                                if (between.indexOf("(") === -1) {
                                    pushFinding(lineIdx, kwStart, kwEnd, `Missing opening parenthesis after '${kwName}'.`, "MISSING_PARENTHESES", vscode.DiagnosticSeverity.Error);
                                }
                                else {
                                    // There's a '(' earlier — fallback to extra closing report
                                    pushFinding(lineIdx, colIdx, colIdx + 1, "Extra closing parenthesis.", "MISSING_PARENTHESES", vscode.DiagnosticSeverity.Error);
                                }
                            }
                            else if (!inIgnored) {
                                // No keyword detected before this ')', report extra closing
                                pushFinding(lineIdx, colIdx, colIdx + 1, "Extra closing parenthesis.", "MISSING_PARENTHESES", vscode.DiagnosticSeverity.Error);
                            }
                        }
                        else {
                            parenStack.pop();
                        }
                    }
                    colIdx += 1;
                }
                // Any remaining '(' without matching ')' → report for the last one
                if (parenStack.length > 0) {
                    const last = parenStack[parenStack.length - 1];
                    // skip if the '(' is inside ignored AST node (e.g., return)
                    const inIgnoredOpen = ignoredRanges.some(([s, e]) => last.idx >= s && last.idx < e);
                    const lastLineText = (content.split(/\r?\n/)[last.line] || "").trim();
                    if (!inIgnoredOpen) {
                        pushFinding(last.line, last.col, last.col + 1, "Missing closing parenthesis.", "MISSING_PARENTHESES", vscode.DiagnosticSeverity.Error);
                    }
                }
            }
            const trimmedLine = line.trim();
            if (trimmedLine === "")
                continue;
            // --- Control statements: if / for / while should be followed by '('
            const controlRx = /^\s*(if|for|while)\b/;
            const controlMatch = line.match(controlRx);
            if (controlMatch) {
                const kw = controlMatch[1];
                const kwIdx = lineLower.indexOf(kw);
                // find first non-space char after keyword
                let j = kwIdx + kw.length;
                while (j < line.length && /\s/.test(line[j]))
                    j += 1;
                const nextCh = line[j] || "";
                // allow '(' on next non-empty line (multi-line condition)
                const allowMultiLineParen = () => {
                    for (let k = i + 1; k < Math.min(lines.length, i + 4); k += 1) {
                        const nxt = lines[k].trim();
                        if (nxt === "")
                            continue;
                        return nxt[0] === "(";
                    }
                    return false;
                };
                if (nextCh !== "(") {
                    if (!allowMultiLineParen()) {
                        pushFinding(i, kwIdx, kwIdx + kw.length, `Missing parentheses after '${kw}'.`, "MISSING_PARENTHESES", vscode.DiagnosticSeverity.Error);
                        // don't continue; still run other checks
                    }
                }
            }
            // --- Function-call style: detect identifier (or member access) followed by
            // whitespace and then an argument token, but with no '(' after the identifier.
            // Examples to catch: `transfer msg.sender;` → should be `transfer(msg.sender);`
            // Conservative: skip lines that look like declarations or assignments.
            const declOrKeyword = /\b(function|contract|interface|library|event|modifier|struct|enum|pragma|import)\b/i;
            const stmtKeywordRx = /^\s*(return|emit|require|assert|revert|break|continue)\b/i;
            if (declOrKeyword.test(line) || stmtKeywordRx.test(line)) {
                // skip declaration or statement lines
            }
            else {
                // candidate detection
                const funcCallRx = /(^|\s)([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+)([A-Za-z_0-9`"'\[\{])/g;
                // Modifiers/visibility keywords to ignore when matched as 'identifier'
                const modifierKeywords = new Set([
                    "public",
                    "private",
                    "internal",
                    "external",
                    "view",
                    "pure",
                    "payable",
                    "constant",
                    "immutable",
                    "memory",
                    "storage",
                    "calldata",
                ]);
                const reservedNames = new Set([
                    "return",
                    "emit",
                    "require",
                    "assert",
                    "revert",
                    "break",
                    "continue",
                ]);
                let m;
                while ((m = funcCallRx.exec(line)) !== null) {
                    const full = m[0];
                    const name = m[2];
                    const nameIdx = m.index + (m[1] ? m[1].length : 0);
                    // ensure there's no '(' after the name before end-of-statement or before ';'
                    const after = line.slice(nameIdx + name.length);
                    const nextParen = after.indexOf("(");
                    const nextSemi = after.indexOf(";");
                    // If '(' appears and before ; or end, it's fine
                    if (nextParen >= 0 && (nextSemi === -1 || nextParen < nextSemi)) {
                        continue; // has parentheses — OK
                    }
                    // If the candidate name is a modifier/visibility keyword, skip it
                    if (modifierKeywords.has(name.toLowerCase()))
                        continue;
                    // Skip reserved names
                    if (reservedNames.has(name.toLowerCase()))
                        continue;
                    // If there's a ')' before this name in the same line, it's likely part of a function declaration (e.g., receive() external)
                    const prefix = line.slice(0, nameIdx);
                    if (prefix.indexOf(")") !== -1)
                        continue;
                    // Basic exclusions: if this is likely a type or mapping annotation, skip
                    if (/^(uint|int|address|bool|string|bytes|mapping)\b/i.test(line.trim()))
                        continue;
                    // If the name is immediately followed by ':' or '=' in original, skip
                    const afterNameTrim = after.trimLeft();
                    if (afterNameTrim.startsWith(":") || afterNameTrim.startsWith("= "))
                        continue;
                    // Heuristic: only report when line ends with ';' or ',' or when name appears to be a call site
                    const lineEndsCallish = /[;,)\]}\s]$/.test(line) || /;/.test(line);
                    if (lineEndsCallish) {
                        pushFinding(i, nameIdx, nameIdx + name.length, "Missing parentheses for function call.", "MISSING_PARENTHESES", vscode.DiagnosticSeverity.Error);
                    }
                }
            }
        }
        // 7. MISSING_RETURN - Kiểm tra thiếu return statement
        if (rules.missingReturn) {
            // Kiểm tra function có return type nhưng thiếu return
            const functionWithReturnType = /\bfunction\s+\w+\s*\([^)]*\)\s*(public|private|internal|external)?\s*(pure|view|payable)?\s*returns\s*\([^)]*\)/i;
            if (functionWithReturnType.test(line)) {
                // TODO: Cần parse function body để kiểm tra return statement
                // Logic này phức tạp vì cần context về function body
            }
        }
        // 8. WRONG_KEYWORDS - Kiểm tra từ khóa deprecated/sai
        if (rules.wrongKeywords) {
            const wrongKeywords = [
                {
                    pattern: /\b(var\s+)/i,
                    correct: "uint",
                    message: "Use specific data type instead of 'var'",
                },
                {
                    pattern: /\b(suicide\s*\()/i,
                    correct: "selfdestruct",
                    message: "'suicide' is deprecated, use 'selfdestruct'",
                },
            ];
            for (const { pattern, message } of wrongKeywords) {
                const match = line.match(pattern);
                if (match && match.index !== undefined) {
                    const idx = match.index;
                    pushFinding(i, idx, idx + match[1].length, message, "WRONG_KEYWORD", vscode.DiagnosticSeverity.Warning);
                }
            }
        }
        // 9. MISSING_DATA_TYPE - Kiểm tra khai báo biến thiếu kiểu dữ liệu
        if (rules.missingDataType) {
            const noComment = stripInlineComments(line);
            // Nếu dòng chứa khai báo với kiểu (ví dụ: "address public owner;"), nhớ tên biến
            // để tránh báo false-positive khi sau đó chỉ gán giá trị cho biến đã khai báo.
            try {
                const typeKeywordPattern = /^(?:.*\b(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping)\b)/i;
                if (!/\bfunction\b/i.test(noComment) &&
                    typeKeywordPattern.test(noComment)) {
                    // Tokenize và lấy các identifier sau từ khóa kiểu, bỏ các modifiers
                    const normalized = noComment.replace(/\b(mapping\s*\([^)]*\))/gi, "mapping");
                    const tokens = normalized.split(/\s+/).filter(Boolean);
                    const modifierKeywords = new Set([
                        "public",
                        "private",
                        "internal",
                        "external",
                        "view",
                        "pure",
                        "payable",
                        "constant",
                        "immutable",
                        "memory",
                        "storage",
                        "calldata",
                    ]);
                    // Tìm token đầu tiên không phải modifier và không phải kiểu
                    let seenType = false;
                    for (let t = 0; t < tokens.length; t += 1) {
                        const tok = tokens[t].replace(/[,;{}()]$/g, "");
                        if (!seenType) {
                            if (/^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping)$/i.test(tok)) {
                                seenType = true;
                            }
                            continue;
                        }
                        // after type: skip modifiers
                        if (modifierKeywords.has(tok.toLowerCase()))
                            continue;
                        // now tok is likely an identifier (may be comma separated list)
                        const parts = tok.split(/[,;]+/).filter(Boolean);
                        for (const p of parts) {
                            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p)) {
                                declaredIdentifiers.add(p);
                            }
                        }
                        // Continue scanning to capture multiple declarators in same line
                    }
                }
            }
            catch (e) {
                // ignore tokenization issues — not critical
            }
            // 9.1 Thiếu kiểu ở khai báo biến (trong cùng dòng, kể cả sau '{')
            // Tìm các đoạn bắt đầu câu hoặc sau ';' hoặc '{' có dạng <identifier> =
            const assignRx = /(^(?:\s*)|[;{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
            let mAssign;
            while ((mAssign = assignRx.exec(noComment)) !== null) {
                const prefix = mAssign[1] || "";
                const name = mAssign[2];
                // Nếu identifier đã được khai báo trước đó (có kiểu), bỏ qua — đây là assignment thường
                if (declaredIdentifiers.has(name)) {
                    // tránh vòng lặp vô hạn nếu regex match zero-width
                    if (assignRx.lastIndex === mAssign.index)
                        assignRx.lastIndex += 1;
                    continue;
                }
                const nameStart = mAssign.index + prefix.length;
                // Báo lỗi: thiếu kiểu dữ liệu cho biến
                pushFinding(i, nameStart, nameStart + name.length, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                missingTypeIdentifiers.add(name);
                // tránh vòng lặp vô hạn nếu regex match zero-width
                if (assignRx.lastIndex === mAssign.index)
                    assignRx.lastIndex += 1;
            }
            // 9.1.a Khai báo mảng thiếu kiểu dữ liệu: [] a; hoặc [] a = ...
            const arrayDeclRx = /(^(?:\s*)|[;{]\s*)(\[\s*\])\s*([A-Za-z_][A-Za-z0-9_]*)\s*(;|=)/g;
            let mArray;
            while ((mArray = arrayDeclRx.exec(noComment)) !== null) {
                const prefix = mArray[1] || "";
                const bracket = mArray[2];
                const name = mArray[3];
                const bracketStart = mArray.index + prefix.length; // vị trí '['
                pushFinding(i, bracketStart, bracketStart + bracket.length, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                // Không thêm tên biến mảng vào danh sách theo dõi để tránh báo lỗi trùng tại tên
                if (arrayDeclRx.lastIndex === mArray.index)
                    arrayDeclRx.lastIndex += 1;
            }
            // 9.1.b Thiếu kiểu trong tuple assignment: (success, ...) = ...
            const tuple = noComment.match(/\(([^)]*)\)\s*=/);
            if (tuple && tuple.index !== undefined) {
                const content = tuple[1];
                const tupleStart = noComment.indexOf(content);
                const parts = content.split(",");
                let cursor = tupleStart;
                for (const rawPart of parts) {
                    const part = rawPart;
                    const trimmed = part.trim();
                    if (trimmed === "") {
                        cursor += part.length + 1;
                        continue;
                    }
                    const startsWithType = /^(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)\b/i.test(trimmed);
                    if (!startsWithType) {
                        const idMatch = part.match(/[A-Za-z_][A-Za-z0-9_]*/);
                        if (idMatch && idMatch.index !== undefined) {
                            const startCol = cursor + idMatch.index;
                            pushFinding(i, startCol, startCol + idMatch[0].length, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                            missingTypeIdentifiers.add(idMatch[0]);
                        }
                    }
                    cursor += part.length + 1;
                }
            }
            // 9.1.c Thiếu kiểu trong khai báo kết thúc bằng ';' không có '='
            // Ví dụ: "public number;" hoặc "number;"
            const semiDecl = noComment.match(/^\s*(public|private|internal|external)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/);
            if (semiDecl && semiDecl.index !== undefined) {
                // Nếu dòng không chứa bất kỳ type keyword nào, coi là thiếu kiểu
                const hasType = /(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+)/i.test(noComment);
                if (!hasType) {
                    const name = semiDecl[2];
                    const nameIdx = noComment.indexOf(name);
                    if (nameIdx >= 0) {
                        pushFinding(i, nameIdx, nameIdx + name.length, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                        missingTypeIdentifiers.add(name);
                    }
                }
            }
            // 9.2 Thiếu kiểu trong danh sách tham số hàm (chỉ xử lý khi có cùng dòng)
            const funcSig = noComment.match(/\bfunction\b[^\{]*\(([^)]*)\)/);
            if (funcSig && funcSig.index !== undefined) {
                const paramsStr = funcSig[1];
                let cursor = noComment.indexOf(paramsStr);
                const params = paramsStr.split(",");
                for (const p of params) {
                    const raw = p;
                    const param = p.trim();
                    if (param === "") {
                        cursor += raw.length + 1; // +1 for comma
                        continue;
                    }
                    // 9.2.a Tham số mảng thiếu element type: [] memory words
                    const arrParamStarts = /^\s*\[\s*\]\s*(?:memory|calldata|storage)?\s*[A-Za-z_][A-Za-z0-9_]*/i.test(param);
                    if (arrParamStarts) {
                        const leading = raw.match(/^\s*/)?.[0].length ?? 0;
                        const bracketRel = raw.slice(leading).indexOf("[");
                        if (bracketRel >= 0) {
                            const bracketStart = cursor + leading + bracketRel;
                            pushFinding(i, bracketStart, bracketStart + 2, // highlight "[]"
                            "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                            cursor += raw.length + 1;
                            continue;
                        }
                    }
                    // Nếu tham số bắt đầu không phải type (mà là identifier) → lỗi
                    const startsWithType = /^(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)\b/i.test(param);
                    if (!startsWithType) {
                        const idMatch = raw.match(/[A-Za-z_][A-Za-z0-9_]*/);
                        if (idMatch && idMatch.index !== undefined) {
                            const startCol = cursor + idMatch.index;
                            const len = idMatch[0].length;
                            pushFinding(i, startCol, startCol + len, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                            missingTypeIdentifiers.add(idMatch[0]);
                        }
                    }
                    cursor += raw.length + 1; // move past this param and comma
                }
                // 9.2.c Fallback: bắt tham số chỉ là 1 identifier (không type)
                const reUntypedParam = /(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=,|$)/g;
                let mUntyped;
                while ((mUntyped = reUntypedParam.exec(paramsStr)) !== null) {
                    const ident = mUntyped[1];
                    // Kiểm tra lại xem đoạn tham số này có chứa type keyword ở trước không (trong cùng phân đoạn)
                    // Lấy phân đoạn thô từ dấu phẩy trước đến dấu phẩy sau
                    const segStart = mUntyped.index;
                    const segEnd = reUntypedParam.lastIndex;
                    const segment = paramsStr.slice(segStart, segEnd);
                    const hasTypeInSeg = /(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)/i.test(segment);
                    if (!hasTypeInSeg) {
                        const absIdx = noComment.indexOf(paramsStr) + segStart + segment.indexOf(ident);
                        pushFinding(i, absIdx, absIdx + ident.length, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                    }
                    if (reUntypedParam.lastIndex === mUntyped.index)
                        reUntypedParam.lastIndex += 1;
                }
                // 9.2.d Fallback cuối: bắt tham số cuối cùng không type trước dấu ')'
                const tail = paramsStr.match(/,\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
                if (tail && tail.index !== undefined) {
                    const segStart = tail.index;
                    const segment = paramsStr.slice(segStart);
                    const hasTypeInSeg = /(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)/i.test(segment);
                    if (!hasTypeInSeg) {
                        const ident = tail[1];
                        const absIdx = noComment.indexOf(paramsStr) + segStart + segment.indexOf(ident);
                        pushFinding(i, absIdx, absIdx + ident.length, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                    }
                }
            }
            // 9.2.b Fallback chắc chắn: quét trực tiếp tham số mảng thiếu element type trong toàn bộ danh sách tham số
            const funcLine = noComment;
            const parenStart = funcLine.indexOf("(");
            const parenEnd = funcLine.indexOf(")", parenStart + 1);
            if (parenStart >= 0 && parenEnd > parenStart) {
                const inside = funcLine.slice(parenStart + 1, parenEnd);
                const baseIndex = parenStart + 1;
                const reEmptyArrayParam = /\[\s*\]\s*(?:memory|calldata|storage)?\s*[A-Za-z_][A-Za-z0-9_]*/g;
                let mArr;
                while ((mArr = reEmptyArrayParam.exec(inside)) !== null) {
                    const firstBracketRel = mArr[0].indexOf("[");
                    const relIdx = mArr.index + firstBracketRel;
                    // Kiểm tra ký tự không phải khoảng trắng ngay trước '[' để tránh match "string[]"
                    let k = relIdx - 1;
                    while (k >= 0 && /\s/.test(inside[k]))
                        k -= 1;
                    const prevChar = k >= 0 ? inside[k] : "";
                    const prevIsTyped = /[A-Za-z0-9_\]]/.test(prevChar); // 'string[]' hoặc 'bytes32[]'
                    if (prevIsTyped) {
                        // Bỏ qua vì đây là typed array hợp lệ
                        if (reEmptyArrayParam.lastIndex === mArr.index)
                            reEmptyArrayParam.lastIndex += 1;
                        continue;
                    }
                    const absIdx = baseIndex + relIdx;
                    pushFinding(i, absIdx, absIdx + 2, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                    if (reEmptyArrayParam.lastIndex === mArr.index)
                        reEmptyArrayParam.lastIndex += 1;
                }
            }
        }
        // 9.x Sử dụng biến thiếu kiểu dữ liệu sau khi đã đánh dấu
        if (missingTypeIdentifiers.size > 0) {
            const noComment = stripInlineComments(line);
            for (const id of missingTypeIdentifiers) {
                const rx = new RegExp(`\\b${id}\\b`);
                const mUse = noComment.match(rx);
                if (mUse && mUse.index !== undefined) {
                    const start = mUse.index;
                    pushFinding(i, start, start + id.length, "Missing data type declaration for variable.", "MISSING_DATA_TYPE", vscode.DiagnosticSeverity.Error);
                }
            }
        }
        // 10. MISSING_PAYABLE - Kiểm tra thiếu payable modifier
        // 10.a receive(): luôn phải payable – báo lỗi đỏ cả khi có AST (fallback chắc chắn)
        if (rules.missingPayable) {
            const noComment = stripInlineComments(line);
            const isReceiveDecl = /\breceive\s*\(\s*\)/i.test(noComment);
            if (isReceiveDecl && !/\bpayable\b/i.test(noComment)) {
                const idx = noComment.search(/\breceive\b/i);
                if (idx >= 0) {
                    pushFinding(i, idx, idx + "receive".length, "'receive' function must be marked payable to accept ETH.", "MISSING_PAYABLE", vscode.DiagnosticSeverity.Error);
                }
            }
        }
        // 10.b Heuristic cho các hàm thường (chỉ chạy khi không có AST để tránh nhiễu)
        if (rules.missingPayable && !tree) {
            // Kiểm tra function có thể nhận ETH nhưng thiếu payable
            const functionPattern = /\bfunction\s+\w+\s*\([^)]*\)\s*(public|private|internal|external)?\s*(pure|view)?\s*(?!payable)/i;
            const hasValueTransfer = /\.transfer\(|\.send\(|\.call\{.*value/i;
            if (functionPattern.test(line) && hasValueTransfer.test(content)) {
                const match = line.match(functionPattern);
                if (match && match.index !== undefined) {
                    const idx = match.index;
                    pushFinding(i, idx, idx + match[0].length, "Function that handles ETH should have 'payable' modifier.", "MISSING_PAYABLE", vscode.DiagnosticSeverity.Warning);
                }
            }
        }
        // =============================================================================
        // NAMING RULES - Quy tắc đặt tên function/variable
        // =============================================================================
        // 11. FUNCTION_NAMING - Kiểm tra tên hàm
        if (rules.functionNaming && naming) {
            const lineClean = stripInlineComments(line);
            const mFunc = lineClean.match(/\bfunction\b([^\(]*)\(/);
            if (mFunc && mFunc.index !== undefined) {
                const seg = mFunc[1];
                const segStart = mFunc.index + mFunc[0].indexOf(seg);
                // Bỏ khoảng trắng đầu
                const leadingWs = seg.match(/^\s*/)?.[0].length ?? 0;
                const firstIdx = leadingWs;
                const firstAbs = segStart + firstIdx;
                const firstCh = seg[firstIdx];
                // Nếu ký tự đầu không phải là chữ hoặc '_' → lỗi ngay tại đó
                if (!firstCh || !/[A-Za-z_]/.test(firstCh)) {
                    pushFinding(i, firstAbs, firstAbs + 1, "Invalid function identifier.", "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
                }
                else {
                    // Lấy identifier đầu
                    const idMatch = seg.slice(firstIdx).match(/^[A-Za-z_][A-Za-z0-9_]*/);
                    const name = idMatch ? idMatch[0] : "";
                    const nameStart = firstAbs;
                    const nameEnd = nameStart + name.length;
                    // Kiểm tra phần còn lại trước '('
                    const rest = seg.slice(firstIdx + name.length);
                    if (/[^\s]/.test(rest)) {
                        // Có ký tự lạ như '.' hoặc extra token → lỗi tổng quát
                        pushFinding(i, nameStart, nameEnd, "Invalid function identifier.", "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
                    }
                    else {
                        const fnRegex = makeRegex(naming.functionPattern);
                        if (fnRegex && !fnRegex.test(name)) {
                            pushFinding(i, nameStart, nameEnd, `Invalid function identifier '${name}'.`, "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
                        }
                    }
                }
            }
        }
        // 12. VARIABLE_NAMING - Kiểm tra tên biến (state/local)
        if (rules.variableNaming && naming) {
            // Heuristic: a declaration that starts with a type keyword or mapping(
            const decl = stripInlineComments(line).trim();
            const startsWithType = /^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+)/i.test(decl);
            const isFunctionLine = /^\s*function\b/i.test(decl);
            const isEventOrOther = /^\s*(contract|interface|library|event|modifier|enum|struct)\b/i.test(decl);
            if (startsWithType && !isFunctionLine && !isEventOrOther) {
                // Remove mapping generics to simplify tokenization
                const normalized = decl.replace(/\b(mapping\s*\([^)]*\))/gi, "mapping");
                const tokens = normalized.split(/\s+/).filter(Boolean);
                // Find first identifier token after type and modifiers
                const modifierKeywords = new Set([
                    "public",
                    "private",
                    "internal",
                    "external",
                    "view",
                    "pure",
                    "payable",
                    "constant",
                    "immutable",
                    "memory",
                    "storage",
                    "calldata",
                ]);
                let identifier;
                let identifierStart = -1;
                let identifierTokenIndex = -1;
                // Find index in original line as well
                const original = stripInlineComments(line);
                // Iterate tokens; skip first (type)
                for (let t = 1; t < tokens.length; t += 1) {
                    const tok = tokens[t];
                    const isModifier = modifierKeywords.has(tok.toLowerCase());
                    const isArray = /\[.*\]$/.test(tok);
                    if (!isModifier && !isArray) {
                        // Lấy token tên thô, bỏ các ký tự kết thúc như ';', '=', '{' (KHÔNG bỏ dấu ',')
                        const base = tok.replace(/[;={].*$/, "").trim();
                        if (base.length > 0) {
                            identifier = base;
                            identifierStart = original.indexOf(tok);
                            identifierTokenIndex = t;
                            break;
                        }
                    }
                }
                if (identifier && identifierStart >= 0) {
                    // Nếu token tiếp theo cũng là identifier (ví dụ: "num ber"), coi như có khoảng trắng trong tên → lỗi tại token đầu
                    const nextTok = tokens[identifierTokenIndex + 1];
                    const nextIsArray = nextTok ? /\[.*\]$/.test(nextTok) : false;
                    const nextIsModifier = nextTok
                        ? modifierKeywords.has(nextTok?.toLowerCase())
                        : false;
                    const nextLooksIdentifier = nextTok
                        ? /^[A-Za-z_][A-Za-z0-9_]*;?$/.test(nextTok)
                        : false;
                    if (nextTok &&
                        !nextIsArray &&
                        !nextIsModifier &&
                        nextLooksIdentifier) {
                        pushFinding(i, identifierStart, identifierStart + identifier.length, "Invalid variable identifier.", "VARIABLE_NAMING", vscode.DiagnosticSeverity.Error);
                    }
                    else {
                        const identifierEnd = identifierStart + identifier.length;
                        const isConstant = /\b(constant|immutable)\b/i.test(decl) ||
                            /\bconstant\b/i.test(decl);
                        const varRegex = makeRegex(isConstant ? naming.constantPattern : naming.variablePattern);
                        if (varRegex && !varRegex.test(identifier)) {
                            pushFinding(i, identifierStart, identifierEnd, `Invalid variable identifier '${identifier}'.`, "VARIABLE_NAMING", vscode.DiagnosticSeverity.Error);
                        }
                    }
                }
            }
        }
        // 13. CONTRACT_NAMING - Kiểm tra tên contract/interface/library
        if (rules.contractNaming && naming) {
            const decl = stripInlineComments(line);
            const m = decl.match(/\b(contract|interface|library)\b([^\{]*)\{/);
            if (m && m.index !== undefined) {
                const seg = m[2];
                const segStart = m.index + m[0].indexOf(seg);
                const leadingWs = seg.match(/^\s*/)?.[0].length ?? 0;
                const firstIdx = leadingWs;
                const firstAbs = segStart + firstIdx;
                const firstCh = seg[firstIdx];
                if (!firstCh || !/[A-Za-z_]/.test(firstCh)) {
                    pushFinding(i, firstAbs, firstAbs + 1, "Invalid contract/interface/library identifier.", "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
                }
                else {
                    const idMatch = seg.slice(firstIdx).match(/^[A-Za-z_][A-Za-z0-9_]*/);
                    const name = idMatch ? idMatch[0] : "";
                    const nameStart = firstAbs;
                    const nameEnd = nameStart + name.length;
                    const rest = seg.slice(firstIdx + name.length);
                    if (/[^\s]/.test(rest)) {
                        pushFinding(i, nameStart, nameEnd, "Invalid contract/interface/library identifier.", "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
                    }
                    else {
                        const rx = makeRegex(naming.contractPattern);
                        if (rx && !rx.test(name)) {
                            pushFinding(i, nameStart, nameEnd, `Invalid contract/interface/library identifier '${name}'.`, "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
                        }
                    }
                }
            }
        }
    }
    return findings;
}
//# sourceMappingURL=solidityAnalyzer.js.map