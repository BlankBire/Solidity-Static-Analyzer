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
exports.runSecurityRulesSingleLine = runSecurityRulesSingleLine;
const vscode = __importStar(require("vscode"));
/**
 * Apply security-related rules for a single source line.
 */
function runSecurityRulesSingleLine(line, lineLower, lineIndex, rules, pushFinding) {
    // 1. TX_ORIGIN
    if (rules.txOrigin) {
        const idx = lineLower.indexOf("tx.origin");
        if (idx !== -1) {
            pushFinding(lineIndex, idx, idx + "tx.origin".length, "Avoid using tx.origin for authorization. Use msg.sender instead.", "TX_ORIGIN", vscode.DiagnosticSeverity.Warning);
        }
    }
    // 2. SELFDESTRUCT / suicide
    if (rules.selfdestruct) {
        const m = line.match(/(selfdestruct|suicide)\s*\(/i);
        if (m && m.index !== undefined) {
            const idx = m.index;
            pushFinding(lineIndex, idx, idx + m[1].length, "selfdestruct can permanently remove contract code. Ensure this is intended and access controlled.", "SELFDESTRUCT", vscode.DiagnosticSeverity.Warning);
        }
    }
    // 3. DELEGATECALL
    if (rules.delegatecall) {
        const m = line.match(/\.delegatecall\s*\(/i);
        if (m && m.index !== undefined) {
            const idx = m.index + 1; // skip '.'
            pushFinding(lineIndex, idx, idx + "delegatecall".length, "delegatecall can lead to unexpected context changes. Validate target and data.", "DELEGATECALL", vscode.DiagnosticSeverity.Warning);
        }
    }
    // 4. LOW_LEVEL_CALL with value
    if (rules.lowLevelCallValue) {
        const m = line.match(/\.call\s*\{\s*value\s*:\s*/i) ||
            line.match(/\.call\.value\s*\(/i);
        if (m && m.index !== undefined) {
            const idx = m.index + 1; // skip '.'
            const token = m[0].toLowerCase().includes("call.value")
                ? "call.value"
                : "call{value:";
            pushFinding(lineIndex, idx, idx + token.length, "Low-level call with value can introduce reentrancy. Use Checks-Effects-Interactions and consider .transfer/.send limitations.", "LOW_LEVEL_CALL_VALUE", vscode.DiagnosticSeverity.Warning);
        }
    }
}
//# sourceMappingURL=security.js.map