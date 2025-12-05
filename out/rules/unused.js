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
exports.runUnusedVariables = runUnusedVariables;
const vscode = __importStar(require("vscode"));
/**
 * Report UNUSED_VARIABLE diagnostics using a scope-aware search within each declaration's scope.
 * Flags locals, parameters, return variables, and (optionally) state variables that are written but never read.
 */
function runUnusedVariables(content, tree, declaredDeclarations, pushFinding, opts) {
    if (!tree)
        return; // require AST for precise scope walking
    const isStateVariable = (decl) => {
        try {
            // Walk up from declNode to see if inside a state_variable_declaration; or scope is contract_definition
            let cur = decl.declNode?.parent;
            while (cur) {
                const t = String(cur.type);
                if (t === "state_variable_declaration")
                    return true;
                cur = cur.parent;
            }
        }
        catch { }
        // Fallback: scope at contract level implies state var
        return String(decl.scopeType || "").toLowerCase() === "contract_definition";
    };
    const lhsContainerTypes = new Set([
        "expression",
        "tuple_expression",
        "parenthesized_expression",
        "member_expression",
        "index_access_expression",
    ]);
    const getNodeText = (node) => {
        if (!node)
            return "";
        return content.slice(node.startIndex, node.endIndex);
    };
    const findStateVariableNode = (decl) => {
        let cur = decl.declNode?.parent;
        while (cur) {
            if (String(cur.type) === "state_variable_declaration") {
                return cur;
            }
            cur = cur.parent;
        }
        return undefined;
    };
    const hasPublicVisibility = (decl) => {
        const stateDecl = findStateVariableNode(decl);
        if (!stateDecl)
            return false;
        for (const child of stateDecl.namedChildren || []) {
            if (String(child.type) === "visibility") {
                const text = getNodeText(child).trim();
                if (/^public$/i.test(text)) {
                    return true;
                }
            }
        }
        const rawText = getNodeText(stateDecl);
        return /\bpublic\b/i.test(rawText);
    };
    const functionLikeNodeTypes = new Set([
        "function_definition",
        "function_declaration",
        "modifier_definition",
        "constructor_definition",
    ]);
    const getEnclosingFunctionLike = (node) => {
        let current = node?.parent;
        while (current) {
            if (functionLikeNodeTypes.has(String(current.type))) {
                return current;
            }
            current = current.parent;
        }
        return undefined;
    };
    const functionHasBody = (fnNode) => {
        if (!fnNode)
            return false;
        for (const child of fnNode.namedChildren || []) {
            const t = String(child.type);
            if (t === "function_body" || t === "block" || t === "block_statement") {
                return true;
            }
        }
        return false;
    };
    const isWithinSimpleAssignmentLhs = (node) => {
        let current = node;
        let parent = node?.parent;
        while (parent) {
            const parentType = String(parent.type);
            if (parentType === "assignment_expression") {
                const named = parent.namedChildren || [];
                const left = named[0];
                if (!left)
                    return false;
                if (current !== left)
                    return false;
                const right = named.length > 1 ? named[1] : undefined;
                const sliceStart = left.endIndex ?? parent.startIndex;
                const sliceEnd = right ? right.startIndex : parent.endIndex;
                const operatorText = content.slice(sliceStart, sliceEnd).trim();
                return operatorText === "=";
            }
            if (!lhsContainerTypes.has(parentType)) {
                break;
            }
            current = parent;
            parent = parent.parent;
        }
        return false;
    };
    const isReturnParameterNode = (node) => {
        let current = node?.parent;
        while (current) {
            const type = String(current.type);
            if (type === "return_parameter" ||
                type === "return_parameters" ||
                type === "return_parameter_list" ||
                type === "return_type_definition") {
                return true;
            }
            if (/function_definition|function_declaration|modifier_definition|constructor_definition/i.test(type)) {
                break;
            }
            current = current.parent;
        }
        return false;
    };
    const isFunctionLikeParameterNode = (node) => {
        let current = node?.parent;
        let seenParameterList = false;
        while (current) {
            const type = String(current.type);
            if (type === "parameter" || type === "parameter_list") {
                seenParameterList = true;
            }
            if (/function_definition|function_declaration|modifier_definition|constructor_definition/i.test(type)) {
                return seenParameterList;
            }
            if (type === "try_statement") {
                break;
            }
            current = current.parent;
        }
        return false;
    };
    const classifyDecl = (decl) => {
        if (isStateVariable(decl))
            return "state";
        if (isReturnParameterNode(decl.declNode))
            return "return";
        if (isFunctionLikeParameterNode(decl.declNode))
            return "parameter";
        return "local";
    };
    const buildMessage = (kind, name) => {
        switch (kind) {
            case "state":
                return `State variable '${name}' is never read.`;
            case "parameter":
                return `Function parameter '${name}' is never used.`;
            case "return":
                return `Named return variable '${name}' is never used.`;
            default:
                return `Local variable '${name}' is never read.`;
        }
    };
    const findUsageInScope = (scopeNode, name, declStartIdx) => {
        let found = false;
        const walk = (n) => {
            if (!n || found)
                return;
            if (String(n.type) === "identifier") {
                try {
                    const nm = content.slice(n.startIndex, n.endIndex);
                    if (nm === name && n.startIndex !== declStartIdx) {
                        if (!isWithinSimpleAssignmentLhs(n)) {
                            found = true;
                            return;
                        }
                    }
                }
                catch { }
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
        const name = decl.name;
        if (decl.imported)
            continue; // skip injected imported symbols
        if (!name || name.startsWith("_"))
            continue; // ignore intentionally unused
        if (!opts?.includeStateVariables && isStateVariable(decl))
            continue; // optionally ignore state variables
        const declKind = classifyDecl(decl);
        if (declKind === "state" && hasPublicVisibility(decl)) {
            continue; // public state variables have implicit getters and should not be flagged
        }
        if (declKind === "return") {
            continue; // named return variables are considered part of the function interface
        }
        if (declKind === "parameter" &&
            !functionHasBody(getEnclosingFunctionLike(decl.declNode))) {
            continue; // parameters/returns on declarations without bodies (interfaces/abstract) are not unused
        }
        const used = findUsageInScope(decl.scopeNode, name, decl.declNode.startIndex);
        if (!used) {
            // Report at declaration position
            let lineNum = 0;
            let colNum = 0;
            if (decl.startPosition && typeof decl.startPosition.row === "number") {
                lineNum = decl.startPosition.row;
                colNum = decl.startPosition.column;
            }
            else {
                const before = content.slice(0, decl.startIndex).split(/\r?\n/);
                lineNum = before.length - 1;
                colNum = before[before.length - 1].length;
            }
            pushFinding(lineNum, colNum, colNum + name.length, buildMessage(declKind, name), "UNUSED_VARIABLE", vscode.DiagnosticSeverity.Warning);
        }
    }
}
//# sourceMappingURL=unused.js.map