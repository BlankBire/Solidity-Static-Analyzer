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
exports.runPayableAstAndHeuristic = runPayableAstAndHeuristic;
exports.runPayableLineFallbackSingle = runPayableLineFallbackSingle;
const vscode = __importStar(require("vscode"));
/**
 * AST-based payable detection and name-heuristic suggestion.
 * Mirrors logic previously embedded in the analyzer.
 */
function runPayableAstAndHeuristic(content, tree, enabled, heuristic, pushFinding) {
    if (!enabled)
        return;
    // AST-based detection
    if (tree) {
        try {
            const root = tree.rootNode;
            const walkFunctions = (node) => {
                if (!node)
                    return;
                const t = String(node.type);
                const isStdFunction = t === "function_definition" || t === "function_declaration";
                const isReceiveNode = t === "receive_function_definition";
                const isFallbackNode = t === "fallback_function_definition";
                if (isStdFunction || isReceiveNode || isFallbackNode) {
                    const bodyNode = (node.namedChildren || node.children || []).find((c) => String(c.type) === "function_body" || String(c.type) === "block");
                    const headerStart = node.startIndex;
                    const headerEnd = bodyNode ? bodyNode.startIndex : node.endIndex;
                    const headerText = content.slice(headerStart, headerEnd);
                    const hasPayable = /\bpayable\b/.test(headerText);
                    const isReceive = isReceiveNode || /\breceive\s*\(/.test(headerText);
                    const isFallback = isFallbackNode || /\bfallback\s*\(/.test(headerText);
                    const isConstructor = /\bconstructor\s*\(/.test(headerText);
                    let usesMsgValue = false;
                    if (bodyNode) {
                        const bodyText = content.slice(bodyNode.startIndex, bodyNode.endIndex);
                        usesMsgValue = /\bmsg\s*\.\s*value\b/.test(bodyText);
                    }
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
                        const severity = vscode.DiagnosticSeverity.Error;
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
        catch { }
    }
    // Name-based heuristic suggestions (only when AST exists and rule enabled)
    if (tree && heuristic?.enabled) {
        try {
            const pattern = new RegExp(`^(?:${heuristic.pattern})$`, "i");
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
                                const nameIdx = headerText.indexOf(fname, nameMatch.index);
                                if (nameIdx >= 0) {
                                    const absStart = headerStart + nameIdx;
                                    const before = content.slice(0, absStart).split(/\r?\n/);
                                    const line = before.length - 1;
                                    const col = before[before.length - 1].length;
                                    pushFinding(line, col, col + fname.length, "Function name suggests it should accept Ether; consider adding 'payable'.", "MISSING_PAYABLE", vscode.DiagnosticSeverity.Warning);
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
        catch { }
    }
}
/**
 * Line-based fallback payable checks; call inside the per-line loop.
 */
function runPayableLineFallbackSingle(line, lineIndex, content, tree, enabled, pushFinding) {
    if (!enabled)
        return;
    const stripInline = (s) => s.split("//")[0];
    const noComment = stripInline(line);
    // receive() must be payable
    const isReceiveDecl = /\breceive\s*\(\s*\)/i.test(noComment);
    if (isReceiveDecl && !/\bpayable\b/i.test(noComment)) {
        const idx = noComment.search(/\breceive\b/i);
        if (idx >= 0) {
            pushFinding(lineIndex, idx, idx + "receive".length, "'receive' function must be marked payable to accept ETH.", "MISSING_PAYABLE", vscode.DiagnosticSeverity.Error);
        }
    }
    // Only run broader heuristic if we don't have AST (to reduce noise)
    if (!tree) {
        const functionPattern = /\bfunction\s+\w+\s*\([^)]*\)\s*(public|private|internal|external)?\s*(pure|view)?\s*(?!payable)/i;
        const hasValueTransfer = /\.transfer\(|\.send\(|\.call\{.*value/i;
        if (functionPattern.test(line) && hasValueTransfer.test(content)) {
            const match = line.match(functionPattern);
            if (match && match.index !== undefined) {
                const idx = match.index;
                pushFinding(lineIndex, idx, idx + match[0].length, "Function that handles ETH should have 'payable' modifier.", "MISSING_PAYABLE", vscode.DiagnosticSeverity.Warning);
            }
        }
    }
}
//# sourceMappingURL=payable.js.map