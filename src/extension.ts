import * as vscode from "vscode";
import { analyzeText } from "./solidityAnalyzer";

// File entry point của VS Code extension.
// Vai trò:
// - Tạo và quản lý DiagnosticCollection (để hiện cảnh báo/lỗi trong Problems panel).
// - Lắng nghe sự kiện mở/sửa/lưu tài liệu Solidity và kích hoạt phân tích.
// - Đọc Settings của extension và truyền vào bộ phân tích cốt lõi.

let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let analysisTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Đọc cấu hình của extension từ Settings (solidityStaticAnalyzer.*)
  const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
  const isEnabled = config.get<boolean>("enable", true);

  // Tập hợp chẩn đoán để VS Code hiển thị gạch chân/cảnh báo
  diagnosticCollection = vscode.languages.createDiagnosticCollection(
    "solidity-static-analyzer"
  );
  context.subscriptions.push(diagnosticCollection);

  if (!isEnabled) {
    // Nếu người dùng tắt extension → không làm gì thêm
    return;
  }

  // Có thể dùng selector này nếu cần lọc tài liệu theo ngôn ngữ/scheme
  const supportedSelector: vscode.DocumentSelector = {
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
    })
  );

  analyzeActive();

  // Lệnh thủ công để chạy lại phân tích (có thể bind phím tắt)
  const command = vscode.commands.registerCommand(
    "solidityStaticAnalyzer.runAnalysis",
    () => analyzeActive()
  );
  context.subscriptions.push(command);
}

export function deactivate() {
  // Dọn dẹp khi extension bị unload
  if (analysisTimeout) {
    clearTimeout(analysisTimeout);
  }
  diagnosticCollection?.clear();
  diagnosticCollection?.dispose();
}

function runAnalysis(document: vscode.TextDocument) {
  // Đọc cấu hình để điều khiển số lượng lỗi và các rule bật/tắt
  const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
  const maxProblems = config.get<number>("maxProblems", 100);
  const rules = {
    txOrigin: config.get<boolean>("rules.txOrigin", true) ?? true,
    selfdestruct: config.get<boolean>("rules.selfdestruct", true) ?? true,
    delegatecall: config.get<boolean>("rules.delegatecall", true) ?? true,
    lowLevelCallValue:
      config.get<boolean>("rules.lowLevelCallValue", true) ?? true,
    // Syntax rules
    missingSemicolon: config.get<boolean>("rules.missingSemicolon", true) ?? true,
    missingParentheses: config.get<boolean>("rules.missingParentheses", true) ?? true,
    missingBraces: config.get<boolean>("rules.missingBraces", true) ?? true,
    missingReturn: config.get<boolean>("rules.missingReturn", true) ?? true,
    wrongKeywords: config.get<boolean>("rules.wrongKeywords", true) ?? true,
    missingDataType: config.get<boolean>("rules.missingDataType", true) ?? true,
    missingPayable: config.get<boolean>("rules.missingPayable", true) ?? true,
  };

  // Gọi bộ phân tích cốt lõi với nội dung tài liệu
  const text = document.getText();
  const findings = analyzeText(text, rules, maxProblems);
  // Chuyển các kết quả (findings) thành Diagnostic để VS Code hiển thị
  const diagnostics: vscode.Diagnostic[] = findings.map((f) => {
    const range = new vscode.Range(
      new vscode.Position(f.range.start.line, f.range.start.character),
      new vscode.Position(f.range.end.line, f.range.end.character)
    );
    const diag = new vscode.Diagnostic(range, f.message, f.severity);
    diag.source = "Solidity Static Analyzer";
    diag.code = f.code;
    return diag;
  });

  // Gắn diagnostics cho tài liệu hiện tại
  diagnosticCollection?.set(document.uri, diagnostics);
}
