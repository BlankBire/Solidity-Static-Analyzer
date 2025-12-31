import * as vscode from "vscode";

/**
 * Bộ phân tích mã tĩnh Solidity (Solidify)
 * 
 * Công cụ này thực hiện quét mã nguồn Solidity để phát hiện các lỗ hổng bảo mật,
 * lỗi cú pháp và các vấn đề về quy chuẩn lập trình (naming, semantic).
 */

// =============================================================================
// ĐỊNH NGHĨA KIỂU DỮ LIỆU
// =============================================================================

/**
 * Cấu hình các quy tắc phân tích (Analyzer Rules).
 * Mỗi thuộc tính tương ứng với một quy trình kiểm tra cụ thể.
 */
export type AnalyzerRules = {
  // Quy tắc bảo mật (Security Rules)
  txOrigin: boolean;
  selfdestruct: boolean;
  delegatecall: boolean;
  lowLevelCallValue: boolean;

  // Quy tắc cú pháp (Syntax Rules)
  missingSemicolon: boolean;
  missingParentheses: boolean;
  missingBraces: boolean;
  missingReturn: boolean;
  wrongKeywords: boolean;
  missingDataType: boolean;
  legacyFallbackFunction: boolean;
  missingPayable: boolean;

  // Quy tắc đặt tên (Naming Rules)
  functionNaming: boolean;
  variableNaming: boolean;
  contractNaming: boolean;

  // Quy tắc ngữ nghĩa (Semantic Rules)
  missingVisibility: boolean;
  unsafeAddressCast: boolean;
  deprecatedThisBalance: boolean;
  legacyConstructor: boolean;
  msgSenderTransfer: boolean;
  lowLevelCallNoData: boolean;
  uncheckedLowLevelCall: boolean;
  tryReturnShadowing: boolean;
  unusedTryReturnVariable: boolean;

  // Quy tắc Pragma (Pragma Rules)
  missingLicense: boolean;
  missingVersion: boolean;
};

/**
 * Cấu trúc dữ liệu ghi lại kết quả phát hiện (Finding).
 */
