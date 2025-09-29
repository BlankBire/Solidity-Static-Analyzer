import * as vscode from "vscode";

/**
 * Solidity Static Analyzer
 * 
 * Bộ phân tích mã tĩnh cho Solidity smart contracts.
 * Phát hiện các vấn đề bảo mật và lỗi cú pháp phổ biến.
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type AnalyzerRules = {
  // Security Rules - Cảnh báo các vấn đề bảo mật
  txOrigin: boolean;
  selfdestruct: boolean;
  delegatecall: boolean;
  lowLevelCallValue: boolean;

  // Syntax Rules - Phát hiện lỗi cú pháp cơ bản
  missingSemicolon: boolean;
  missingParentheses: boolean;
  missingBraces: boolean;
  missingReturn: boolean;
  wrongKeywords: boolean;
  missingDataType: boolean;
  missingPayable: boolean;
};

export type Finding = {
  message: string;
  code: string;
  severity: vscode.DiagnosticSeverity;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

// =============================================================================
// MAIN ANALYZER FUNCTION
// =============================================================================

/**
 * Hàm chính phân tích mã Solidity
 * @param content Nội dung file Solidity
 * @param rules Cấu hình các rules cần kiểm tra
 * @param maxProblems Giới hạn số lượng lỗi tối đa
 * @returns Danh sách các findings (lỗi/cảnh báo)
 */
