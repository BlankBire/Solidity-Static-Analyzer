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
function runSemanticRulesAst(content, tree, toggles, pushFinding) {
    if (!tree?.rootNode)
        return;
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
        for (const child of node.namedChildren || []) {
            visit(child);
        }
    };
    visit(tree.rootNode);
}
//# sourceMappingURL=semantic.js.map