export type Finding = {
  message: string;                   // Nội dung thông báo lỗi
  code: string;                      // Mã định danh của quy tắc (ví dụ: MISSING_SEMICOLON)
  severity: vscode.DiagnosticSeverity; // Mức độ nghiêm trọng (Error, Warning, Info, Hint)
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

/**
 * Cấu hình các mẫu regex cho việc kiểm tra đặt tên.
 */
export type NamingConfig = {
  functionPattern: string;
  variablePattern: string;
  constantPattern: string;
  contractPattern: string;
};

// =============================================================================
// HÀM PHÂN TÍCH CHÍNH (MAIN ANALYZER)
// =============================================================================

/**
 * Hàm phân tích mã nguồn Solidity chính.
 * 
 * @param content Nội dung mã nguồn cần quét.
 * @param rules Các quy tắc sẽ được áp dụng.
 * @param maxProblems Giới hạn số lượng phát hiện tối đa để đảm bảo hiệu năng.
 * @param naming Cấu hình regex cho việc đặt tên.
 * @param useAST Có sử dụng bộ phân tích AST (tree-sitter) hay không.
 * @param payableHeuristic Cấu hình heuristics cho việc gợi ý payable.
 * @param filePath Đường dẫn file (nếu có) để phân tích liên file (cross-file).
 * @returns Danh sách các findings đã tìm thấy.
 */
export function analyzeText(
  content: string,
  rules: AnalyzerRules,
  maxProblems: number,
  naming?: NamingConfig,
  useAST?: boolean,
  payableHeuristic?: { enabled: boolean; pattern: string },
  filePath?: string
): Finding[] {
  const findings: Finding[] = [];
  
  // Reported keys dùng để loại bỏ các kết quả trùng lặp tại cùng một vị trí.
  
  // Nếu người dùng bật useASTAnalyzer, chúng ta sẽ sử dụng tree-sitter để phân tách chính xác
  // comment và chuỗi ký tự, giúp giảm thiểu sai số (false positives) khi quét theo dòng.
  // Nếu không có AST hoặc gặp lỗi, sẽ fallback về quét text đơn thuần.
  let contentNoComments = content;
  
  // Bộ parse và cây cú pháp (Parser/Tree) được dùng bởi tree-sitter
  let parser: any = undefined;
  let tree: any = undefined;
  
  // Các vùng cần chú ý trong AST (comment, chuỗi, vùng bị bỏ qua)
  let commentRanges: Array<[number, number]> = [];
  let stringLiteralRanges: Array<[number, number]> = [];
  let ignoredRanges: Array<[number, number]> = [];
  
  // Tập hợp các dòng nằm trong danh sách tham số hàm (parameter list)
  let parameterLineSet: Set<number> = new Set<number>();
  
  // Theo dõi các identifier (biến, hàm) bị thiếu kiểu dữ liệu
  const missingTypeIdentifiers = new Set<string>();
  
  // Danh sách các identifier đã được khai báo đầy đủ
  const declaredIdentifiers = new Set<string>();
  
  // Lưu trữ vị trí khai báo của identifier để báo cáo lỗi tốt hơn
  const declaredIdentifierPositions = new Map<
    string,
    { startIndex: number; endIndex: number; startPosition: any }
  >();
  
  // Danh sách identifier được sử dụng thực tế (được điền khi có AST)
  const usedIdentifiers = new Set<string>();
  
  // Thông tin chi tiết về các khai báo (bao gồm scope/phạm vi)
  const declaredDeclarations: Array<{
    name: string;
    declNode: any;
    scopeNode: any;
    startIndex: number;
    startPosition: any;
    scopeType?: string;
  }> = [];

  // Các kết quả phân tích liên file được thu thập tạm thời
  const preCrossFindings: Array<{
    line: number;
    start: number;
    end: number;
    msg: string;
    code: string;
    sev: any;
  }> = [];

  // BƯỚC 1: PHÂN TÍCH AST (Nếu được bật)
  if (useAST) {
    try {
      // Nạp bộ Parser tree-sitter cho Solidity
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Parser: any = require("tree-sitter");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SolidityLang: any = require("tree-sitter-solidity");
      parser = new Parser();
      parser.setLanguage(SolidityLang);
      tree = parser.parse(content);

      // Thu thập các vùng chứa comment và string literals để loại trừ khi quét text
      commentRanges = [];
      stringLiteralRanges = [];
      const collectTrivia = (node: any) => {
        if (!node) return;
        const t = String(node.type).toLowerCase();
        if (t.includes("comment")) {
          commentRanges.push([node.startIndex, node.endIndex]);
        }
        if (
          t.includes("string_literal") ||
          t.includes("unicode_string") ||
          t.includes("hex_string")
        ) {
          stringLiteralRanges.push([node.startIndex, node.endIndex]);
        }
        const kids = node.namedChildren || node.children || [];
        for (const c of kids) collectTrivia(c);
      };
      if (tree && tree.rootNode) collectTrivia(tree.rootNode);

      // Xác định các phạm vi cần bỏ qua đối với kiểm tra dấu ngoặc (ngoại trừ return/emit)
      const ignoreNodeTypes = new Set(["return_statement", "emit_statement"]);
      ignoredRanges = [];
      const collectIgnored = (node: any) => {
        if (!node) return;
        if (ignoreNodeTypes.has(String(node.type))) {
          ignoredRanges.push([node.startIndex, node.endIndex]);
        }
        const kids = node.namedChildren || node.children || [];
        for (const c of kids) collectIgnored(c);
      };
      if (tree && tree.rootNode) collectIgnored(tree.rootNode);

      // Lưu ý: Không xóa các comment khỏi content tại đây.
      // Chúng ta giữ `contentNoComments` giống hệt `content` gốc để các chỉ số dòng
      // từ AST khớp với các chỉ số dòng khi quét từng hàng bên dưới.
      contentNoComments = content;

      // Thu thập các identifier đã khai báo từ AST: state vars, tham số, biến cục bộ
      try {
        const collectDeclared = (node: any) => {
          if (!node) return;
          const t = String(node.type).toLowerCase();
          
          // Khai báo Contract, Interface, Library
          if (
            t === "contract_declaration" ||
            t === "contract_definition" ||
            t === "interface_definition" ||
            t === "library_definition"
          ) {
            const nameNode = (node.namedChildren || []).find(
              (child: any) => child.type === "identifier"
            );
            if (nameNode) {
              const name = content
                .slice(nameNode.startIndex, nameNode.endIndex)
                .trim();
              if (name) {
                declaredIdentifiers.add(name);
                declaredIdentifierPositions.set(name, {
                  startIndex: nameNode.startIndex,
                  endIndex: nameNode.endIndex,
                  startPosition: nameNode.startPosition,
                } as any);
              }
            }
          }
          
          // Khai báo biến trạng thái (state variable) và biến cục bộ
          if (
            t === "state_variable_declaration" ||
            t === "variable_declaration"
          ) {
            const kids = node.namedChildren || node.children || [];
            for (const c of kids) {
              try {
                if (
                  c.type === "identifier" ||
                  String(c.type).toLowerCase() === "identifier"
                ) {
                  const name = content.slice(c.startIndex, c.endIndex);
                  declaredIdentifiers.add(name);
                  
                  // Xác định node chứa phạm vi (scope): function/contract/block gần nhất
                  const scopeTypes = new Set([
                    "function_definition",
                    "function_declaration",
                    "contract_definition",
                    "block",
                    "if_statement",
                    "for_statement",
                    "while_statement",
                  ]);
                  let scopeNode: any = node;
                  try {
                    let cur = c.parent;
                    while (cur && !scopeTypes.has(String(cur.type))) {
                      cur = cur.parent;
                    }
                    scopeNode = cur || tree.rootNode;
                  } catch (_) {
                    scopeNode = tree.rootNode;
                  }
                  
                  declaredIdentifierPositions.set(name, {
                    startIndex: c.startIndex,
                    endIndex: c.endIndex,
                    startPosition: c.startPosition,
                  } as any);
                  
                  declaredDeclarations.push({
                    name,
                    declNode: c,
                    scopeNode,
                    startIndex: c.startIndex,
                    startPosition: c.startPosition,
                    scopeType: String(scopeNode.type),
                  });
                } else if (c.namedChildren && c.namedChildren.length > 0) {
                  for (const cc of c.namedChildren) {
                    if (cc.type === "identifier") {
                      const name = content.slice(cc.startIndex, cc.endIndex);
                      declaredIdentifiers.add(name);
                      
                      const scopeTypes2 = new Set([
                        "function_definition",
                        "function_declaration",
                        "contract_definition",
                        "block",
                        "if_statement",
                        "for_statement",
                        "while_statement",
                      ]);
                      let scopeNode2: any = node;
                      try {
                        let cur2 = cc.parent;
                        while (cur2 && !scopeTypes2.has(String(cur2.type))) {
                          cur2 = cur2.parent;
                        }
                        scopeNode2 = cur2 || tree.rootNode;
                      } catch (_) {
                        scopeNode2 = tree.rootNode;
                      }
                      
                      declaredIdentifierPositions.set(name, {
                        startIndex: cc.startIndex,
                        endIndex: cc.endIndex,
                        startPosition: cc.startPosition,
                      } as any);
                      
                      declaredDeclarations.push({
                        name,
                        declNode: cc,
                        scopeNode: scopeNode2,
                        startIndex: cc.startIndex,
                        startPosition: cc.startPosition,
                        scopeType: String(scopeNode2.type),
                      });
                    }
                  }
                }
              } catch (_) {
                // Bỏ qua lỗi nhỏ khi trích xuất identifier
              }
            }
          }
          
          // Tham số hàm (Function parameters)
          if (t === "parameter_list" || t === "parameter") {
            const kids = node.namedChildren || node.children || [];
            for (const c of kids) {
              if (c.type === "identifier") {
                const name = content.slice(c.startIndex, c.endIndex);
                declaredIdentifiers.add(name);
                
                // Phạm vi của tham số là hàm bao quanh
                let scopeNodeP: any = tree.rootNode;
                try {
                  let curP = c.parent;
                  while (
                    curP &&
                    !/function_definition|function_declaration/i.test(
                      String(curP.type)
                    )
                  ) {
                    curP = curP.parent;
                  }
                  scopeNodeP = curP || tree.rootNode;
                } catch (_) {
                  scopeNodeP = tree.rootNode;
                }
                
                declaredIdentifierPositions.set(name, {
                  startIndex: c.startIndex,
                  endIndex: c.endIndex,
                  startPosition: c.startPosition,
                } as any);
                
                declaredDeclarations.push({
                  name,
                  declNode: c,
                  scopeNode: scopeNodeP,
                  startIndex: c.startIndex,
                  startPosition: c.startPosition,
                  scopeType: String(scopeNodeP.type),
                });
              }
            }
          }
          
          // Các khai báo biến cục bộ khác (có thể là statement)
          if (
            t === "variable_declaration_list" ||
            t === "variable_declaration_statement"
          ) {
            const kids = node.namedChildren || node.children || [];
            for (const c of kids) {
              if (c.type === "identifier") {
                const name = content.slice(c.startIndex, c.endIndex);
                declaredIdentifiers.add(name);
                declaredIdentifierPositions.set(name, {
                  startIndex: c.startIndex,
                  endIndex: c.endIndex,
                  startPosition: c.startPosition,
                });
                
                let scopeNodeV: any = tree.rootNode;
                try {
                  let curV = c.parent;
                  const scopeTypesV = new Set([
                    "function_definition",
                    "function_declaration",
                    "block",
                  ]);
                  while (curV && !scopeTypesV.has(String(curV.type))) {
                    curV = curV.parent;
                  }
                  scopeNodeV = curV || tree.rootNode;
                } catch (_) {
                  scopeNodeV = tree.rootNode;
                }
                
                declaredDeclarations.push({
                  name,
                  declNode: c,
                  scopeNode: scopeNodeV,
                  startIndex: c.startIndex,
                  startPosition: c.startPosition,
                  scopeType: String(scopeNodeV.type),
                });
              }
            }
          }
          
          const kids = node.namedChildren || node.children || [];
          for (const c of kids) collectDeclared(c);
        };
        if (tree && tree.rootNode) collectDeclared(tree.rootNode);

        // Thu thập các dòng thuốc danh sách tham số (dùng cho detection dựa trên AST)
        parameterLineSet = new Set<number>();
        try {
          const walkParams = (node: any) => {
            if (!node) return;
            if (String(node.type) === "parameter_list") {
              const start = node.startPosition ? node.startPosition.row : 0;
              const end = node.endPosition ? node.endPosition.row : start;
              for (let r = start; r <= end; r++) parameterLineSet.add(r);
            }
            const kids = node.namedChildren || node.children || [];
            for (const c of kids) walkParams(c);
          };
          if (tree && tree.rootNode) walkParams(tree.rootNode);
        } catch (e) {
          // Bỏ qua
        }
      } catch (e) {
        // Bỏ qua
      }

      // Kiểm tra liên file (Cross-file checks): Giải quyết các import và export
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { runCrossFileChecks } = require("./rules/cross");
        runCrossFileChecks(
          content,
          filePath,
          declaredIdentifiers,
          declaredDeclarations,
          (
            line: number,
            start: number,
            end: number,
            msg: string,
            code: string,
            sev: vscode.DiagnosticSeverity
          ) => preCrossFindings.push({ line, start, end, msg, code, sev })
        );
      } catch (e) {
        // Bỏ qua nếu module cross không khả dụng
      }
    } catch (err) {
      // Nếu không có tree-sitter hoặc parse lỗi → fallback về kỹ thuật stripping regex truyền thống
      contentNoComments = content;
      parser = undefined;
      tree = undefined;
    }
  }

  // Đảm bảo việc kiểm tra import liên file vẫn chạy ngay cả khi AST bị lỗi.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runCrossFileChecks } = require("./rules/cross");
    runCrossFileChecks(
      content,
      filePath,
      declaredIdentifiers,
      declaredDeclarations,
      (
        line: number,
        start: number,
        end: number,
        msg: string,
        code: string,
        sev: vscode.DiagnosticSeverity
      ) => preCrossFindings.push({ line, start, end, msg, code, sev })
    );
  } catch (e) {
    // Bỏ qua
  }

  // Chia nhỏ nội dung thành mảng các dòng sau khi đã xử lý comment
  const lines = contentNoComments.split(/\r?\n/);

  // Tính toán chỉ số bắt đầu của mỗi dòng trong content gốc để ánh xạ vị trí
  const lineStartIndices: number[] = [];
  for (let p = 0, ln = 0; p < content.length; p++) {
    if (ln === 0) lineStartIndices.push(p);
    if (content[p] === "\n") {
      ln += 1;
      lineStartIndices.push(p + 1);
    }
  }

  // Đảm bảo khớp số lượng dòng
  while (lineStartIndices.length < lines.length) {
    const last = lineStartIndices.length
      ? lineStartIndices[lineStartIndices.length - 1]
      : 0;
    lineStartIndices.push(last);
  }

  const reportedKeys = new Set<string>();

  /**
   * Hàm trợ giúp để ghi nhận một phát hiện mới vào danh sách.
   */
  const pushFinding = (
    lineIndex: number,
    start: number,
    end: number,
    message: string,
    code: string,
    severity: vscode.DiagnosticSeverity
  ) => {
    // Dừng thu thập nếu vượt quá giới hạn cấu hình
    if (findings.length >= maxProblems) {
      return;
    }
    
    // Tạo khóa xác định duy nhất lỗi tại cùng một vị trí để tránh trùng lặp
    const key = `${lineIndex}:${start}:${end}:${code}`;
    if (reportedKeys.has(key)) {
      return;
    }
    reportedKeys.add(key);
    
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

  // Đẩy các kết quả liên file đã thu thập trước đó vào danh sách chính
  if (preCrossFindings && preCrossFindings.length > 0) {
    for (const pf of preCrossFindings) {
      try {
        pushFinding(pf.line, pf.start, pf.end, pf.msg, pf.code, pf.sev);
      } catch (_err) {
        // Bỏ qua lỗi lẻ tẻ khi flush
      }
    }
    preCrossFindings.length = 0;
  }

  // =============================================================================
  // CÁC QUY TẮC PHÂN TÍCH THEO MODULE
  // =============================================================================

  // PHẦN 1: PRAGMA RULES - Kiểm tra license và version
  try {
    const { runPragmaRules } = require("./rules/pragma");
    runPragmaRules(
      content,
      {
        missingLicense: !!rules.missingLicense,
        missingVersion: !!rules.missingVersion,
      },
      pushFinding
    );
  } catch (e) {
    // Bỏ qua nếu module không nạp được
  }

  // PHẦN 2: MISSING RETURN (Dựa trên AST)
  if (rules.missingReturn && tree) {
    try {
      const { runMissingReturnAst } = require("./rules/syntax");
      runMissingReturnAst(content, tree, pushFinding);
    } catch {}
  }

  // PHẦN 3: SEMANTIC RULES (Dựa trên AST) - Visibility, Casts, Deprecated patterns
  if (tree) {
    try {
      const { runSemanticRulesAst } = require("./rules/semantic");
      runSemanticRulesAst(
        content,
        tree,
        {
          missingVisibility: !!rules.missingVisibility,
          unsafeAddressCast: !!rules.unsafeAddressCast,
          deprecatedThisBalance: !!rules.deprecatedThisBalance,
          legacyConstructor: !!rules.legacyConstructor,
          msgSenderTransfer: !!rules.msgSenderTransfer,
          lowLevelCallNoData: !!rules.lowLevelCallNoData,
          uncheckedLowLevelCall: !!rules.uncheckedLowLevelCall,
          tryReturnShadowing: !!rules.tryReturnShadowing,
          unusedTryReturnVariable: !!rules.unusedTryReturnVariable,
          legacyFallbackFunction: !!rules.legacyFallbackFunction,
        },
        pushFinding
      );
    } catch {}
  }

  // PHẦN 4: PARENTHESES ANALYSIS (Dựa trên AST + Character-level) - Kiểm tra dấu ngoặc
  if (rules.missingParentheses) {
    try {
      const { runParenthesesGlobal } = require("./rules/syntax");
      runParenthesesGlobal(
        content,
        tree,
        commentRanges,
        ignoredRanges,
        stringLiteralRanges,
        declaredIdentifiers,
        pushFinding
      );
    } catch {}
  }

  // PHẦN 5: UNUSED VARIABLE - Kiểm tra biến không sử dụng
  try {
    const { runUnusedVariables } = require("./rules/unused");
    // Kiểm tra bao gồm cả biến trạng thái (state variables) không được tham chiếu
    runUnusedVariables(content, tree, declaredDeclarations, pushFinding, {
      includeStateVariables: true,
    });
  } catch (e) {
    // Bỏ qua
  }

  // PHẦN 6: MISSING PAYABLE (AST + Heuristic) - Gợi ý thêm từ khóa payable
  try {
    const { runPayableAstAndHeuristic } = require("./rules/payable");
    runPayableAstAndHeuristic(
      content,
      tree,
      !!rules.missingPayable,
      payableHeuristic,
      pushFinding
    );
  } catch (e) {
    // Bỏ qua
  }

  // PHẦN 7: BRACES GLOBAL - Kiểm tra dấu ngoặc nhọn `{}` tổng quát
  if (rules.missingBraces) {
    try {
      const { runBracesGlobal } = require("./rules/syntax");
      runBracesGlobal(lines, pushFinding);
    } catch {}
  }

  // =============================================================================
  // PHÂN TÍCH TỪNG DÒNG (PER-LINE ANALYSIS)
  // =============================================================================
  // Lưu ý: Các quy tắc phức tạp hơn đã được xử lý bằng AST ở trên. 
  // Phần này xử lý các kiểm tra nhanh dựa trên regex cho từng dòng.

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    
    // Loại bỏ inline comment '//' để tránh phân tích nhầm nội dung trong comment
    const stripInlineComments = (s: string) => s.split("//")[0];
    const line = stripInlineComments(rawLine);
    const lineNoInlineComment = line;
    const lineLower = line.toLowerCase();
    
    // Tìm vị trí ký tự code cuối cùng (không tính khoảng trắng và comment)
    const getLastCodeCharIndex = (s: string) => {
      const codePart = stripInlineComments(s);
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

    // PHẦN 8: SECURITY RULES (Phân tích từng dòng)
    try {
      const { runSecurityRulesSingleLine } = require("./rules/security");
      runSecurityRulesSingleLine(
        line,
        lineLower,
        i,
        {
          txOrigin: !!rules.txOrigin,
          selfdestruct: !!rules.selfdestruct,
          delegatecall: !!rules.delegatecall,
          lowLevelCallValue: !!rules.lowLevelCallValue,
        },
        pushFinding
      );
    } catch {}

    // PHẦN 9: SYNTAX RULES (Phân tích từng dòng) - Semicolon, Keywords, Data types...
    try {
      const { runSyntaxRulesSingleLine } = require("./rules/syntax");
      runSyntaxRulesSingleLine(
        line,
        lineLower,
        i,
        lines,
        {
          missingSemicolon: !!rules.missingSemicolon,
          missingParentheses: !!rules.missingParentheses,
          wrongKeywords: !!rules.wrongKeywords,
          missingDataType: !!rules.missingDataType,
        },
        content,
        pushFinding,
        declaredIdentifiers,
        missingTypeIdentifiers,
        commentRanges,
        lineStartIndices,
        parameterLineSet
      );
    } catch {}

    // PHẦN 10: MISSING PAYABLE (Fallback cho từng dòng) - receive(), các heuristic không AST
    try {
      const { runPayableLineFallbackSingle } = require("./rules/payable");
      runPayableLineFallbackSingle(
        line,
        i,
        content,
        tree,
        !!rules.missingPayable,
        pushFinding
      );
    } catch {}

    // PHẦN 11: NAMING RULES (Phân tích từng dòng) - Kiểm tra quy tắc đặt tên
    try {
      const { runNamingRulesSingleLine } = require("./rules/naming");
      runNamingRulesSingleLine(
        line,
        i,
        naming,
        {
          functionNaming: !!rules.functionNaming,
          variableNaming: !!rules.variableNaming,
          contractNaming: !!rules.contractNaming,
        },
        pushFinding,
        lines,
        parameterLineSet
      );
    } catch {}
  }

  return findings;
}
