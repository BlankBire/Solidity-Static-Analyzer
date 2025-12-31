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
exports.runCrossFileChecks = runCrossFileChecks;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
/**
 * Giải quyết các import được tham chiếu trong file và gộp các tên top-level (contract, library, interface)
 * vào `declaredIdentifiers` để các heuristic đơn lẻ khác không báo lỗi nhầm.
 * Đồng thời báo lỗi nếu đường dẫn file import không được tìm thấy.
 */
function runCrossFileChecks(content, filePath, declaredIdentifiers, declaredDeclarations, pushFinding) {
    if (!filePath)
        return;
    try {
        // match: import "./A.sol";  OR import * as X from "./A.sol"; OR import {A as B} from './A.sol';
        const importRx = /import\s+(?:[^;]*?from\s+)?(?:"|')([^"']+)(?:"|')\s*;/g;
        let m;
        const baseDir = path.dirname(filePath);
        while ((m = importRx.exec(content)) !== null) {
            const importPath = m[1];
            const importAbs = path.resolve(baseDir, importPath);
            if (!fs.existsSync(importAbs)) {
                // locate line/col for the import occurrence
                const before = content.slice(0, m.index);
                const line = before.split(/\r?\n/).length - 1;
                const col = m.index - before.lastIndexOf("\n") - 1;
                pushFinding(line, col, col + Math.min(importPath.length + 7, 80), `Không tìm thấy tệp nguồn '${importAbs}': Lỗi giải quyết import.`, "IMPORT_NOT_FOUND", vscode.DiagnosticSeverity.Error);
                continue;
            }
            // phân tích tệp đã nhập và thu thập các tên cấp cao nhất (library, contract, interface)
            try {
                const txt = fs.readFileSync(importAbs, "utf8");
                // quick heuristic parse: look for `library|contract|interface|enum|struct` followed by identifier
                const topRx = /\b(library|contract|interface|enum|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
                let t;
                while ((t = topRx.exec(txt)) !== null) {
                    const name = t[2];
                    if (name)
                        declaredIdentifiers.add(name);
                    // mark as imported to avoid unused-variable reports
                    declaredDeclarations.push({
                        name,
                        declNode: {
                            startIndex: t.index,
                            startPosition: { row: 0, column: 0 },
                        },
                        scopeNode: { type: String(t[1]) },
                        startIndex: t.index,
                        startPosition: { row: 0, column: 0 },
                        scopeType: t[1],
                        imported: true,
                    });
                }
            }
            catch (e) {
                // ignore parse errors for imported file
            }
        }
    }
    catch (e) {
        // fail-safe: do nothing
    }
}
//# sourceMappingURL=cross.js.map