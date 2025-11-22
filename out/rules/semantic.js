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
exports.runSemanticRulesAst = runSemanticRulesAst;
const vscode = __importStar(require("vscode"));
const uintWidth = (typeName) => {
    const match = /^u?int(\d+)?$/i.exec(typeName.trim());
    if (!match)
        return undefined;
    if (!match[1])
        return 256; // plain uint/int defaults to 256 bits
    return parseInt(match[1], 10);
};
const getDescendant = (node, predicate) => {
    if (!node)
        return undefined;
    const queue = [...(node.namedChildren || [])];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current)
            continue;
        if (predicate(current))
            return current;
        if (current.namedChildren && current.namedChildren.length) {
            queue.push(...current.namedChildren);
        }
    }
    return undefined;
};
const getNodeText = (content, node) => {
    if (!node)
        return "";
    return content.slice(node.startIndex, node.endIndex);
};
const unwrapExpression = (node) => {
    let current = node;
    while (current &&
        current.type === "expression" &&
        current.namedChildren &&
        current.namedChildren.length === 1) {
        current = current.namedChildren[0];
    }
    return current;
};
function runSemanticRulesAst(content, tree, toggles, pushFinding) {
    if (!tree?.rootNode)
        return;
    const extractVersion = () => {
        const pragmaRegex = /pragma\s+solidity\s+([^;]+)/gi;
        let match;
        let best;
        while ((match = pragmaRegex.exec(content)) !== null) {
            const segment = match[1] || "";
            const versionMatch = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(segment);
            if (!versionMatch)
                continue;
            const major = parseInt(versionMatch[1], 10);
            const minor = parseInt(versionMatch[2], 10);
            const patch = versionMatch[3] ? parseInt(versionMatch[3], 10) : 0;
            if (!best) {
                best = { major, minor, patch };
                continue;
            }
            if (major > best.major) {
                best = { major, minor, patch };
                continue;
            }
            if (major === best.major && minor > best.minor) {
                best = { major, minor, patch };
                continue;
            }
            if (major === best.major && minor === best.minor && patch > best.patch) {
                best = { major, minor, patch };
            }
        }
        return best;
    };
    const versionInfo = extractVersion();
    const versionAtLeast = (v, major, minor) => {
        if (!v)
            return false;
        if (v.major > major)
            return true;
        if (v.major < major)
            return false;
        if (v.minor > minor)
            return true;
        if (v.minor < minor)
            return false;
        return v.patch >= 0;
    };
    const collectContracts = () => {
        const result = [];
        const walk = (node) => {
            if (!node)
                return;
            const type = String(node.type);
            if (type === "contract_declaration" || type === "contract_definition") {
                result.push(node);
            }
            for (const child of node.namedChildren || []) {
                walk(child);
            }
        };
        walk(tree.rootNode);
        return result;
    };
    if (toggles.legacyConstructor) {
        const contracts = collectContracts();
        const enforceLegacy = versionAtLeast(versionInfo, 0, 5) ||
            (!!versionInfo && versionInfo.major >= 1);
        const shouldWarn = enforceLegacy || !versionInfo;
        const severity = enforceLegacy
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;
        if (shouldWarn) {
            for (const contractNode of contracts) {
                const contractNameNode = (contractNode.namedChildren || []).find((child) => child.type === "identifier");
                if (!contractNameNode)
                    continue;
                const contractName = getNodeText(content, contractNameNode).trim();
                if (!contractName)
                    continue;
                const bodyNode = (contractNode.namedChildren || []).find((child) => child.type === "contract_body");
                const members = bodyNode?.namedChildren || [];
                for (const member of members) {
                    if (member.type !== "function_definition")
                        continue;
                    const fnNameNode = (member.namedChildren || []).find((child) => child.type === "identifier");
                    if (!fnNameNode)
                        continue;
                    const fnName = getNodeText(content, fnNameNode).trim();
                    if (!fnName)
                        continue;
                    if (fnName === contractName) {
                        const startPos = fnNameNode.startPosition || member.startPosition;
                        pushFinding(startPos.row, startPos.column, fnNameNode.endPosition?.column ?? startPos.column + fnName.length, "Replace legacy constructor syntax with the 'constructor' keyword in Solidity 0.5+.", "LEGACY_CONSTRUCTOR", severity);
                    }
                }
            }
        }
    }
    const visit = (node) => {
        if (!node)
            return;
        if (toggles.missingVisibility && node.type === "function_definition") {
            const hasVisibility = (node.namedChildren || []).some((child) => {
                const t = String(child.type);
                return t === "visibility" || t === "visibility_specifier";
            });
            if (!hasVisibility) {
                const nameNode = (node.namedChildren || []).find((child) => child.type === "identifier");
                const startPos = nameNode?.startPosition || node.startPosition;
                const endPos = nameNode?.endPosition || {
                    row: startPos.row,
                    column: startPos.column + "function".length,
                };
                pushFinding(startPos.row, startPos.column, endPos.column, "No visibility specified. Did you intend to add 'public'?", "MISSING_VISIBILITY", vscode.DiagnosticSeverity.Error);
            }
        }
        if (toggles.unsafeAddressCast && node.type === "type_cast_expression") {
            const primitive = (node.namedChildren || []).find((child) => child.type === "primitive_type");
            if (primitive) {
                const typeText = content.slice(primitive.startIndex, primitive.endIndex);
                const width = uintWidth(typeText);
                if (width !== undefined && width < 160) {
                    const callArg = (node.namedChildren || []).find((child) => child.type === "call_argument");
                    if (callArg) {
                        const member = getDescendant(callArg, (child) => child.type === "member_expression");
                        if (member) {
                            const objectNode = member.namedChildren?.[0];
                            const propertyNode = member.namedChildren?.[1];
                            if (objectNode && propertyNode) {
                                const objectText = content
                                    .slice(objectNode.startIndex, objectNode.endIndex)
                                    .trim();
                                const propertyText = content
                                    .slice(propertyNode.startIndex, propertyNode.endIndex)
                                    .trim();
                                if (objectNode.type === "identifier" &&
                                    objectText === "msg" &&
                                    propertyText === "sender") {
                                    const startPos = primitive.startPosition;
                                    pushFinding(startPos.row, startPos.column, primitive.endPosition.column, `Explicit type conversion from 'address' to '${typeText.trim()}' is disallowed.`, "UNSAFE_ADDRESS_CAST", vscode.DiagnosticSeverity.Error);
                                }
                            }
                        }
                    }
                }
            }
        }
        if (toggles.deprecatedThisBalance && node.type === "member_expression") {
            const objectNode = node.namedChildren?.[0];
            const propertyNode = node.namedChildren?.[1];
            if (objectNode && propertyNode) {
                const objectText = content
                    .slice(objectNode.startIndex, objectNode.endIndex)
                    .trim();
                const propertyText = content
                    .slice(propertyNode.startIndex, propertyNode.endIndex)
                    .trim();
                if (objectNode.type === "identifier" &&
                    objectText === "this" &&
                    propertyText === "balance") {
                    const startPos = objectNode.startPosition || node.startPosition;
                    const endPos = propertyNode.endPosition || node.endPosition;
                    pushFinding(startPos.row, startPos.column, endPos.column, "'this.balance' is deprecated. Use address(this).balance instead.", "DEPRECATED_THIS_BALANCE", vscode.DiagnosticSeverity.Error);
                }
            }
        }
        if (toggles.msgSenderTransfer && node.type === "call_expression") {
            const calleeRaw = (node.namedChildren || [])[0];
            const callee = unwrapExpression(calleeRaw);
            if (!callee || callee.type !== "member_expression") {
                for (const child of node.namedChildren || [])
                    visit(child);
                return;
            }
            const memberObject = unwrapExpression(callee.namedChildren?.[0]);
            const memberProperty = unwrapExpression(callee.namedChildren?.[1]);
            if (!memberObject || !memberProperty) {
                for (const child of node.namedChildren || [])
                    visit(child);
                return;
            }
            const methodName = getNodeText(content, memberProperty).trim();
            if (!/^(transfer|send)$/i.test(methodName)) {
                for (const child of node.namedChildren || [])
                    visit(child);
                return;
            }
            if (memberObject.type === "member_expression") {
                const baseObject = unwrapExpression(memberObject.namedChildren?.[0]);
                const baseProperty = unwrapExpression(memberObject.namedChildren?.[1]);
                if (baseObject &&
                    baseProperty &&
                    baseObject.type === "identifier" &&
                    getNodeText(content, baseObject).trim() === "msg" &&
                    getNodeText(content, baseProperty).trim() === "sender") {
                    const startPos = baseObject.startPosition || node.startPosition;
                    const endPos = memberProperty.endPosition || node.endPosition;
                    pushFinding(startPos.row, startPos.column, endPos.column, "Cast msg.sender to payable(msg.sender) before calling transfer/send.", "MSG_SENDER_TRANSFER", vscode.DiagnosticSeverity.Error);
                }
            }
        }
        for (const child of node.namedChildren || []) {
            visit(child);
        }
    };
    visit(tree.rootNode);
}
//# sourceMappingURL=semantic.js.map