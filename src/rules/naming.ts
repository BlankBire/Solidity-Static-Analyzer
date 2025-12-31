import * as vscode from "vscode";

export interface NamingConfig {
  functionPattern: string; // mã nguồn regex
  variablePattern: string; // mã nguồn regex
  constantPattern: string; // mã nguồn regex
  contractPattern: string; // mã nguồn regex
}

export interface NamingRuleToggles {
  functionNaming: boolean;
  variableNaming: boolean;
  contractNaming: boolean;
}

type PushFinding = (
  lineIndex: number,
  start: number,
  end: number,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity
) => void;

const stripInline = (s: string) => s.split("//")[0];
const tryRegex = (src?: string) => {
  if (!src) return undefined;
  try {
    return new RegExp(src);
  } catch {
    return undefined;
  }
};

const baseTypeTokens = new Set([
  "address",
  "bool",
  "string",
  "byte",
  "bytes",
  "var",
]);
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
const isTypeToken = (token: string): boolean => {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (lower !== token) return false;
  if (baseTypeTokens.has(lower)) return true;
  if (/^u?int\d*$/.test(lower)) return true;
  if (/^bytes\d*$/.test(lower)) return true;
  if (lower === "mapping" || lower === "struct" || lower === "enum") {
    return true;
  }
  return false;
};

