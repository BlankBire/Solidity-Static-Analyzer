import * as vscode from "vscode";

/**
 * Bộ phân tích mã tĩnh Solidity
 * 
 * Bộ phân tích mã tĩnh cho Solidity smart contracts.
 * Phát hiện các vấn đề bảo mật và lỗi cú pháp phổ biến.
 */

// =============================================================================
// ĐỊNH NGHĨA KIỂU DỮ LIỆU
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
  // Naming Rules
  functionNaming: boolean;
  variableNaming: boolean;
  contractNaming: boolean;
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

export type NamingConfig = {
  functionPattern: string;
  variablePattern: string;
  constantPattern: string;
  contractPattern: string;
};

// =============================================================================
// HÀM PHÂN TÍCH CHÍNH
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
  maxProblems: number,
  naming?: NamingConfig
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  // Hàm helper để thêm finding vào danh sách
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
  // PHÂN TÍCH CÚ PHÁP - KIỂM TRA DẤU NGOẶC NHỌN (Phương pháp Stack-based)
  // =============================================================================

  if (rules.missingBraces) {
    const stack: { line: number; col: number }[] = [];
    let extraClosingReported = false;

    // Duyệt qua từng ký tự để kiểm tra dấu ngoặc nhọn khớp nhau
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === "{") {
          stack.push({ line: i, col: j });
        } else if (char === "}") {
          if (stack.length === 0) {
            // Dấu ngoặc nhọn đóng thừa - chỉ báo lỗi 1 lần
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
  // PHÂN TÍCH TỪNG DÒNG
  // =============================================================================

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNoInlineComment = line.split("//")[0];
    const lineLower = line.toLowerCase();
    const stripInlineComments = (s: string) => {
      const noLine = s.split("//")[0];
      const blockIdx = noLine.indexOf("/*");
      return blockIdx >= 0 ? noLine.slice(0, blockIdx) : noLine;
    };
    const getLastCodeCharIndex = (s: string) => {
      const codePart = stripInlineComments(s);
      // vị trí ký tự code cuối cùng (bỏ khoảng trắng cuối)
      for (let k = codePart.length - 1; k >= 0; k -= 1) {
        const ch = codePart[k];
        if (ch !== " " && ch !== "\t") {
          return k;
        }
      }
      return Math.max(0, codePart.length - 1);
    };
    const makeRegex = (pattern: string) => {
      try {
        return new RegExp(pattern);
      } catch (_) {
        return undefined;
      }
    };

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

      const isCommentOrBlank = (s: string) => {
        const t = s.trim();
        return t === "" || t.startsWith("//") || t.startsWith("/*");
      };

      // 5.1 Phát hiện khai báo biến rộng rãi (hỗ trợ modifiers) không có dấu chấm phẩy cuối
      // Ví dụ: `uint public number` hoặc `address owner` hoặc `mapping(address => uint) balances`
      const typeKeywordPattern = /^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\()/i;
      const modifierKeywords = new Set([
        "public",
        "private",
        "internal",
        "external",
        "view",
        "pure",
        "payable",
        "constant",
        "immutable",
        "memory",
        "storage",
        "calldata",
      ]);

      const lineForDeclCheck = stripInlineComments(line).trim();
      if (
        typeKeywordPattern.test(lineForDeclCheck) &&
        !lineForDeclCheck.includes(" function ") &&
        !lineForDeclCheck.startsWith("function ") &&
        !lineForDeclCheck.endsWith(";") &&
        !lineForDeclCheck.endsWith("{") &&
        !lineForDeclCheck.endsWith("}")
      ) {
        // Tránh false positives cho danh sách tham số bằng cách bỏ qua các dòng chứa '(' trừ khi là mapping(
        if (!lineForDeclCheck.includes("(") || /\bmapping\s*\(/i.test(lineForDeclCheck)) {
          const tokens = lineForDeclCheck
            .replace(/\b(mapping\s*\([^)]*\))/gi, "mapping")
            .split(/\s+/)
            .filter(Boolean);
          // Tìm một identifier token hợp lý không phải là modifier hoặc type keyword
          let hasIdentifier = false;
          for (let tIndex = 1; tIndex < tokens.length; tIndex += 1) {
            const tok = tokens[tIndex];
            const isModifier = modifierKeywords.has(tok.toLowerCase());
            const isType = typeKeywordPattern.test(tok);
            const isArray = /\[.*\]$/.test(tok);
            const isIdentifier = /[A-Za-z_][A-Za-z0-9_]*/.test(tok);
            if (!isModifier && !isType && isIdentifier && !isArray) {
              hasIdentifier = true;
              break;
            }
          }
          if (hasIdentifier) {
            const idx = getLastCodeCharIndex(line);
            pushFinding(
              i,
              idx,
              idx + 1,
              "Missing semicolon at end of declaration.",
              "MISSING_SEMICOLON",
              vscode.DiagnosticSeverity.Error
            );
          }
        }
      }

      // 5.2 Các câu lệnh một dòng yêu cầu dấu chấm phẩy
      const needsSemicolon = [
        /^\s*\w+\s*=\s*[^=]/i, // Câu lệnh gán
        /^\s*(require|assert|revert)\s*\(/i, // Require/assert/revert
        /^\s*(emit|return|break|continue)\b/i, // Luồng điều khiển
      ];

      for (const pattern of needsSemicolon) {
        if (pattern.test(stripInlineComments(line))) {
          if (
            !stripInlineComments(trimmedLine).endsWith(";") &&
            !stripInlineComments(trimmedLine).endsWith("{") &&
            !stripInlineComments(trimmedLine).endsWith("}") &&
            !isCommentOrBlank(trimmedLine)
          ) {
            const idx = getLastCodeCharIndex(line);
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

      // 5.3 Câu lệnh nhiều dòng kết thúc bằng ')' mà không có ';'
      // Ví dụ: assignment hoặc call được chia thành nhiều dòng, dòng cuối kết thúc bằng ')'
      if (stripInlineComments(trimmedLine).endsWith(")") && !stripInlineComments(trimmedLine).endsWith(";") && !isCommentOrBlank(trimmedLine)) {
        // Nhìn lại tối đa 5 dòng để tìm starter cần dấu chấm phẩy
        const lookbackLimit = Math.max(0, i - 5);
        let foundStarter = false;
        let isLastLineOfStatement = true;

        // Kiểm tra xem đây có phải là dòng cuối của câu lệnh nhiều dòng không
        // bằng cách xem dòng không trống tiếp theo
        for (let k = i + 1; k < lines.length; k++) {
          const nextLine = stripInlineComments(lines[k]).trim();
          if (nextLine === "") {
            continue; // Bỏ qua dòng trống
          }
          // Nếu dòng tiếp theo bắt đầu một câu lệnh mới hoặc là dấu ngoặc nhọn đóng, đây là dòng cuối
          if (nextLine.startsWith("require") ||
            nextLine.startsWith("emit") ||
            nextLine.startsWith("return") ||
            nextLine.startsWith("}") ||
            nextLine.startsWith("function") ||
            nextLine.startsWith("contract") ||
            nextLine.startsWith("modifier") ||
            nextLine.startsWith("event") ||
            nextLine.startsWith("struct") ||
            nextLine.startsWith("enum")) {
            break;
          }
          // Nếu dòng tiếp theo là một phần của cùng một câu lệnh (không bắt đầu với từ khóa câu lệnh),
          // thì đây không phải là dòng cuối
          isLastLineOfStatement = false;
          break;
        }

        if (!isLastLineOfStatement) {
          continue; // Bỏ qua nếu đây không phải là dòng cuối của câu lệnh
        }

        for (let j = i - 1; j >= lookbackLimit; j -= 1) {
          const prev = lines[j];
          const prevNoComment = stripInlineComments(prev).trim();
          if (isCommentOrBlank(prevNoComment)) {
            continue;
          }
          // Nếu gặp dòng đã kết thúc bằng ';' hoặc bắt đầu/kết thúc block, dừng lại
          if (prevNoComment.endsWith(";") || prevNoComment.endsWith("{") || prevNoComment.endsWith("}")) {
            break;
          }

          // Kiểm tra các pattern khác nhau cần dấu chấm phẩy
          const needsSemicolonPatterns = [
            /^\s*\w+\s*=\s*[^=]/i, // Câu lệnh gán
            /^\s*(require|assert|revert|emit|return)\b/i, // Luồng điều khiển
            /^\s*\([^)]*\)\s*=/i, // Tuple assignment như "(bool success, ) = ..."
            /^\s*\w+\.\w+\s*\(/i, // Method calls như "logic.delegatecall("
            /^\s*\w+\s*\(/i, // Function calls
          ];

          const hasPattern = needsSemicolonPatterns.some(pattern => pattern.test(prevNoComment));
          if (hasPattern) {
            foundStarter = true;
            break;
          }
        }
        if (foundStarter) {
          const idx = getLastCodeCharIndex(line);
          pushFinding(
            i,
            idx,
            idx + 1,
            "Missing semicolon at end of statement.",
            "MISSING_SEMICOLON",
            vscode.DiagnosticSeverity.Error
          );
        }
      }

      // 5.4 Identifier đơn lẻ ở cuối dòng mà không có dấu chấm phẩy (như "logic" trong ví dụ của user)
      // Điều này bắt các trường hợp một identifier đơn lẻ bị treo ở cuối dòng
      const singleIdentifierPattern = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*$/;
      if (singleIdentifierPattern.test(stripInlineComments(trimmedLine)) && !isCommentOrBlank(trimmedLine)) {
        // Đảm bảo nó không phải là function declaration, modifier, hoặc các câu lệnh single-word hợp lệ khác
        const isFunctionDeclaration = /^\s*(function|modifier|event|struct|enum|contract|interface|library)\b/i.test(trimmedLine);
        const isImportStatement = /^\s*(import|pragma)\b/i.test(trimmedLine);
        const isUsingStatement = /^\s*using\b/i.test(trimmedLine);
        const isConstructor = /^\s*constructor\b/i.test(trimmedLine);

        if (!isFunctionDeclaration && !isImportStatement && !isUsingStatement && !isConstructor) {
          const idx = getLastCodeCharIndex(line);
          pushFinding(
            i,
            idx,
            idx + 1,
            "Missing semicolon at end of statement.",
            "MISSING_SEMICOLON",
            vscode.DiagnosticSeverity.Error
          );
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

    // =============================================================================
    // NAMING RULES - Quy tắc đặt tên function/variable
    // =============================================================================

    // 11. FUNCTION_NAMING - Kiểm tra tên hàm
    if (rules.functionNaming && naming) {
      const lineClean = stripInlineComments(line);
      const mFunc = lineClean.match(/\bfunction\b([^\(]*)\(/);
      if (mFunc && mFunc.index !== undefined) {
        const seg = mFunc[1];
        const segStart = mFunc.index + mFunc[0].indexOf(seg);
        // Bỏ khoảng trắng đầu
        const leadingWs = seg.match(/^\s*/)?.[0].length ?? 0;
        const firstIdx = leadingWs;
        const firstAbs = segStart + firstIdx;
        const firstCh = seg[firstIdx];
        // Nếu ký tự đầu không phải là chữ hoặc '_' → lỗi ngay tại đó
        if (!firstCh || !/[A-Za-z_]/.test(firstCh)) {
          pushFinding(i, firstAbs, firstAbs + 1, "Invalid function identifier.", "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
        } else {
          // Lấy identifier đầu
          const idMatch = seg.slice(firstIdx).match(/^[A-Za-z_][A-Za-z0-9_]*/);
          const name = idMatch ? idMatch[0] : "";
          const nameStart = firstAbs;
          const nameEnd = nameStart + name.length;
          // Kiểm tra phần còn lại trước '('
          const rest = seg.slice(firstIdx + name.length);
          if (/[^\s]/.test(rest)) {
            // Có ký tự lạ như '.' hoặc extra token → lỗi tổng quát
            pushFinding(i, nameStart, nameEnd, "Invalid function identifier.", "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
          } else {
            const fnRegex = makeRegex(naming.functionPattern);
            if (fnRegex && !fnRegex.test(name)) {
              pushFinding(i, nameStart, nameEnd, `Invalid function identifier '${name}'.`, "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
            }
          }
        }
      }
    }

    // 12. VARIABLE_NAMING - Kiểm tra tên biến (state/local)
    if (rules.variableNaming && naming) {
      // Heuristic: a declaration that starts with a type keyword or mapping(
      const decl = stripInlineComments(line).trim();
      const startsWithType = /^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+)/i.test(decl);
      const isFunctionLine = /^\s*function\b/i.test(decl);
      const isEventOrOther = /^\s*(contract|interface|library|event|modifier|enum|struct)\b/i.test(decl);
      if (startsWithType && !isFunctionLine && !isEventOrOther) {
        // Remove mapping generics to simplify tokenization
        const normalized = decl.replace(/\b(mapping\s*\([^)]*\))/gi, "mapping");
        const tokens = normalized.split(/\s+/).filter(Boolean);
        // Find first identifier token after type and modifiers
        const modifierKeywords = new Set([
          "public",
          "private",
          "internal",
          "external",
          "view",
          "pure",
          "payable",
          "constant",
          "immutable",
          "memory",
          "storage",
          "calldata",
        ]);
        let identifier: string | undefined;
        let identifierStart = -1;
        let identifierTokenIndex = -1;
        // Find index in original line as well
        const original = stripInlineComments(line);
        // Iterate tokens; skip first (type)
        for (let t = 1; t < tokens.length; t += 1) {
          const tok = tokens[t];
          const isModifier = modifierKeywords.has(tok.toLowerCase());
          const isArray = /\[.*\]$/.test(tok);
          if (!isModifier && !isArray) {
            // Lấy token tên thô, bỏ các ký tự kết thúc như ';', '=', '{' (KHÔNG bỏ dấu ',')
            const base = tok.replace(/[;={].*$/, "").trim();
            if (base.length > 0) {
              identifier = base;
              identifierStart = original.indexOf(tok);
              identifierTokenIndex = t;
              break;
            }
          }
        }
        if (identifier && identifierStart >= 0) {
          // Nếu token tiếp theo cũng là identifier (ví dụ: "num ber"), coi như có khoảng trắng trong tên → lỗi tại token đầu
          const nextTok = tokens[identifierTokenIndex + 1];
          const nextIsArray = nextTok ? /\[.*\]$/.test(nextTok) : false;
          const nextIsModifier = nextTok ? modifierKeywords.has(nextTok?.toLowerCase()) : false;
          const nextLooksIdentifier = nextTok ? /^[A-Za-z_][A-Za-z0-9_]*;?$/.test(nextTok) : false;
          if (nextTok && !nextIsArray && !nextIsModifier && nextLooksIdentifier) {
            pushFinding(
              i,
              identifierStart,
              identifierStart + identifier.length,
              "Invalid variable identifier.",
              "VARIABLE_NAMING",
              vscode.DiagnosticSeverity.Error
            );
          } else {
            const identifierEnd = identifierStart + identifier.length;
            const isConstant = /\b(constant|immutable)\b/i.test(decl) || /\bconstant\b/i.test(decl);
            const varRegex = makeRegex(isConstant ? naming.constantPattern : naming.variablePattern);
            if (varRegex && !varRegex.test(identifier)) {
              pushFinding(
                i,
                identifierStart,
                identifierEnd,
                `Invalid variable identifier '${identifier}'.`,
                "VARIABLE_NAMING",
                vscode.DiagnosticSeverity.Error
              );
            }
          }
        }
      }
    }

    // 13. CONTRACT_NAMING - Kiểm tra tên contract/interface/library
    if (rules.contractNaming && naming) {
      const decl = stripInlineComments(line);
      const m = decl.match(/\b(contract|interface|library)\b([^\{]*)\{/);
      if (m && m.index !== undefined) {
        const seg = m[2];
        const segStart = m.index + m[0].indexOf(seg);
        const leadingWs = seg.match(/^\s*/)?.[0].length ?? 0;
        const firstIdx = leadingWs;
        const firstAbs = segStart + firstIdx;
        const firstCh = seg[firstIdx];
        if (!firstCh || !/[A-Za-z_]/.test(firstCh)) {
          pushFinding(i, firstAbs, firstAbs + 1, "Invalid contract/interface/library identifier.", "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
        } else {
          const idMatch = seg.slice(firstIdx).match(/^[A-Za-z_][A-Za-z0-9_]*/);
          const name = idMatch ? idMatch[0] : "";
          const nameStart = firstAbs;
          const nameEnd = nameStart + name.length;
          const rest = seg.slice(firstIdx + name.length);
          if (/[^\s]/.test(rest)) {
            pushFinding(i, nameStart, nameEnd, "Invalid contract/interface/library identifier.", "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
          } else {
            const rx = makeRegex(naming.contractPattern);
            if (rx && !rx.test(name)) {
              pushFinding(i, nameStart, nameEnd, `Invalid contract/interface/library identifier '${name}'.`, "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
            }
          }
        }
      }
    }
  }

  return findings;
}
