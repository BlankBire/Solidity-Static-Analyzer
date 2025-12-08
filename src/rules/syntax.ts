import * as vscode from "vscode";

type PushFinding = (
  lineIndex: number,
  start: number,
  end: number,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity
) => void;

export interface SyntaxRuleConfig {
  missingSemicolon: boolean;
  missingParentheses: boolean;
  wrongKeywords: boolean;
  missingDataType: boolean;
}

const RESERVED_MISSING_TYPE_KEYWORDS = new Set([
  "payable",
  "public",
  "private",
  "internal",
  "external",
  "view",
  "pure",
  "constant",
  "immutable",
  "virtual",
  "override",
  "constructor",
  "fallback",
  "receive",
  "_",
]);

const CALL_MODIFIER_KEYWORDS = new Set([
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

const CALL_TYPE_KEYWORDS = new Set([
  "bool",
  "string",
  "address",
  "bytes",
  "int",
  "uint",
  "int256",
  "uint256",
]);

const CALL_POST_TYPE_KEYWORDS = new Set([
  "storage",
  "memory",
  "calldata",
  "payable",
  "view",
  "pure",
  "returns",
  "virtual",
  "override",
  "immutable",
]);

const CALL_RESERVED_NAMES = new Set([
  "return",
  "emit",
  "require",
  "assert",
  "revert",
  "break",
  "continue",
]);

/** Per-line syntax checks excluding braces/paren global passes */
export function runSyntaxRulesSingleLine(
  line: string,
  lineLower: string,
  lineIndex: number,
  lines: string[],
  config: SyntaxRuleConfig,
  content: string,
  pushFinding: PushFinding,
  declaredIdentifiers?: Set<string>,
  missingTypeIdentifiers?: Set<string>,
  paramLineSet?: Set<number>,
  commentRanges?: Array<[number, number]>,
  lineStartIndices?: number[]
): void {
  const stripInlineComments = (s: string) => s.split("//")[0];
  const declaredIds = declaredIdentifiers || new Set<string>();
  const missingIds = missingTypeIdentifiers || new Set<string>();
  const addMissingId = (name: string) => {
    if (!name) return;
    if (RESERVED_MISSING_TYPE_KEYWORDS.has(name.toLowerCase())) return;
    missingIds.add(name);
  };
  const stringSegments = (() => {
    const spans: Array<[number, number]> = [];
    let currentQuote: string | null = null;
    let startIdx = -1;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const prev = i > 0 ? line[i - 1] : "";
      const next = i + 1 < line.length ? line[i + 1] : "";
      if (!currentQuote) {
        if (ch === "/" && next === "/") {
          break; // rest of line is comment, no string spans needed
        }
        if (ch === '"' || ch === "'") {
          currentQuote = ch;
          startIdx = i;
        }
      } else if (ch === currentQuote && prev !== "\\") {
        spans.push([startIdx, i + 1]);
        currentQuote = null;
        startIdx = -1;
      }
    }
    return spans;
  })();
  const isInsideString = (idx: number) =>
    stringSegments.some(([s, e]) => idx >= s && idx < e);
  // Determine if this line is inside a function parameter list using AST-derived set
  let isInsideFunctionParams = !!(paramLineSet && paramLineSet.has(lineIndex));
  // Determine if this line is inside a block comment (using AST-provided commentRanges)
  const isInsideBlockComment = (() => {
    if (!commentRanges || !lineStartIndices) return false;
    const start = lineStartIndices[lineIndex] ?? 0;
    const end =
      lineIndex + 1 < lineStartIndices.length
        ? lineStartIndices[lineIndex + 1] - 1
        : content.length;
    for (const [cs, ce] of commentRanges) {
      if (cs <= end && ce >= start) return true;
    }
    return false;
  })();
  if (isInsideBlockComment) return;
  // Fallback: if AST info not available, use text-based heuristic
  if (!isInsideFunctionParams) {
    try {
      const currentIndex = lines.indexOf(line);
      if (currentIndex >= 0) {
        for (
          let bi = Math.max(0, currentIndex - 50);
          bi <= currentIndex;
          bi++
        ) {
          const l = lines[bi] || "";
          if (/\bfunction\b/.test(l)) {
            let balance = 0;
            for (let k = bi; k <= currentIndex; k++) {
              const txt = lines[k] || "";
              for (const ch of txt) {
                if (ch === "(") balance++;
                else if (ch === ")") balance--;
              }
            }
            if (balance > 0) {
              isInsideFunctionParams = true;
            }
            break;
          }
        }
      }
    } catch {}
  }
  // 5. MISSING_SEMICOLON
  if (config.missingSemicolon) {
    const trimmedLine = line.trim();
    const isCommentOrBlank = (s: string) => {
      const t = s.trim();
      return t === "" || t.startsWith("//") || t.startsWith("/*");
    };
    const getLastCodeCharIndex = (s: string) => {
      let idx = s.length - 1;
      while (idx >= 0 && /\s/.test(s[idx])) idx -= 1;
      return Math.max(0, idx);
    };

    // Simple declarations missing semicolon
    const basicTypePattern =
      /^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes)\b/i;
    const mappingTypePattern = /^mapping\s*\(/i;
    const lineForDeclCheck = stripInlineComments(line).trim();
    if (
      (basicTypePattern.test(lineForDeclCheck) ||
        mappingTypePattern.test(lineForDeclCheck)) &&
      !lineForDeclCheck.includes(" function ") &&
      !lineForDeclCheck.endsWith(";")
    ) {
      // If this line is inside a multi-line function parameter list, skip
      if (isInsideFunctionParams) return;
      const previousCodeLine = (() => {
        for (let j = lineIndex - 1; j >= 0; j -= 1) {
          const prev = stripInlineComments(lines[j] ?? "").trim();
          if (prev === "") continue;
          return prev;
        }
        return "";
      })();
      if (
        /\b(function|modifier|constructor)\b/i.test(previousCodeLine) ||
        /^(?:contract|interface|library)\b/i.test(lineForDeclCheck) ||
        lineForDeclCheck.endsWith("{")
      ) {
        // Part of a multi-line function signature; skip.
        return;
      }
      const lastChar = trimmedLine.slice(-1);
      if (lastChar === "(" || lastChar === "" || lastChar === ":") {
        // Likely mid-signature (parameters/modifiers).
        return;
      }
      const idx = getLastCodeCharIndex(line);
      pushFinding(
        lineIndex,
        idx,
        idx + 1,
        "Missing semicolon at end of statement.",
        "MISSING_SEMICOLON",
        vscode.DiagnosticSeverity.Error
      );
    }

    // Multi-line statement ending with ')' no ';'
    if (
      stripInlineComments(trimmedLine).endsWith(")") &&
      !stripInlineComments(trimmedLine).endsWith(";") &&
      !isCommentOrBlank(trimmedLine)
    ) {
      const lookbackLimit = Math.max(0, lineIndex - 5);
      let foundStarter = false;
      let isLastLineOfStatement = true;
      for (
        let k = lineIndex + 1;
        k < Math.min(lines.length, lineIndex + 6);
        k++
      ) {
        const nextLine = stripInlineComments(lines[k]).trim();
        if (nextLine === "") continue;
        if (
          /^(require|emit|return|}|function|contract|modifier|event|struct|enum)/.test(
            nextLine
          )
        ) {
          break;
        }
        isLastLineOfStatement = false;
        break;
      }
      if (isLastLineOfStatement) {
        for (let j = lineIndex - 1; j >= lookbackLimit; j--) {
          const prev = lines[j];
          const prevNoComment = stripInlineComments(prev).trim();
          if (isCommentOrBlank(prevNoComment)) continue;
          if (
            prevNoComment.endsWith(";") ||
            prevNoComment.endsWith("{") ||
            prevNoComment.endsWith("}")
          )
            break;
          const needsPatterns = [
            /^\s*\w+\s*=\s*[^=]/i,
            /^\s*(require|assert|revert|emit|return)\b/i,
            /^\s*\([^)]*\)\s*=\s*/i,
            /^\s*\w+\.\w+\s*\(/i,
            /^\s*\w+\s*\(/i,
          ];
          if (needsPatterns.some((rx) => rx.test(prevNoComment))) {
            foundStarter = true;
            break;
          }
        }
        if (foundStarter) {
          const idx = getLastCodeCharIndex(line);
          pushFinding(
            lineIndex,
            idx,
            idx + 1,
            "Missing semicolon at end of statement.",
            "MISSING_SEMICOLON",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }

    // Single identifier dangling
    const singleIdentifierPattern = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*$/;
    const standaloneAllowed = new Set([
      "public",
      "private",
      "internal",
      "external",
      "view",
      "pure",
      "payable",
      "virtual",
      "override",
      "immutable",
      "returns",
      "memory",
      "storage",
      "calldata",
    ]);
    if (
      singleIdentifierPattern.test(stripInlineComments(trimmedLine)) &&
      !isCommentOrBlank(trimmedLine)
    ) {
      const trimmedLower = trimmedLine.toLowerCase();
      const shouldSkipSingleIdentifier = (() => {
        if (standaloneAllowed.has(trimmedLower)) {
          // Likely a visibility/modifier line broken across multiple lines.
          return true;
        }
        const prevCodeLine = (() => {
          for (let j = lineIndex - 1; j >= 0; j -= 1) {
            const prev = stripInlineComments(lines[j] ?? "").trim();
            if (prev === "") continue;
            return prev;
          }
          return "";
        })();
        const nextCodeLine = (() => {
          for (let k = lineIndex + 1; k < lines.length; k += 1) {
            const next = stripInlineComments(lines[k] ?? "").trim();
            if (next === "") continue;
            return next;
          }
          return "";
        })();
        if (
          /\b(function|modifier|constructor)\b/i.test(prevCodeLine) ||
          /[){};]$/.test(prevCodeLine) ||
          /^returns\b/i.test(nextCodeLine)
        ) {
          // Previous line already looks like the start of a declaration.
          return true;
        }
        return false;
      })();
      if (!shouldSkipSingleIdentifier) {
        if (
          !/^\s*(function|modifier|event|struct|enum|contract|interface|library|import|pragma|using|constructor)\b/i.test(
            trimmedLine
          )
        ) {
          const idx = getLastCodeCharIndex(line);
          pushFinding(
            lineIndex,
            idx,
            idx + 1,
            "Missing semicolon at end of statement.",
            "MISSING_SEMICOLON",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }
  }

  // 6. MISSING_PARENTHESES (per-line heuristics)
  if (config.missingParentheses) {
    const trimmedLine = line.trim();
    if (trimmedLine !== "") {
      // Control statements must be followed by '('
      const controlRx = /^\s*(if|for|while)\b/;
      const controlMatch = line.match(controlRx);
      if (controlMatch) {
        const kw = controlMatch[1];
        const kwIdx = lineLower.indexOf(kw);
        let j = kwIdx + kw.length;
        while (j < line.length && /\s/.test(line[j])) j += 1;
        const nextCh = line[j] || "";
        const allowMultiLineParen = () => {
          for (
            let k = lineIndex + 1;
            k < Math.min(lines.length, lineIndex + 4);
            k += 1
          ) {
            const nxt = lines[k].trim();
            if (nxt === "") continue;
            return nxt[0] === "(";
          }
          return false;
        };
        if (nextCh !== "(") {
          if (!allowMultiLineParen()) {
            pushFinding(
              lineIndex,
              kwIdx,
              kwIdx + kw.length,
              `Missing parentheses after '${kw}'.`,
              "MISSING_PARENTHESES",
              vscode.DiagnosticSeverity.Error
            );
          }
        }
      }

      // Function-call style without parentheses e.g., `transfer msg.sender;`
      const declOrKeyword =
        /\b(function|contract|interface|library|event|modifier|struct|enum|pragma|import|using)\b/i;
      const stmtKeywordRx =
        /^\s*(return|emit|require|assert|revert|break|continue)\b/i;
      if (!declOrKeyword.test(line) && !stmtKeywordRx.test(line)) {
        const funcCallRx =
          /(^|\s)([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+)([A-Za-z_0-9`"'\[\{])/g;
        let m: RegExpExecArray | null;
        while ((m = funcCallRx.exec(line)) !== null) {
          const name = m[2];
          const nameIdx = m.index + (m[1] ? m[1].length : 0);
          if (isInsideString(nameIdx)) continue;
          const nameLower = name.toLowerCase();
          const after = line.slice(nameIdx + name.length);
          const nextParen = after.indexOf("(");
          const nextSemi = after.indexOf(";");
          if (nextParen >= 0 && (nextSemi === -1 || nextParen < nextSemi)) {
            continue; // has parentheses — OK
          }
          if (CALL_MODIFIER_KEYWORDS.has(nameLower)) continue;
          if (CALL_RESERVED_NAMES.has(nameLower)) continue;
          if (CALL_TYPE_KEYWORDS.has(nameLower)) continue;
          const prefix = line.slice(0, nameIdx);
          if (prefix.indexOf(")") !== -1) continue; // likely declaration tail
          if (
            /^(?:uint\d*|int\d*|address|bool|string|bytes\d*|bytes|mapping)\b/i.test(
              line.trim()
            )
          )
            continue;
          const afterNameTrim = after.trimLeft();
          if (afterNameTrim.startsWith(":") || afterNameTrim.startsWith("="))
            continue;
          const nextTokenMatch = afterNameTrim.match(
            /^([A-Za-z_][A-Za-z0-9_]*)/
          );
          if (nextTokenMatch) {
            const nextWord = nextTokenMatch[1].toLowerCase();
            if (
              CALL_POST_TYPE_KEYWORDS.has(nextWord) ||
              CALL_TYPE_KEYWORDS.has(nextWord)
            ) {
              continue;
            }
          }

          const lineEndsCallish = /[;,)\]}\s]$/.test(line) || /;/.test(line);
          if (lineEndsCallish) {
            // If this is a bare variable or declared identifier usage, skip
            const idName = name.split(".")[0];
            if (declaredIds.has(idName)) {
              continue;
            }
            pushFinding(
              lineIndex,
              nameIdx,
              nameIdx + name.length,
              "Missing parentheses for function call.",
              "MISSING_PARENTHESES",
              vscode.DiagnosticSeverity.Error
            );
          }
        }
      }
    }
  }

  // WRONG_KEYWORDS
  if (config.wrongKeywords) {
    const wrongPatterns: Array<{
      rx: RegExp;
      message: string;
      capture?: number;
    }> = [
      {
        rx: /\b(var\s+)/i,
        message: "Use specific data type instead of 'var'",
        capture: 1,
      },
      {
        rx: /\b(suicide\s*\()/i,
        message: "'suicide' is deprecated, use 'selfdestruct'",
        capture: 1,
      },
    ];
    for (const w of wrongPatterns) {
      const m = line.match(w.rx);
      if (m && m.index !== undefined) {
        const start = m.index;
        const end = start + m[w.capture || 0].length;
        pushFinding(
          lineIndex,
          start,
          end,
          w.message,
          "WRONG_KEYWORD",
          vscode.DiagnosticSeverity.Warning
        );
      }
    }
  }

  // MISSING_DATA_TYPE (declaration and usage tracking)
  if (config.missingDataType) {
    const noComment = stripInlineComments(line);
    try {
      // Remember declared identifiers in typed declarations to avoid false positives later
      const typeKeywordPattern =
        /^(?:.*\b(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping)\b)/i;
      if (
        !/\bfunction\b/i.test(noComment) &&
        typeKeywordPattern.test(noComment)
      ) {
        const normalized = noComment.replace(
          /\b(mapping\s*\([^)]*\))/gi,
          "mapping"
        );
        const tokens = normalized.split(/\s+/).filter(Boolean);
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
        let seenType = false;
        for (let t = 0; t < tokens.length; t += 1) {
          const tok = tokens[t].replace(/[,;{}()]$/g, "");
          if (!seenType) {
            if (
              /^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping)$/i.test(
                tok
              )
            ) {
              seenType = true;
            }
            continue;
          }
          if (modifierKeywords.has(tok.toLowerCase())) continue;
          const parts = tok.split(/[,;]+/).filter(Boolean);
          for (const p of parts) {
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p)) {
              declaredIds.add(p);
            }
          }
        }
      }
    } catch {}

    // 9.1 Untyped assignment at start-of-statement or after ';' or '{'
    const assignRx = /(^(?:\s*)|[;{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    let mAssign: RegExpExecArray | null;
    while ((mAssign = assignRx.exec(noComment)) !== null) {
      const prefix = mAssign[1] || "";
      const name = mAssign[2];
      if (declaredIds.has(name)) {
        if (assignRx.lastIndex === mAssign.index) assignRx.lastIndex += 1;
        continue;
      }
      const nameStart = mAssign.index + prefix.length;
      pushFinding(
        lineIndex,
        nameStart,
        nameStart + name.length,
        "Missing data type declaration for variable.",
        "MISSING_DATA_TYPE",
        vscode.DiagnosticSeverity.Error
      );
      addMissingId(name);
      if (assignRx.lastIndex === mAssign.index) assignRx.lastIndex += 1;
    }

    // 9.1.a Array declaration missing element type: [] a; or [] a = ...
    const arrayDeclRx =
      /(^(?:\s*)|[;{]\s*)(\[\s*\])\s*([A-Za-z_][A-Za-z0-9_]*)\s*(;|=)/g;
    let mArray: RegExpExecArray | null;
    while ((mArray = arrayDeclRx.exec(noComment)) !== null) {
      const prefix = mArray[1] || "";
      const bracket = mArray[2];
      const bracketStart = mArray.index + prefix.length;
      pushFinding(
        lineIndex,
        bracketStart,
        bracketStart + bracket.length,
        "Missing data type declaration for variable.",
        "MISSING_DATA_TYPE",
        vscode.DiagnosticSeverity.Error
      );
      if (arrayDeclRx.lastIndex === mArray.index) arrayDeclRx.lastIndex += 1;
    }

    // 9.1.b Tuple assignment untyped identifiers: (a, ...) = ...
    const tuple = noComment.match(/\(([^)]*)\)\s*=/);
    if (tuple && tuple.index !== undefined) {
      const inside = tuple[1];
      const tupleStart = noComment.indexOf(inside);
      const parts = inside.split(",");
      let cursor = tupleStart;
      for (const rawPart of parts) {
        const part = rawPart;
        const trimmed = part.trim();
        if (trimmed === "") {
          cursor += part.length + 1;
          continue;
        }
        const startsWithType =
          /^(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)\b/i.test(
            trimmed
          );
        if (!startsWithType) {
          const idMatch = part.match(/[A-Za-z_][A-Za-z0-9_]*/);
          if (idMatch && idMatch.index !== undefined) {
            const startCol = cursor + idMatch.index;
            pushFinding(
              lineIndex,
              startCol,
              startCol + idMatch[0].length,
              "Missing data type declaration for variable.",
              "MISSING_DATA_TYPE",
              vscode.DiagnosticSeverity.Error
            );
            addMissingId(idMatch[0]);
          }
        }
        cursor += part.length + 1;
      }
    }

    // 9.1.c Declaration ending with ';' without '=' and without type
    const semiDecl = noComment.match(
      /^\s*(public|private|internal|external)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/
    );
    if (semiDecl && semiDecl.index !== undefined) {
      const hasType =
        /(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+)/i.test(
          noComment
        );
      if (!hasType) {
        const name = semiDecl[2];
        const reservedBareKeywords = new Set([
          "return",
          "break",
          "continue",
          "emit",
          "require",
          "assert",
          "revert",
          "_",
        ]);
        if (!reservedBareKeywords.has(name.toLowerCase())) {
          const nameIdx = noComment.indexOf(name);
          if (nameIdx >= 0) {
            pushFinding(
              lineIndex,
              nameIdx,
              nameIdx + name.length,
              "Missing data type declaration for variable.",
              "MISSING_DATA_TYPE",
              vscode.DiagnosticSeverity.Error
            );
            addMissingId(name);
          }
        }
      }
    }

    // 9.2 Function parameter list checks (single-line heuristics)
    const funcSig = noComment.match(/\bfunction\b[^\{]*\(([^)]*)\)/);
    if (funcSig && funcSig.index !== undefined) {
      const paramsStr = funcSig[1];
      let cursor = noComment.indexOf(paramsStr);
      const params = paramsStr.split(",");
      for (const p of params) {
        const raw = p;
        const param = p.trim();
        if (param === "") {
          cursor += raw.length + 1;
          continue;
        }
        const arrParamStarts =
          /^\s*\[\s*\]\s*(?:memory|calldata|storage)?\s*[A-Za-z_][A-Za-z0-9_]*/i.test(
            param
          );
        if (arrParamStarts) {
          const leading = raw.match(/^\s*/)?.[0].length ?? 0;
          const bracketRel = raw.slice(leading).indexOf("[");
          if (bracketRel >= 0) {
            const bracketStart = cursor + leading + bracketRel;
            pushFinding(
              lineIndex,
              bracketStart,
              bracketStart + 2,
              "Missing data type declaration for variable.",
              "MISSING_DATA_TYPE",
              vscode.DiagnosticSeverity.Error
            );
            cursor += raw.length + 1;
            continue;
          }
        }
        const startsWithType =
          /^(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)\b/i.test(
            param
          );
        if (!startsWithType) {
          const idMatch = raw.match(/[A-Za-z_][A-Za-z0-9_]*/);
          if (idMatch && idMatch.index !== undefined) {
            const startCol = cursor + idMatch.index;
            const len = idMatch[0].length;
            pushFinding(
              lineIndex,
              startCol,
              startCol + len,
              "Missing data type declaration for variable.",
              "MISSING_DATA_TYPE",
              vscode.DiagnosticSeverity.Error
            );
            addMissingId(idMatch[0]);
          }
        }
        cursor += raw.length + 1;
      }

      // 9.2.c Ensure identifiers without types between commas
      const reUntypedParam = /(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=,|$)/g;
      let mUntyped: RegExpExecArray | null;
      while ((mUntyped = reUntypedParam.exec(paramsStr)) !== null) {
        const ident = mUntyped[1];
        const segStart = mUntyped.index;
        const segEnd = reUntypedParam.lastIndex;
        const segment = paramsStr.slice(segStart, segEnd);
        const hasTypeInSeg =
          /(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)/i.test(
            segment
          );
        if (!hasTypeInSeg) {
          const absIdx =
            noComment.indexOf(paramsStr) + segStart + segment.indexOf(ident);
          pushFinding(
            lineIndex,
            absIdx,
            absIdx + ident.length,
            "Missing data type declaration for variable.",
            "MISSING_DATA_TYPE",
            vscode.DiagnosticSeverity.Error
          );
        }
        if (reUntypedParam.lastIndex === mUntyped.index)
          reUntypedParam.lastIndex += 1;
      }

      // 9.2.d Tail parameter without type before ')'
      const tail = paramsStr.match(/,\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (tail && tail.index !== undefined) {
        const segStart = tail.index;
        const segment = paramsStr.slice(segStart);
        const hasTypeInSeg =
          /(uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+|calldata|memory|storage)/i.test(
            segment
          );
        if (!hasTypeInSeg) {
          const ident = tail[1];
          const absIdx =
            noComment.indexOf(paramsStr) + segStart + segment.indexOf(ident);
          pushFinding(
            lineIndex,
            absIdx,
            absIdx + ident.length,
            "Missing data type declaration for variable.",
            "MISSING_DATA_TYPE",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }

    // 9.2.b Global scan within current parameter list for empty array element type
    const funcLine = noComment;
    const parenStart = funcLine.indexOf("(");
    const parenEnd = funcLine.indexOf(")", parenStart + 1);
    if (parenStart >= 0 && parenEnd > parenStart) {
      const inside = funcLine.slice(parenStart + 1, parenEnd);
      const baseIndex = parenStart + 1;
      const reEmptyArrayParam =
        /\[\s*\]\s*(?:memory|calldata|storage)?\s*[A-Za-z_][A-Za-z0-9_]*/g;
      let mArr: RegExpExecArray | null;
      while ((mArr = reEmptyArrayParam.exec(inside)) !== null) {
        const firstBracketRel = mArr[0].indexOf("[");
        const relIdx = mArr.index + firstBracketRel;
        // Check previous non-space to avoid typed arrays like string[]
        let k = relIdx - 1;
        while (k >= 0 && /\s/.test(inside[k])) k -= 1;
        const prevChar = k >= 0 ? inside[k] : "";
        const prevIsTyped = /[A-Za-z0-9_\]]/.test(prevChar);
        if (prevIsTyped) {
          if (reEmptyArrayParam.lastIndex === mArr.index)
            reEmptyArrayParam.lastIndex += 1;
          continue;
        }
        const absIdx = baseIndex + relIdx;
        pushFinding(
          lineIndex,
          absIdx,
          absIdx + 2,
          "Missing data type declaration for variable.",
          "MISSING_DATA_TYPE",
          vscode.DiagnosticSeverity.Error
        );
        if (reEmptyArrayParam.lastIndex === mArr.index)
          reEmptyArrayParam.lastIndex += 1;
      }
    }

    // 9.x Usage of previously marked untyped identifiers
    if (missingIds.size > 0) {
      if (!/[A-Za-z_]/.test(noComment)) {
        return;
      }
      for (const id of Array.from(missingIds)) {
        if (RESERVED_MISSING_TYPE_KEYWORDS.has(id.toLowerCase())) continue;
        const rx = new RegExp(`\\b${id}\\b`);
        const mUse = noComment.match(rx);
        if (mUse && mUse.index !== undefined) {
          const start = mUse.index;
          pushFinding(
            lineIndex,
            start,
            start + id.length,
            "Missing data type declaration for variable.",
            "MISSING_DATA_TYPE",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }
  }
}

// Global braces check using a simple stack
export function runBracesGlobal(
  lines: string[],
  pushFinding: PushFinding
): void {
  const stack: { line: number; col: number }[] = [];
  let extraClosingReported = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === "{") stack.push({ line: i, col: j });
      else if (char === "}") {
        if (stack.length === 0) {
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

// Global parentheses analysis, combining AST expression_statement pass and character-level matching
export function runParenthesesGlobal(
  content: string,
  tree: any,
  commentRanges: Array<[number, number]>,
  ignoredRanges: Array<[number, number]>,
  stringRanges: Array<[number, number]>,
  declaredIdentifiers: Set<string>,
  pushFinding: PushFinding
): void {
  // AST-based expression statements likely missing parentheses
  if (tree) {
    try {
      const isInsideIgnored = (sidx: number, eidx: number) =>
        ignoredRanges.some(([s, e]) => sidx >= s && eidx <= e);
      const walkExprs = (node: any) => {
        if (!node) return;
        if (String(node.type) === "expression_statement") {
          const expr = node.namedChildren && node.namedChildren[0];
          if (expr) {
            const exprType = String(expr.type);
            if (
              (exprType === "identifier" || exprType === "member_expression") &&
              expr.type !== "call_expression"
            ) {
              const text = content.slice(expr.startIndex, expr.endIndex).trim();
              const idName = text.split(/\.|\s/)[0];
              if (
                idName &&
                /^[A-Za-z_][A-Za-z0-9_]*$/.test(idName) &&
                !declaredIdentifiers.has(idName) &&
                !isInsideIgnored(expr.startIndex, expr.endIndex)
              ) {
                const pos = expr.startPosition || { row: 0, column: 0 };
                pushFinding(
                  pos.row,
                  pos.column,
                  pos.column + idName.length,
                  "Missing parentheses for function call.",
                  "MISSING_PARENTHESES",
                  vscode.DiagnosticSeverity.Error
                );
              }
            }
          }
        }
        const kids = node.namedChildren || node.children || [];
        for (const c of kids) walkExprs(c);
      };
      walkExprs(tree.rootNode);
    } catch {}
  }

  // Character-level pass across whole file for unmatched parens and missing '(' after keywords
  const parenStack: { line: number; col: number; idx: number }[] = [];
  let lineIdx = 0;
  let colIdx = 0;
  const text = content;
  const contentLines = content.split(/\r?\n/);
  for (let p = 0; p < text.length; p += 1) {
    const ch = text[p];
    const inComment = commentRanges.some(([s, e]) => p >= s && p < e);
    const inString = stringRanges.some(([s, e]) => p >= s && p < e);
    if (inComment || inString) {
      if (ch === "\n") {
        lineIdx += 1;
        colIdx = 0;
      } else {
        colIdx += 1;
      }
      continue;
    }
    if (ch === "\n") {
      lineIdx += 1;
      colIdx = 0;
      continue;
    }
    if (ch === "(") {
      parenStack.push({ line: lineIdx, col: colIdx, idx: p });
    } else if (ch === ")") {
      if (parenStack.length === 0) {
        const inIgnored = ignoredRanges.some(([s, e]) => p >= s && p < e);
        const currentLine = contentLines[lineIdx] || "";
        const callKeywords = /\b(require|assert|revert|emit)\b/gi;
        let lastMatch: RegExpExecArray | null = null;
        let mTmp: RegExpExecArray | null;
        while ((mTmp = callKeywords.exec(currentLine)) !== null) {
          if (mTmp.index < colIdx) lastMatch = mTmp;
          else break;
        }
        if (!inIgnored && lastMatch) {
          const kwStart = lastMatch.index;
          const kwName =
            lastMatch[1] || currentLine.slice(kwStart).split(/\s+/)[0];
          const kwEnd = kwStart + kwName.length;
          const between = currentLine.slice(kwEnd, colIdx);
          if (between.indexOf("(") === -1) {
            pushFinding(
              lineIdx,
              kwStart,
              kwEnd,
              `Missing opening parenthesis after '${kwName}'.`,
              "MISSING_PARENTHESES",
              vscode.DiagnosticSeverity.Error
            );
          } else {
            pushFinding(
              lineIdx,
              colIdx,
              colIdx + 1,
              "Extra closing parenthesis.",
              "MISSING_PARENTHESES",
              vscode.DiagnosticSeverity.Error
            );
          }
        } else if (!inIgnored) {
          pushFinding(
            lineIdx,
            colIdx,
            colIdx + 1,
            "Extra closing parenthesis.",
            "MISSING_PARENTHESES",
            vscode.DiagnosticSeverity.Error
          );
        }
      } else {
        parenStack.pop();
      }
    }
    colIdx += 1;
  }
  if (parenStack.length > 0) {
    const last = parenStack[parenStack.length - 1];
    const inIgnoredOpen = ignoredRanges.some(
      ([s, e]) => last.idx >= s && last.idx < e
    );
    if (!inIgnoredOpen) {
      pushFinding(
        last.line,
        last.col,
        last.col + 1,
        "Missing closing parenthesis.",
        "MISSING_PARENTHESES",
        vscode.DiagnosticSeverity.Error
      );
    }
  }
}

// AST-based return detection for functions with returns(...) but no return statement
export function runMissingReturnAst(
  content: string,
  tree: any,
  pushFinding: PushFinding
): void {
  if (!tree) return;
  try {
    const indexToLineCol = (idx: number) => {
      const before = content.slice(0, idx).split(/\r?\n/);
      const line = before.length - 1;
      const column = before[before.length - 1]?.length ?? 0;
      return { line, column };
    };
    const hasReturnInNode = (node: any): boolean => {
      if (!node) return false;
      if (node.type === "return_statement") return true;
      const kids = node.namedChildren || node.children || [];
      for (const c of kids) {
        if (hasReturnInNode(c)) return true;
      }
      return false;
    };
    const getReturnParametersNode = (fnNode: any): any | undefined => {
      if (typeof fnNode.childForFieldName === "function") {
        const explicit = fnNode.childForFieldName("return_parameters");
        if (explicit) return explicit;
      }
      const kids = fnNode.namedChildren || fnNode.children || [];
      return kids.find((c: any) => String(c.type) === "return_parameters");
    };
    const extractReturnNames = (
      returnParamsNode: any | undefined
    ): string[] => {
      if (!returnParamsNode) return [];
      const nodeText = content.slice(
        returnParamsNode.startIndex,
        returnParamsNode.endIndex
      );
      const match = nodeText.match(/\(([^)]*)\)/);
      if (!match) return [];
      const inner = match[1];
      return inner
        .split(",")
        .map((seg) => seg.trim())
        .filter(Boolean)
        .map((seg) => {
          const parts = seg.split(/\s+/);
          const candidate = parts[parts.length - 1];
          return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) ? candidate : "";
        })
        .filter(Boolean);
    };
    const findBodyNode = (fnNode: any): any | undefined => {
      const kids = fnNode.namedChildren || fnNode.children || [];
      return kids.find((c: any) => {
        const t = String(c.type);
        return t === "function_body" || t === "block";
      });
    };
    const conditionalContainers = new Set([
      "if_statement",
      "while_statement",
      "do_statement",
      "conditional_expression",
      "switch_statement",
      "case_clause",
      "default_clause",
      "try_statement",
      "catch_clause",
    ]);
    const recordAssignments = (
      node: any,
      insideConditional: boolean,
      returnNames: Set<string>,
      unconditional: Set<string>
    ) => {
      if (!node) return;
      const t = String(node.type);
      const isConditional = conditionalContainers.has(t);
      if (t === "assignment_expression") {
        const leftNode =
          typeof node.childForFieldName === "function"
            ? node.childForFieldName("left")
            : node.namedChildren && node.namedChildren[0];
        if (leftNode) {
          const leftText = content.slice(
            leftNode.startIndex,
            leftNode.endIndex
          );
          const trimmed = leftText.trim();
          if (returnNames.has(trimmed) && !insideConditional) {
            unconditional.add(trimmed);
          }
        }
      }
      const kids = node.namedChildren || node.children || [];
      const nextInside = insideConditional || isConditional;
      for (const c of kids) {
        recordAssignments(c, nextInside, returnNames, unconditional);
      }
    };
    const walk = (node: any) => {
      if (!node) return;
      if (
        node.type === "function_definition" ||
        node.type === "function_declaration"
      ) {
        const nodeText = content.slice(node.startIndex, node.endIndex);
        const returnParamsNode = getReturnParametersNode(node);
        if (returnParamsNode) {
          if (!hasReturnInNode(node)) {
            const bodyNode = findBodyNode(node);
            if (!bodyNode) {
              // Function declaration without body (e.g., interface or abstract contract).
              return;
            } else {
              const returnNames = extractReturnNames(returnParamsNode);
              let shouldReport = true;
              if (returnNames.length > 0) {
                const returnSet = new Set(returnNames);
                const unconditionalAssignments = new Set<string>();
                recordAssignments(
                  bodyNode,
                  false,
                  returnSet,
                  unconditionalAssignments
                );
                const allCovered = returnNames.every((name) =>
                  unconditionalAssignments.has(name)
                );
                if (allCovered) {
                  shouldReport = false;
                }
              }
              if (shouldReport) {
                const highlight = (() => {
                  if (returnParamsNode) {
                    return {
                      start: returnParamsNode.startIndex,
                      end: returnParamsNode.endIndex,
                    };
                  }
                  const nameMatch = nodeText.match(
                    /\bfunction\b\s+([A-Za-z_][A-Za-z0-9_]*)/
                  );
                  if (nameMatch && nameMatch[1]) {
                    const nameIdx = nodeText.indexOf(
                      nameMatch[1],
                      nameMatch.index
                    );
                    if (nameIdx >= 0) {
                      const start = node.startIndex + nameIdx;
                      return {
                        start,
                        end: start + nameMatch[1].length,
                      };
                    }
                  }
                  return {
                    start: node.startIndex,
                    end: node.startIndex + 1,
                  };
                })();
                const startPos = indexToLineCol(highlight.start);
                const endPos = indexToLineCol(highlight.end);
                if (startPos.line === endPos.line) {
                  pushFinding(
                    startPos.line,
                    startPos.column,
                    endPos.column,
                    "Missing return statement in function with return type.",
                    "MISSING_RETURN",
                    vscode.DiagnosticSeverity.Error
                  );
                } else {
                  const pos = node.startPosition || { row: 0, column: 0 };
                  pushFinding(
                    pos.row,
                    pos.column,
                    pos.column + 1,
                    "Missing return statement in function with return type.",
                    "MISSING_RETURN",
                    vscode.DiagnosticSeverity.Error
                  );
                }
              }
            }
          }
        }
      }
      const kids = node.namedChildren || node.children || [];
      for (const c of kids) walk(c);
    };
    walk(tree.rootNode);
  } catch {}
}