export function runNamingRulesSingleLine(
  line: string,
  lineIndex: number,
  naming: NamingConfig | undefined,
  toggles: NamingRuleToggles,
  pushFinding: PushFinding,
  lines?: string[],
  paramLineSet?: Set<number>,
  commentRanges?: Array<[number, number]>,
  lineStartIndices?: number[]
) {
  if (!naming) return;

  // FUNCTION_NAMING
  if (toggles.functionNaming) {
    const lineClean = stripInline(line);
    const mFunc = lineClean.match(/\bfunction\b([^\(]*)\(/);
    if (mFunc && mFunc.index !== undefined) {
      const seg = mFunc[1];
      const segTrimmed = seg.trim();
      if (segTrimmed !== "") {
        const segStart = mFunc.index + mFunc[0].indexOf(seg);
        const leadingWs = (seg.match(/^\s*/) || [""])[0].length;
        const firstIdx = leadingWs;
        const firstAbs = segStart + firstIdx;
        const firstCh = seg[firstIdx];
        if (!firstCh || !/[A-Za-z_]/.test(firstCh)) {
          pushFinding(
            lineIndex,
            firstAbs,
            firstAbs + 1,
            "Tên hàm không hợp lệ.",
            "FUNCTION_NAMING",
            vscode.DiagnosticSeverity.Error
          );
        } else {
          const idMatch = seg.slice(firstIdx).match(/^[A-Za-z_][A-Za-z0-9_]*/);
          const name = idMatch ? idMatch[0] : "";
          const nameStart = firstAbs;
          const nameEnd = nameStart + name.length;
          const rest = seg.slice(firstIdx + name.length);
          if (/[^\s]/.test(rest)) {
            pushFinding(
              lineIndex,
              nameStart,
              nameEnd,
              "Tên hàm không hợp lệ.",
              "FUNCTION_NAMING",
              vscode.DiagnosticSeverity.Error
            );
          } else {
            const fnRegex = tryRegex(naming.functionPattern);
            if (fnRegex && !fnRegex.test(name)) {
              pushFinding(
                lineIndex,
                nameStart,
                nameEnd,
                `Tên hàm '${name}' không đúng quy tắc.`,
                "FUNCTION_NAMING",
                vscode.DiagnosticSeverity.Error
              );
            }
          }
        }
      }
    }
  }

  // VARIABLE_NAMING
  if (toggles.variableNaming) {
    const original = stripInline(line);
    const decl = original.trim();
    const firstTokenMatch = decl.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    const firstToken = firstTokenMatch ? firstTokenMatch[0] : "";
    const startsWithType = isTypeToken(firstToken);
    const isFunctionLine = /^\s*function\b/i.test(decl);
    // Sử dụng paramLineSet từ AST (nếu có) để xác định ngữ cảnh danh sách tham số
    let isInsideFunctionParams = !!(
      paramLineSet && paramLineSet.has(lineIndex)
    );
    // Fallback sang heuristic văn bản khi không có thông tin AST
    if (!isInsideFunctionParams) {
      try {
        if (lines && lineIndex >= 0) {
          for (let bi = Math.max(0, lineIndex - 50); bi <= lineIndex; bi++) {
            const l = lines[bi] || "";
            if (/\bfunction\b/.test(l)) {
              let balance = 0;
              for (let k = bi; k <= lineIndex; k++) {
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
    const isEventOrOther =
      /^\s*(contract|interface|library|event|modifier|enum|struct)\b/i.test(
        decl
      );
    if (isInsideFunctionParams) return;
    if (startsWithType && !isFunctionLine && !isEventOrOther) {
      const normalized = decl.replace(/\b(mapping\s*\([^)]*\))/gi, "mapping");
      const tokens = normalized.split(/\s+/).filter(Boolean);
      let identifier: string | undefined;
      let identifierStart = -1;
      let identifierTokenIndex = -1;
      for (let t = 1; t < tokens.length; t++) {
        const tok = tokens[t];
        const isModifier = modifierKeywords.has(tok.toLowerCase());
        const isArray = /\[.*\]$/.test(tok);
        // Skip known modifier tokens (e.g., `memory`, `public`) and stray commas
        if (isModifier) continue;
        if (tok === ",") continue;
        // If the current line is inside a block comment, skip naming checks
        if (commentRanges && lineStartIndices) {
          const start = lineStartIndices[lineIndex] ?? 0;
          const end =
            lineIndex + 1 < lineStartIndices.length
              ? lineStartIndices[lineIndex + 1] - 1
              : undefined;
          for (const [cs, ce] of commentRanges) {
            if (
              (end === undefined && cs <= start) ||
              (end !== undefined && cs <= end && ce >= start)
            ) {
              return;
            }
          }
        }
        const base = tok.replace(/[;={].*$/, "").trim();
        // Only accept tokens that look like identifiers (skip operators like '+' '-' '*', numbers, parens, etc.)
        if (!/^[A-Za-z_][A-Za-z0-9_]*;?$/.test(base)) continue;
        if (base.length > 0) {
          identifier = base;
          identifierStart = original.indexOf(tok);
          identifierTokenIndex = t;
          break;
        }
      }
      if (identifier && identifierStart >= 0) {
        const nextTok = tokens[identifierTokenIndex + 1];
        const nextIsArray = nextTok ? /\[.*\]$/.test(nextTok) : false;
        const nextIsModifier = nextTok
          ? modifierKeywords.has(nextTok.toLowerCase())
          : false;
        const nextLooksIdentifier = nextTok
          ? /^[A-Za-z_][A-Za-z0-9_]*;?$/.test(nextTok)
          : false;
        if (nextTok && !nextIsArray && !nextIsModifier && nextLooksIdentifier) {
          pushFinding(
            lineIndex,
            identifierStart,
            identifierStart + identifier.length,
            "Tên biến không hợp lệ.",
            "VARIABLE_NAMING",
            vscode.DiagnosticSeverity.Error
          );
        } else {
          const identifierEnd = identifierStart + identifier.length;
          const isConstant = /\b(constant|immutable)\b/i.test(decl);
          const varRegex = tryRegex(
            isConstant ? naming.constantPattern : naming.variablePattern
          );
          if (varRegex && !varRegex.test(identifier)) {
            pushFinding(
              lineIndex,
              identifierStart,
              identifierEnd,
              `Tên biến '${identifier}' không đúng quy tắc.`,
              "VARIABLE_NAMING",
              vscode.DiagnosticSeverity.Error
            );
          }
        }
      }
    }
  }

  // CONTRACT_NAMING
  if (toggles.contractNaming) {
    const decl = stripInline(line);
    const m = decl.match(/\b(contract|interface|library)\b([^\{]*)\{/);
    if (m && m.index !== undefined) {
      const seg = m[2];
      const segTrim = seg.trim();
      const braceIdx = decl.indexOf("{", m.index);
      const baseStart = m.index + m[0].indexOf(seg);
      if (segTrim === "") {
        const reportCol = braceIdx >= 0 ? braceIdx : baseStart;
        pushFinding(
          lineIndex,
          reportCol,
          reportCol + 1,
          "Tên contract/interface/library không hợp lệ.",
          "CONTRACT_NAMING",
          vscode.DiagnosticSeverity.Error
        );
      } else {
        const name = segTrim.split(/\s+/)[0];
        const nameRelIdx = seg.indexOf(name);
        const nameStart = baseStart + (nameRelIdx >= 0 ? nameRelIdx : 0);
        const nameEnd = nameStart + name.length;
        if (!/[A-Za-z_]/.test(name[0] || "")) {
          pushFinding(
            lineIndex,
            nameStart,
            nameStart + 1,
            "Tên contract/interface/library không hợp lệ.",
            "CONTRACT_NAMING",
            vscode.DiagnosticSeverity.Error
          );
        } else {
          const rest = segTrim.slice(name.length).trim();
          if (rest && !/^is\b/i.test(rest)) {
            pushFinding(
              lineIndex,
              nameStart,
              nameEnd,
              "Tên contract/interface/library không hợp lệ.",
              "CONTRACT_NAMING",
              vscode.DiagnosticSeverity.Error
            );
          } else {
            const rx = tryRegex(naming.contractPattern);
            if (rx && !rx.test(name)) {
              pushFinding(
                lineIndex,
                nameStart,
                nameEnd,
                `Tên '${name}' không đúng quy tắc.`,
                "CONTRACT_NAMING",
                vscode.DiagnosticSeverity.Error
              );
            }
          }
        }
      }
    }
  }
}
