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
exports.runPragmaRules = runPragmaRules;
const vscode = __importStar(require("vscode"));
/**
 * Run pragma-related rules: SPDX license header and pragma solidity version.
 * This operates on the original content (comments preserved).
 */
function runPragmaRules(content, rules, pushFinding) {
    // SPDX license: check first ~10 lines for comment markers containing SPDX-License-Identifier
    if (rules.missingLicense) {
        const originalLines = content.split(/\r?\n/);
        let hasLicense = false;
        for (let i = 0; i < Math.min(10, originalLines.length); i++) {
            const line = originalLines[i].trim();
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
    // pragma solidity version: scan first ~20 non-comment lines for `pragma solidity`
    if (rules.missingVersion) {
        const originalLines = content.split(/\r?\n/);
        let hasVersion = false;
        for (let i = 0; i < Math.min(20, originalLines.length); i++) {
            const line = originalLines[i];
            const noCommentLine = line.split("//")[0].trim();
            if (/^pragma\s+solidity\s+/.test(noCommentLine)) {
                hasVersion = true;
                break;
            }
        }
        if (!hasVersion) {
            pushFinding(0, 0, 1, "Missing pragma solidity version. Add a version declaration at the top of the file (e.g., pragma solidity ^0.8.0;).", "MISSING_VERSION", vscode.DiagnosticSeverity.Warning);
        }
    }
}
//# sourceMappingURL=pragma.js.map