import * as vscode from "vscode";

type PushFinding = (
  lineIndex: number,
  start: number,
  end: number,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity
) => void;

export interface DeclaredDecl {
  name: string;
  declNode: any;
  scopeNode: any;
  startIndex: number;
  startPosition: any;
  scopeType?: string;
}

/**
 * Report UNUSED_VARIABLE diagnostics using a scope-aware search within each declaration's scope.
 * Skips state variables (declared at contract scope) and identifiers starting with '_'.
 */
export function runUnusedVariables(
  content: string,
  tree: any | undefined,
  declaredDeclarations: DeclaredDecl[],
  pushFinding: PushFinding,
  opts?: { includeStateVariables?: boolean }
): void {
  if (!tree) return; // require AST for precise scope walking
  const isStateVariable = (decl: DeclaredDecl): boolean => {
    try {
      // Walk up from declNode to see if inside a state_variable_declaration; or scope is contract_definition
      let cur = decl.declNode?.parent;
      while (cur) {
        const t = String(cur.type);
        if (t === "state_variable_declaration") return true;
        cur = cur.parent;
      }
    } catch {}
    // Fallback: scope at contract level implies state var
    return String(decl.scopeType || "").toLowerCase() === "contract_definition";
  };

  const findUsageInScope = (
    scopeNode: any,
    name: string,
    declStartIdx: number
  ): boolean => {
    let found = false;
    const walk = (n: any) => {
      if (!n || found) return;
      if (String(n.type) === "identifier") {
        try {
          const nm = content.slice(n.startIndex, n.endIndex);
          if (nm === name && n.startIndex !== declStartIdx) {
            found = true;
            return;
          }
        } catch {}
      }
      const kids = n.namedChildren || n.children || [];
      for (const c of kids) {
        if (found) break;
        walk(c);
      }
    };
    walk(scopeNode);
    return found;
  };

  for (const decl of declaredDeclarations) {
    const name = decl.name;
    if (!name || name.startsWith("_")) continue; // ignore intentionally unused
    if (!opts?.includeStateVariables && isStateVariable(decl)) continue; // optionally ignore state variables
    const used = findUsageInScope(
      decl.scopeNode,
      name,
      decl.declNode.startIndex
    );
    if (!used) {
      // Report at declaration position
      let lineNum = 0;
      let colNum = 0;
      if (decl.startPosition && typeof decl.startPosition.row === "number") {
        lineNum = decl.startPosition.row;
        colNum = decl.startPosition.column;
      } else {
        const before = content.slice(0, decl.startIndex).split(/\r?\n/);
        lineNum = before.length - 1;
        colNum = before[before.length - 1].length;
      }
      pushFinding(
        lineNum,
        colNum,
        colNum + name.length,
        `Declared variable '${name}' is never used.`,
        "UNUSED_VARIABLE",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }
}