export function analyzeText(
  content: string,
  rules: AnalyzerRules,
  maxProblems: number
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  // Helper function để thêm finding vào danh sách
  const pushFinding = (
    lineIndex: number,
    start: number,
    end: number,
    message: string,
    code: string,
    severity: vscode.DiagnosticSeverity
  ) => {
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

  // =============================================================================
  // SYNTAX ANALYSIS - BRACES MATCHING (Stack-based approach)
  // =============================================================================

  if (rules.missingBraces) {
    const stack: { line: number; col: number }[] = [];
    let extraClosingReported = false;

    // Duyệt qua từng ký tự để kiểm tra matching braces
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === "{") {
          stack.push({ line: i, col: j });
        } else if (char === "}") {
          if (stack.length === 0) {
            // Extra closing brace - chỉ báo lỗi 1 lần
            if (!extraClosingReported) {
              pushFinding(
                i,
                j,
                j + 1,
                "Extra closing brace.",
                "MISSING_BRACES",
                vscode.DiagnosticSeverity.Error
              );
              extraClosingReported = true;
            }
          } else {
            stack.pop();
          }
        }
      }
    }

    // Nếu còn dấu { chưa được đóng → báo lỗi cho dấu { cuối cùng
    if (stack.length > 0) {
      const lastBrace = stack[stack.length - 1];
      pushFinding(
        lastBrace.line,
        lastBrace.col,
        lastBrace.col + 1,
        "Missing closing brace.",
        "MISSING_BRACES",
        vscode.DiagnosticSeverity.Error
      );
    }
  }

  // =============================================================================
  // LINE-BY-LINE ANALYSIS
  // =============================================================================

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    // =============================================================================
    // SECURITY RULES - Cảnh báo các vấn đề bảo mật
    // =============================================================================

    // 1. TX_ORIGIN - Cảnh báo sử dụng tx.origin cho authorization
    if (rules.txOrigin) {
      const idx = lineLower.indexOf("tx.origin");
      if (idx !== -1) {
        pushFinding(
          i,
          idx,
          idx + "tx.origin".length,
          "Avoid using tx.origin for authorization. Use msg.sender instead.",
          "TX_ORIGIN",
          vscode.DiagnosticSeverity.Warning
        );
      }
    }

    // 2. SELFDESTRUCT - Cảnh báo sử dụng selfdestruct/suicide
    if (rules.selfdestruct) {
      const kw = /(selfdestruct|suicide)\s*\(/i;
      const match = line.match(kw);
      if (match && match.index !== undefined) {
        const idx = match.index;
        pushFinding(
          i,
          idx,
          idx + match[1].length,
          "selfdestruct can permanently remove contract code. Ensure this is intended and access controlled.",
          "SELFDESTRUCT",
          vscode.DiagnosticSeverity.Warning
        );
      }
    }

    // 3. DELEGATECALL - Cảnh báo sử dụng delegatecall
    if (rules.delegatecall) {
      const kw = /\.delegatecall\s*\(/i;
      const match = line.match(kw);
      if (match && match.index !== undefined) {
        const idx = match.index + 1; // skip the dot
        pushFinding(
          i,
          idx,
          idx + "delegatecall".length,
          "delegatecall can lead to unexpected context changes. Validate target and data.",
          "DELEGATECALL",
          vscode.DiagnosticSeverity.Warning
        );
      }
    }

    // 4. LOW_LEVEL_CALL_VALUE - Cảnh báo low-level call với value (reentrancy risk)
    if (rules.lowLevelCallValue) {
      const kw1 = /\.call\s*\{\s*value\s*:\s*/i;
      const kw2 = /\.call\.value\s*\(/i; // old style (pre-0.6)
      const match = line.match(kw1) || line.match(kw2);
      if (match && match.index !== undefined) {
        const idx = match.index + 1; // skip the dot
        pushFinding(
          i,
          idx,
          idx +
          (match[0].toLowerCase().includes("call.value")
            ? "call.value".length
            : "call{value:".length),
          "Low-level call with value can introduce reentrancy. Use Checks-Effects-Interactions and consider .transfer/.send limitations.",
          "LOW_LEVEL_CALL_VALUE",
          vscode.DiagnosticSeverity.Warning
        );
      }
    }

    // =============================================================================
    // SYNTAX RULES - Phát hiện lỗi cú pháp cơ bản
    // =============================================================================

    // 5. MISSING_SEMICOLON - Kiểm tra thiếu dấu chấm phẩy
    if (rules.missingSemicolon) {
      const trimmedLine = line.trim();

      // Patterns cần dấu chấm phẩy cuối dòng
      const needsSemicolon = [
        /^\s*(uint|int|string|bool|address|bytes\d*)\s+\w+\s*[=;]/i, // Variable declarations
        /^\s*\w+\s*=\s*[^=]/i,                                      // Assignment statements
        /^\s*(require|assert|revert)\s*\(/i,                       // Require/assert statements
        /^\s*(emit|return|break|continue)\b/i,                     // Control flow statements
      ];

      for (const pattern of needsSemicolon) {
        if (pattern.test(line)) {
          // Chỉ báo lỗi nếu dòng không kết thúc bằng ; { } và không phải comment
          if (
            !trimmedLine.endsWith(";") &&
            !trimmedLine.endsWith("{") &&
            !trimmedLine.endsWith("}") &&
            trimmedLine !== "" &&
            !trimmedLine.startsWith("//") &&
            !trimmedLine.startsWith("/*")
          ) {
            const idx = line.length - 1;
            pushFinding(
              i,
              idx,
              idx + 1,
              "Missing semicolon at end of statement.",
              "MISSING_SEMICOLON",
              vscode.DiagnosticSeverity.Error
            );
            break;
          }
        }
      }
    }

    // 6. MISSING_PARENTHESES - Kiểm tra thiếu dấu ngoặc đơn trong function calls
    if (rules.missingParentheses) {
      const trimmedLine = line.trim();

      // Pattern function call thiếu dấu ngoặc đơn
      const functionCallPattern = /^\s*\w+\s*[^(\s{;}]$/;

      if (
        functionCallPattern.test(line) &&
        !trimmedLine.endsWith(";") &&
        !trimmedLine.endsWith(",") &&
        !trimmedLine.endsWith("{") &&
        !trimmedLine.endsWith("}") &&
        !trimmedLine.startsWith("//") &&
        !trimmedLine.startsWith("/*") &&
        !line.includes("=") && // Không phải assignment
        !line.includes(":")    // Không phải mapping
      ) {
        const idx = line.length - 1;
        pushFinding(
          i,
          idx,
          idx + 1,
          "Missing parentheses for function call.",
          "MISSING_PARENTHESES",
          vscode.DiagnosticSeverity.Error
        );
      }
    }


    // 7. MISSING_RETURN - Kiểm tra thiếu return statement
    if (rules.missingReturn) {
      // Kiểm tra function có return type nhưng thiếu return
      const functionWithReturnType =
        /\bfunction\s+\w+\s*\([^)]*\)\s*(public|private|internal|external)?\s*(pure|view|payable)?\s*returns\s*\([^)]*\)/i;
      if (functionWithReturnType.test(line)) {
        // TODO: Cần parse function body để kiểm tra return statement
        // Logic này phức tạp vì cần context về function body
      }
    }

    // 8. WRONG_KEYWORDS - Kiểm tra từ khóa deprecated/sai
    if (rules.wrongKeywords) {
      const wrongKeywords = [
        {
          pattern: /\b(var\s+)/i,
          correct: "uint",
          message: "Use specific data type instead of 'var'",
        },
        {
          pattern: /\b(suicide\s*\()/i,
          correct: "selfdestruct",
          message: "'suicide' is deprecated, use 'selfdestruct'",
        },
      ];

      for (const { pattern, message } of wrongKeywords) {
        const match = line.match(pattern);
        if (match && match.index !== undefined) {
          const idx = match.index;
          pushFinding(
            i,
            idx,
            idx + match[1].length,
            message,
            "WRONG_KEYWORD",
            vscode.DiagnosticSeverity.Warning
          );
        }
      }
    }

    // 9. MISSING_DATA_TYPE - Kiểm tra khai báo biến thiếu kiểu dữ liệu
    if (rules.missingDataType) {
      const varDeclarationPattern =
        /^\s*(public|private|internal|external)?\s*(memory|storage|calldata)?\s*\w+\s*=/i;
      const match = line.match(varDeclarationPattern);
      if (match && !line.includes("//") && !line.includes("/*")) {
        // Kiểm tra xem có phải khai báo biến local thiếu type
        const beforeEqual = line.substring(0, line.indexOf("=")).trim();
        const hasDataType = /\b(uint|int|string|bool|address|bytes|mapping|struct)/i.test(beforeEqual);

        if (!hasDataType && beforeEqual.split(/\s+/).length <= 2) {
          const idx = beforeEqual.length - 1;
          pushFinding(
            i,
            idx,
            idx + 1,
            "Missing data type declaration for variable.",
            "MISSING_DATA_TYPE",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }

    // 10. MISSING_PAYABLE - Kiểm tra thiếu payable modifier cho function nhận ETH
    if (rules.missingPayable) {
      // Kiểm tra function có thể nhận ETH nhưng thiếu payable
      const functionPattern =
        /\bfunction\s+\w+\s*\([^)]*\)\s*(public|private|internal|external)?\s*(pure|view)?\s*(?!payable)/i;
      const hasValueTransfer = /\.transfer\(|\.send\(|\.call\{.*value/i;

      if (functionPattern.test(line) && hasValueTransfer.test(content)) {
        const match = line.match(functionPattern);
        if (match && match.index !== undefined) {
          const idx = match.index;
          pushFinding(
            i,
            idx,
            idx + match[0].length,
            "Function that handles ETH should have 'payable' modifier.",
            "MISSING_PAYABLE",
            vscode.DiagnosticSeverity.Warning
          );
        }
      }
    }
  }

  return findings;
}
