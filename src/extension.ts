import * as vscode from "vscode";
import { analyzeText } from "./solidityAnalyzer";

/**
 * Điểm vào (Entry point) của VS Code extension.
 * 
 * Vai trò chính:
 * - Khởi tạo và quản lý DiagnosticCollection (hiển thị lỗi/cảnh báo trong Problems panel).
 * - Theo dõi các sự kiện mở, sửa và lưu file Solidity để kích hoạt bộ phân tích.
 * - Đọc cấu hình (Settings) của extension và chuyển giao cho bộ phân tích lõi.
 */

let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let analysisTimeout: NodeJS.Timeout | undefined;

/**
 * Hàm kích hoạt extension.
 * @param context Ngữ cảnh của extension từ VS Code.
 */
export function activate(context: vscode.ExtensionContext) {
  // Lấy cấu hình của extension từ Settings (solidityStaticAnalyzer.*)
  const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
  const isEnabled = config.get<boolean>("enable", true);

  // Tạo DiagnosticCollection để VS Code hiển thị các gạch chân cảnh báo
  diagnosticCollection = vscode.languages.createDiagnosticCollection(
    "solidity-static-analyzer"
  );
  context.subscriptions.push(diagnosticCollection);

  if (!isEnabled) {
    // Nếu extension bị tắt trong cài đặt thì dừng tại đây
    return;
  }

  // Bộ chọn tài liệu: Chỉ áp dụng cho các tệp ngôn ngữ 'solidity' từ hệ thống tệp
  const supportedSelector: vscode.DocumentSelector = {
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
    })
  );

  // Chạy phân tích lần đầu khi extension khởi động
  analyzeActive();

  // Đăng ký lệnh thủ công để chạy lại phân tích
  const command = vscode.commands.registerCommand(
    "solidityStaticAnalyzer.runAnalysis",
    () => analyzeActive()
  );
  context.subscriptions.push(command);
}

/**
 * Giải phóng tài nguyên khi extension bị vô hiệu hóa.
 */
export function deactivate() {
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
function runAnalysis(document: vscode.TextDocument) {
  // Đọc các thiết lập từ cấu hình người dùng
  const config = vscode.workspace.getConfiguration("solidityStaticAnalyzer");
  const maxProblems = config.get<number>("maxProblems", 100);
  
  // Tổng hợp trạng thái bật/tắt của các quy tắc kiểm tra
  const rules = {
    // Quy tắc bảo mật
    txOrigin: config.get<boolean>("rules.txOrigin", true),
    selfdestruct: config.get<boolean>("rules.selfdestruct", true),
    delegatecall: config.get<boolean>("rules.delegatecall", true),
    lowLevelCallValue: config.get<boolean>("rules.lowLevelCallValue", true),
    
    // Quy tắc cú pháp
    missingSemicolon: config.get<boolean>("rules.missingSemicolon", true),
    missingParentheses: config.get<boolean>("rules.missingParentheses", true),
    missingBraces: config.get<boolean>("rules.missingBraces", true),
    missingReturn: config.get<boolean>("rules.missingReturn", true),
    wrongKeywords: config.get<boolean>("rules.wrongKeywords", true),
    missingDataType: config.get<boolean>("rules.missingDataType", true),
    legacyFallbackFunction: config.get<boolean>(
      "rules.legacyFallbackFunction",
      true
    ),
    missingPayable: config.get<boolean>("rules.missingPayable", true),
    
    // Quy tắc đặt tên
    functionNaming: config.get<boolean>("rules.functionNaming", true),
    variableNaming: config.get<boolean>("rules.variableNaming", true),
    contractNaming: config.get<boolean>("rules.contractNaming", true),
    
    // Quy tắc ngữ nghĩa
    missingVisibility: config.get<boolean>("rules.missingVisibility", true),
    unsafeAddressCast: config.get<boolean>("rules.unsafeAddressCast", true),
    deprecatedThisBalance: config.get<boolean>(
      "rules.deprecatedThisBalance",
      true
    ),
    legacyConstructor: config.get<boolean>("rules.legacyConstructor", true),
    msgSenderTransfer: config.get<boolean>("rules.msgSenderTransfer", true),
    lowLevelCallNoData: config.get<boolean>("rules.lowLevelCallNoData", true),
    uncheckedLowLevelCall: config.get<boolean>(
      "rules.uncheckedLowLevelCall",
      true
    ),
    tryReturnShadowing: config.get<boolean>("rules.tryReturnShadowing", true),
    unusedTryReturnVariable: config.get<boolean>(
      "rules.unusedTryReturnVariable",
      true
    ),
    
    // Quy tắc Pragma và License
    missingLicense: config.get<boolean>("rules.missingLicense", true),
    missingVersion: config.get<boolean>("rules.missingVersion", true),
  };

  // Lấy nội dung văn bản của tài liệu
  const text = document.getText();
  
  // Cấu hình các mẫu regex cho việc đặt tên (Naming)
  const naming = {
    functionPattern: config.get<string>(
      "naming.functionPattern",
      "^[A-Za-z_][A-Za-z0-9_]*$"
    )!,
    variablePattern: config.get<string>(
      "naming.variablePattern",
      "^[A-Za-z_][A-Za-z0-9_]*$"
    )!,
    constantPattern: config.get<string>(
      "naming.constantPattern",
      "^[A-Za-z_][A-Za-z0-9_]*$"
    )!,
    contractPattern: config.get<string>(
      "naming.contractPattern",
      "^[A-Za-z_][A-Za-z0-9_]*$"
    )!,
  };

  // Các tùy chọn nâng cao cho bộ phân tích
  const useAST = config.get<boolean>("useASTAnalyzer", true);
  const payableNameHeuristic = config.get<boolean>(
    "payableNameHeuristic",
    true
  );
  const payableNamePattern = config.get<string>(
    "payableNamePattern",
    "deposit|buy|mint|stake|fund|contribute|donate|tip|payIn|addLiquidity"
  )!;

  // Gọi hàm phân tích cốt lõi
  const findings = analyzeText(
    text,
    rules,
    maxProblems,
    naming,
    useAST,
    {
      enabled: payableNameHeuristic,
      pattern: payableNamePattern,
    },
    document.uri.fsPath
  );

  // Chuyển đổi các phát hiện (findings) thành Diagnostics để VS Code hiển thị
  const diagnostics: vscode.Diagnostic[] = findings.map((f) => {
    const range = new vscode.Range(
      new vscode.Position(f.range.start.line, f.range.start.character),
      new vscode.Position(f.range.end.line, f.range.end.character)
    );
    const diag = new vscode.Diagnostic(range, f.message, f.severity);
    
    // Nguồn của lỗi hiển thị trong Problems panel
    diag.source = "SOLIDIFY\u00A0"; // Sử dụng dấu cách không ngắt để tạo khoảng cách thẩm mỹ
    diag.code = f.code;
    return diag;
  });

  // Cập nhật kết quả lên DiagnosticCollection của VS Code
  diagnosticCollection?.set(document.uri, diagnostics);
}
