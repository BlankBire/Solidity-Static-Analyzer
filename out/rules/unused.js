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
 * Skips state variables (declared at contract scope) and identifiers starting with '_'.
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
        if (!name || name.startsWith("_"))
            continue; // ignore intentionally unused
        if (!opts?.includeStateVariables && isStateVariable(decl))
            continue; // optionally ignore state variables
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
            pushFinding(lineNum, colNum, colNum + name.length, `Declared variable '${name}' is never used.`, "UNUSED_VARIABLE", vscode.DiagnosticSeverity.Warning);
        }
    }
}
//# sourceMappingURL=unused.js.map