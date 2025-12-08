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
  legacyFallbackFunction: boolean;
  missingPayable: boolean;
  // Naming Rules
  functionNaming: boolean;
  variableNaming: boolean;
  contractNaming: boolean;
  // Semantic Rules
  missingVisibility: boolean;
  unsafeAddressCast: boolean;
  deprecatedThisBalance: boolean;
  legacyConstructor: boolean;
  msgSenderTransfer: boolean;
  lowLevelCallNoData: boolean;
  uncheckedLowLevelCall: boolean;
  tryReturnShadowing: boolean;
  unusedTryReturnVariable: boolean;
  // Pragma Rules - Cảnh báo thiếu license hoặc version
  missingLicense: boolean;
  missingVersion: boolean;
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
  naming?: NamingConfig,
  useAST?: boolean,
  payableHeuristic?: { enabled: boolean; pattern: string },
  filePath?: string
): Finding[] {
  const findings: Finding[] = [];
  // Reported keys to deduplicate diagnostics
  // (moved declarations earlier to enable AST traversal to populate them)
  // Nếu user bật useASTAnalyzer, sẽ dùng tree-sitter để tìm chính xác comment
  // và loại bỏ chúng trước khi phân tích theo dòng. Nếu không có AST hoặc lỗi,
  // fallback về nội dung gốc và dùng stripping regex sau.
  let contentNoComments = content;
  // Parser/tree được khởi tạo nếu useAST được bật và tree-sitter tồn tại
  let parser: any = undefined;
  let tree: any = undefined;
  // commentRanges and ignoredRanges will be filled if AST parsing succeeds
  let commentRanges: Array<[number, number]> = [];
  let stringLiteralRanges: Array<[number, number]> = [];
  let ignoredRanges: Array<[number, number]> = [];
  // set of line numbers that are inside any AST parameter_list node
  let parameterLineSet: Set<number> = new Set<number>();
  // Theo dõi các identifier bị thiếu kiểu để cảnh báo khi được sử dụng ở các dòng sau
  const missingTypeIdentifiers = new Set<string>();
  // Theo dõi các identifier đã được khai báo (có type)
  const declaredIdentifiers = new Set<string>();
  // store declaration positions for better diagnostics
  const declaredIdentifierPositions = new Map<
    string,
    { startIndex: number; endIndex: number; startPosition: any }
  >();
  // identifiers used (populated when AST available)
  const usedIdentifiers = new Set<string>();
  // detailed declared declarations with scope info
  const declaredDeclarations: Array<{
    name: string;
    declNode: any;
    scopeNode: any;
    startIndex: number;
    startPosition: any;
    scopeType?: string;
  }> = [];
  // cross-file diagnostics collected before main pushFinding exists
  const preCrossFindings: Array<{
    line: number;
    start: number;
    end: number;
    msg: string;
    code: string;
    sev: any;
  }> = [];
  if (useAST) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Parser: any = require("tree-sitter");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SolidityLang: any = require("tree-sitter-solidity");
      parser = new Parser();
      parser.setLanguage(SolidityLang);
      tree = parser.parse(content);

      // Collect comment and string literal node ranges
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

      // Collect ranges to ignore for parentheses checks (e.g., return/emit statements)
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

      // Do not remove comment ranges from the content here.
      // We keep `contentNoComments` equal to original `content` so line
      // numbers produced by the AST (tree-sitter) match the per-line
      // indices used below. Comment ranges are still available in
      // `commentRanges` for rules that need them.
      contentNoComments = content;
      // Collect declared identifiers from AST: state vars, parameters, and local var declarations
      try {
        const collectDeclared = (node: any) => {
          if (!node) return;
          const t = String(node.type).toLowerCase();
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
          // state variable declarations (tree-sitter-solidity: state_variable_declaration)
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
                  // determine scope node: nearest enclosing function/contract/block
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
                      // find scope node
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
                // noop
              }
            }
          }
          // function parameters
          if (t === "parameter_list" || t === "parameter") {
            const kids = node.namedChildren || node.children || [];
            for (const c of kids) {
              if (c.type === "identifier") {
                const name = content.slice(c.startIndex, c.endIndex);
                declaredIdentifiers.add(name);
                // parameter scope -> enclosing function
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
          // local variable declarations may appear as variable_declaration_statement
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
                // scope -> nearest enclosing function/block
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
        // Collect parameter_list line numbers for AST-based param detection
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
          // ignore
        }
      } catch (e) {
        // ignore
      }
      // Cross-file checks: resolve imports and collect exported top-level names
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
        // ignore if cross module not available
      }
    } catch (err) {
      // Nếu không có tree-sitter hoặc parse lỗi → fallback về stripping regex
      contentNoComments = content;
      parser = undefined;
      tree = undefined;
    }
  }
  // Ensure cross-file import checks run even if AST parsing failed.
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
    // ignore if cross module not available
  }
  // Split into lines after comments have been removed (from AST or fallback)
  const lines = contentNoComments.split(/\r?\n/);
  // Compute line start indices in the original content so we can map line->char index
  const lineStartIndices: number[] = [];
  for (let p = 0, ln = 0; p < content.length; p++) {
    if (ln === 0) lineStartIndices.push(p);
    if (content[p] === "\n") {
      ln += 1;
      lineStartIndices.push(p + 1);
    }
  }
  // Ensure at least one entry per line (fallback)
  while (lineStartIndices.length < lines.length) {
    const last = lineStartIndices.length
      ? lineStartIndices[lineStartIndices.length - 1]
      : 0;
    lineStartIndices.push(last);
  }
  // parameterLineSet is available (empty if AST parsing failed)

  const reportedKeys = new Set<string>();

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

  // Flush any cross-file findings that were collected earlier (before pushFinding existed)
  if (preCrossFindings && preCrossFindings.length > 0) {
    for (const pf of preCrossFindings) {
      try {
        pushFinding(pf.line, pf.start, pf.end, pf.msg, pf.code, pf.sev);
      } catch (_err) {
        // ignore individual flush errors
      }
    }
    preCrossFindings.length = 0;
  }

  // =============================================================================
  // PRAGMA RULES (modularized) - license & version
  // =============================================================================
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
    // Nếu module lỗi (chưa tồn tại), bỏ qua để không phá vỡ analyzer
    // console.debug("Pragma rules module load failed", e);
  }

  // Missing return detection (AST-based) via syntax module
  if (rules.missingReturn && tree) {
    try {
      const { runMissingReturnAst } = require("./rules/syntax");
      runMissingReturnAst(content, tree, pushFinding);
    } catch {}
  }

  // Semantic AST-based rules (visibility, casts, deprecated patterns)
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

  // Global parentheses analysis (AST-assisted + character-level)
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

  // UNUSED_VARIABLE via modular rule (scope-aware) — consolidates previous passes
  try {
    const { runUnusedVariables } = require("./rules/unused");
    // Include state variables in the UNUSED_VARIABLE check to flag unreferenced
    // public/private storage that never gets read or written inside the contract
    runUnusedVariables(content, tree, declaredDeclarations, pushFinding, {
      includeStateVariables: true,
    });
  } catch (e) {
    // ignore if module cannot be loaded
  }

  // MISSING_PAYABLE (AST + heuristic) via modular rules
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
    // ignore if module cannot be loaded
  }

  // Braces global check via syntax module
  if (rules.missingBraces) {
    try {
      const { runBracesGlobal } = require("./rules/syntax");
      runBracesGlobal(lines, pushFinding);
    } catch {}
  }

  // =============================================================================
  // PHÂN TÍCH TỪNG DÒNG
  // =============================================================================

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    // Loại bỏ inline comment '//' trên cùng 1 dòng (block comments đã bị xóa phía trên)
    const stripInlineComments = (s: string) => s.split("//")[0];
    const line = stripInlineComments(rawLine);
    const lineNoInlineComment = line;
    const lineLower = line.toLowerCase();
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
    // SECURITY RULES (modularized per-line)
    // =============================================================================
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

    // =============================================================================
    // SYNTAX RULES (modularized per-line)
    // =============================================================================
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

    // 10. MISSING_PAYABLE - Fallback per-line checks (receive(), no-AST heuristic)
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

    // =============================================================================
    // NAMING RULES (modularized per-line)
    // =============================================================================
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
