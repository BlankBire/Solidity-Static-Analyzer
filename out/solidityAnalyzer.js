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
// Hàm chính: nhận nội dung, cấu hình rule và trả về danh sách phát hiện (findings)
function analyzeText(content, rules, maxProblems) {
    const findings = [];
    const lines = content.split(/\r?\n/);
    // Helper thêm một phát hiện với vị trí theo dòng/ký tự
    const pushFinding = (lineIndex, start, end, message, code, severity) => {
        if (findings.length >= maxProblems) {
            return;
        }
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
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineLower = line.toLowerCase();
        // 1) Cảnh báo dùng tx.origin cho kiểm tra quyền
        if (rules.txOrigin) {
            const idx = lineLower.indexOf("tx.origin");
            if (idx !== -1) {
                pushFinding(i, idx, idx + "tx.origin".length, "Avoid using tx.origin for authorization. Use msg.sender instead.", "TX_ORIGIN", vscode.DiagnosticSeverity.Warning);
            }
        }
        // 2) Cảnh báo gọi selfdestruct/suicide
        if (rules.selfdestruct) {
            const kw = /(selfdestruct|suicide)\s*\(/i;
            const match = line.match(kw);
            if (match && match.index !== undefined) {
                const idx = match.index;
                pushFinding(i, idx, idx + match[1].length, "selfdestruct can permanently remove contract code. Ensure this is intended and access controlled.", "SELFDESTRUCT", vscode.DiagnosticSeverity.Warning);
            }
        }
        // 3) Cảnh báo dùng delegatecall
        if (rules.delegatecall) {
            const kw = /\.delegatecall\s*\(/i;
            const match = line.match(kw);
            if (match && match.index !== undefined) {
                const idx = match.index + 1; // skip the dot
                pushFinding(i, idx, idx + "delegatecall".length, "delegatecall can lead to unexpected context changes. Validate target and data.", "DELEGATECALL", vscode.DiagnosticSeverity.Warning);
            }
        }
        // 4) Nhắc nhở low-level call kèm value (tiềm ẩn reentrancy)
        if (rules.lowLevelCallValue) {
            const kw1 = /\.call\s*\{\s*value\s*:\s*/i;
            const kw2 = /\.call\.value\s*\(/i; // old style (pre-0.6)
            const match = line.match(kw1) || line.match(kw2);
            if (match && match.index !== undefined) {
                const idx = match.index + 1; // skip the dot
                pushFinding(i, idx, idx +
                    (match[0].toLowerCase().includes("call.value")
                        ? "call.value".length
                        : "call{value:".length), "Low-level call with value can introduce reentrancy. Use Checks-Effects-Interactions and consider .transfer/.send limitations.", "LOW_LEVEL_CALL_VALUE", vscode.DiagnosticSeverity.Information);
            }
        }
    }
    return findings;
}
//# sourceMappingURL=solidityAnalyzer.js.map