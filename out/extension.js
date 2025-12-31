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
/**
 * Điểm vào (Entry point) của VS Code extension.
 *
 * Vai trò chính:
 * - Khởi tạo và quản lý DiagnosticCollection (hiển thị lỗi/cảnh báo trong Problems panel).
 * - Theo dõi các sự kiện mở, sửa và lưu file Solidity để kích hoạt bộ phân tích.
 * - Đọc cấu hình (Settings) của extension và chuyển giao cho bộ phân tích lõi.
 */
let diagnosticCollection;
let analysisTimeout;
/**
 * Hàm kích hoạt extension.
 * @param context Ngữ cảnh của extension từ VS Code.
 */
function activate(context) {
    // Lấy cấu hình của extension từ Settings (solidityStaticAnalyzer.*)
    const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
    const isEnabled = config.get("enable", true);
    // Tạo DiagnosticCollection để VS Code hiển thị các gạch chân cảnh báo
    diagnosticCollection = vscode.languages.createDiagnosticCollection("solidity-static-analyzer");
    context.subscriptions.push(diagnosticCollection);
    if (!isEnabled) {
        // Nếu extension bị tắt trong cài đặt thì dừng tại đây
        return;
    }
    // Bộ chọn tài liệu: Chỉ áp dụng cho các tệp ngôn ngữ 'solidity' từ hệ thống tệp
    const supportedSelector = {
        language: "solidity",
        scheme: "file",
    };
    /**
     * Thực hiện phân tích trên trình soạn thảo đang hoạt động.
     */
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
    // Đăng ký các sự kiện lắng nghe
    context.subscriptions.push(
    // Khi một tài liệu được mở
    vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "solidity") {
            runAnalysis(doc);
        }
    }), 
    // Khi nội dung tài liệu thay đổi (kèm cơ chế debounce để tối ưu hiệu năng)
    vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "solidity") {
            // Hủy bỏ lần chờ phân tích trước đó nếu người dùng vẫn đang gõ
            if (analysisTimeout) {
                clearTimeout(analysisTimeout);
            }
            // Chờ 300ms sau khi ngừng gõ mới thực hiện phân tích
            analysisTimeout = setTimeout(() => {
                runAnalysis(e.document);
            }, 300);
        }
    }), 
    // Khi tài liệu được lưu lại
    vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId === "solidity") {
            runAnalysis(doc);
        }
    }), 
    // Khi người dùng chuyển đổi tab trình soạn thảo
    vscode.window.onDidChangeActiveTextEditor(() => analyzeActive()), 
    // Khi người dùng thay đổi cấu hình trong Settings
    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("solidityStaticAnalyzer")) {
            analyzeActive();
        }
    }));
    // Chạy phân tích lần đầu khi extension khởi động
    analyzeActive();
    // Đăng ký lệnh thủ công để chạy lại phân tích
    const command = vscode.commands.registerCommand("solidityStaticAnalyzer.runAnalysis", () => analyzeActive());
    context.subscriptions.push(command);
}
/**
 * Giải phóng tài nguyên khi extension bị vô hiệu hóa.
 */
function deactivate() {
    if (analysisTimeout) {
        clearTimeout(analysisTimeout);
    }
    diagnosticCollection?.clear();
    diagnosticCollection?.dispose();
}
/**
 * Hàm điều phối việc phân tích và hiển thị kết quả.
 * @param document Tài liệu cần phân tích.
 */
function runAnalysis(document) {
    // Đọc các thiết lập từ cấu hình người dùng
    const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
    const maxProblems = config.get("maxProblems", 100);
    // Tổng hợp trạng thái bật/tắt của các quy tắc kiểm tra
    const rules = {
        // Quy tắc bảo mật
        txOrigin: config.get("rules.txOrigin", true),
        selfdestruct: config.get("rules.selfdestruct", true),
        delegatecall: config.get("rules.delegatecall", true),
        lowLevelCallValue: config.get("rules.lowLevelCallValue", true),
        // Quy tắc cú pháp
        missingSemicolon: config.get("rules.missingSemicolon", true),
        missingParentheses: config.get("rules.missingParentheses", true),
        missingBraces: config.get("rules.missingBraces", true),
        missingReturn: config.get("rules.missingReturn", true),
        wrongKeywords: config.get("rules.wrongKeywords", true),
        missingDataType: config.get("rules.missingDataType", true),
        legacyFallbackFunction: config.get("rules.legacyFallbackFunction", true),
        missingPayable: config.get("rules.missingPayable", true),
        // Quy tắc đặt tên
        functionNaming: config.get("rules.functionNaming", true),
        variableNaming: config.get("rules.variableNaming", true),
        contractNaming: config.get("rules.contractNaming", true),
        // Quy tắc ngữ nghĩa
        missingVisibility: config.get("rules.missingVisibility", true),
        unsafeAddressCast: config.get("rules.unsafeAddressCast", true),
        deprecatedThisBalance: config.get("rules.deprecatedThisBalance", true),
        legacyConstructor: config.get("rules.legacyConstructor", true),
        msgSenderTransfer: config.get("rules.msgSenderTransfer", true),
        lowLevelCallNoData: config.get("rules.lowLevelCallNoData", true),
        uncheckedLowLevelCall: config.get("rules.uncheckedLowLevelCall", true),
        tryReturnShadowing: config.get("rules.tryReturnShadowing", true),
        unusedTryReturnVariable: config.get("rules.unusedTryReturnVariable", true),
        // Quy tắc Pragma và License
        missingLicense: config.get("rules.missingLicense", true),
        missingVersion: config.get("rules.missingVersion", true),
    };
    // Lấy nội dung văn bản của tài liệu
    const text = document.getText();
    // Cấu hình các mẫu regex cho việc đặt tên (Naming)
    const naming = {
        functionPattern: config.get("naming.functionPattern", "^[A-Za-z_][A-Za-z0-9_]*$"),
        variablePattern: config.get("naming.variablePattern", "^[A-Za-z_][A-Za-z0-9_]*$"),
        constantPattern: config.get("naming.constantPattern", "^[A-Za-z_][A-Za-z0-9_]*$"),
        contractPattern: config.get("naming.contractPattern", "^[A-Za-z_][A-Za-z0-9_]*$"),
    };
    // Các tùy chọn nâng cao cho bộ phân tích
    const useAST = config.get("useASTAnalyzer", true);
    const payableNameHeuristic = config.get("payableNameHeuristic", true);
    const payableNamePattern = config.get("payableNamePattern", "deposit|buy|mint|stake|fund|contribute|donate|tip|payIn|addLiquidity");
    // Gọi hàm phân tích cốt lõi
    const findings = (0, solidityAnalyzer_1.analyzeText)(text, rules, maxProblems, naming, useAST, {
        enabled: payableNameHeuristic,
        pattern: payableNamePattern,
    }, document.uri.fsPath);
    // Chuyển đổi các phát hiện (findings) thành Diagnostics để VS Code hiển thị
    const diagnostics = findings.map((f) => {
        const range = new vscode.Range(new vscode.Position(f.range.start.line, f.range.start.character), new vscode.Position(f.range.end.line, f.range.end.character));
        const diag = new vscode.Diagnostic(range, f.message, f.severity);
        // Nguồn của lỗi hiển thị trong Problems panel
        diag.source = "SOLIDIFY\u00A0"; // Sử dụng dấu cách không ngắt để tạo khoảng cách thẩm mỹ
        diag.code = f.code;
        return diag;
    });
    // Cập nhật kết quả lên DiagnosticCollection của VS Code
    diagnosticCollection?.set(document.uri, diagnostics);
}
//# sourceMappingURL=extension.js.map