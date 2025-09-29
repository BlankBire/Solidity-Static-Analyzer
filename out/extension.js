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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const solidityAnalyzer_1 = require("./solidityAnalyzer");
// File entry point của VS Code extension.
// Vai trò:
// - Tạo và quản lý DiagnosticCollection (để hiện cảnh báo/lỗi trong Problems panel).
// - Lắng nghe sự kiện mở/sửa/lưu tài liệu Solidity và kích hoạt phân tích.
// - Đọc Settings của extension và truyền vào bộ phân tích cốt lõi.
let diagnosticCollection;
let analysisTimeout;
function activate(context) {
    // Đọc cấu hình của extension từ Settings (solidityStaticAnalyzer.*)
    const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
    const isEnabled = config.get("enable", true);
    // Tập hợp chẩn đoán để VS Code hiển thị gạch chân/cảnh báo
    diagnosticCollection = vscode.languages.createDiagnosticCollection("solidity-static-analyzer");
    context.subscriptions.push(diagnosticCollection);
    if (!isEnabled) {
        // Nếu người dùng tắt extension → không làm gì thêm
        return;
    }
    // Có thể dùng selector này nếu cần lọc tài liệu theo ngôn ngữ/scheme
    const supportedSelector = {
        language: "solidity",
        scheme: "file",
    };
    // Phân tích tài liệu hiện đang mở (nếu là Solidity)
    const analyzeActive = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        if (editor.document.languageId !== "solidity") {
            return;
        }
        runAnalysis(editor.document);
    };
    context.subscriptions.push(
    // Khi mở 1 tài liệu mới
    vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "solidity") {
            runAnalysis(doc);
        }
    }), 
    // Khi nội dung tài liệu thay đổi (gõ phím) - với debounce
    vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "solidity") {
            // Clear timeout cũ nếu có
            if (analysisTimeout) {
                clearTimeout(analysisTimeout);
            }
            // Chạy analysis sau 300ms để tránh quá nhiều lần chạy
            analysisTimeout = setTimeout(() => {
                runAnalysis(e.document);
            }, 300);
        }
    }), 
    // Khi lưu tài liệu
    vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId === "solidity") {
            runAnalysis(doc);
        }
    }), 
    // Khi đổi tab editor đang active
    vscode.window.onDidChangeActiveTextEditor(() => analyzeActive()), 
    // Khi người dùng đổi Settings của extension → phân tích lại
    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("solidityStaticAnalyzer")) {
            analyzeActive();
        }
    }));
    analyzeActive();
    // Lệnh thủ công để chạy lại phân tích (có thể bind phím tắt)
    const command = vscode.commands.registerCommand("solidityStaticAnalyzer.runAnalysis", () => analyzeActive());
    context.subscriptions.push(command);
}
function deactivate() {
    // Dọn dẹp khi extension bị unload
    if (analysisTimeout) {
        clearTimeout(analysisTimeout);
    }
    diagnosticCollection?.clear();
    diagnosticCollection?.dispose();
}
function runAnalysis(document) {
    // Đọc cấu hình để điều khiển số lượng lỗi và các rule bật/tắt
    const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
    const maxProblems = config.get("maxProblems", 100);
    const rules = {
        txOrigin: config.get("rules.txOrigin", true) ?? true,
        selfdestruct: config.get("rules.selfdestruct", true) ?? true,
        delegatecall: config.get("rules.delegatecall", true) ?? true,
        lowLevelCallValue: config.get("rules.lowLevelCallValue", true) ?? true,
        // Syntax rules
        missingSemicolon: config.get("rules.missingSemicolon", true) ?? true,
        missingParentheses: config.get("rules.missingParentheses", true) ?? true,
        missingBraces: config.get("rules.missingBraces", true) ?? true,
        missingReturn: config.get("rules.missingReturn", true) ?? true,
        wrongKeywords: config.get("rules.wrongKeywords", true) ?? true,
        missingDataType: config.get("rules.missingDataType", true) ?? true,
        missingPayable: config.get("rules.missingPayable", true) ?? true,
    };
    // Gọi bộ phân tích cốt lõi với nội dung tài liệu
    const text = document.getText();
    const findings = (0, solidityAnalyzer_1.analyzeText)(text, rules, maxProblems);
    // Chuyển các kết quả (findings) thành Diagnostic để VS Code hiển thị
    const diagnostics = findings.map((f) => {
        const range = new vscode.Range(new vscode.Position(f.range.start.line, f.range.start.character), new vscode.Position(f.range.end.line, f.range.end.character));
        const diag = new vscode.Diagnostic(range, f.message, f.severity);
        diag.source = "Solidity Static Analyzer";
        diag.code = f.code;
        return diag;
    });
    // Gắn diagnostics cho tài liệu hiện tại
    diagnosticCollection?.set(document.uri, diagnostics);
}
//# sourceMappingURL=extension.js.map