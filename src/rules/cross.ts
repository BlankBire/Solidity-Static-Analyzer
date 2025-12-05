import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

type PushFinding = (
  lineIndex: number,
  start: number,
  end: number,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity
) => void;

/**
 * Resolve imports referenced in a file and merge exported top-level names
 * (contracts, libraries, interfaces) into `declaredIdentifiers` so
 * other single-file heuristics don't produce false positives.
 * Also reports a diagnostic when an imported file path cannot be found.
 */
export function runCrossFileChecks(
  content: string,
  filePath: string | undefined,
  declaredIdentifiers: Set<string>,
  declaredDeclarations: Array<any>,
  pushFinding: PushFinding
): void {
  if (!filePath) return;
  try {
    // match: import "./A.sol";  OR import * as X from "./A.sol"; OR import {A as B} from './A.sol';
    const importRx = /import\s+(?:[^;]*?from\s+)?(?:"|')([^"']+)(?:"|')\s*;/g;
    let m: RegExpExecArray | null;
    const baseDir = path.dirname(filePath);
    while ((m = importRx.exec(content)) !== null) {
      const importPath = m[1];
      const importAbs = path.resolve(baseDir, importPath);
      if (!fs.existsSync(importAbs)) {
        // locate line/col for the import occurrence
        const before = content.slice(0, m.index);
        const line = before.split(/\r?\n/).length - 1;
        const col = m.index - before.lastIndexOf("\n") - 1;
        pushFinding(
          line,
          col,
          col + Math.min(importPath.length + 7, 80),
          `Source '${importAbs}' not found: File import not resolved.`,
          "IMPORT_NOT_FOUND",
          vscode.DiagnosticSeverity.Error
        );
        continue;
      }

      // parse imported file and collect top-level names (library, contract, interface)
      try {
        const txt = fs.readFileSync(importAbs, "utf8");
        // quick heuristic parse: look for `library|contract|interface|enum|struct` followed by identifier
        const topRx =
          /\b(library|contract|interface|enum|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
        let t: RegExpExecArray | null;
        while ((t = topRx.exec(txt)) !== null) {
          const name = t[2];
          if (name) declaredIdentifiers.add(name);
          // mark as imported to avoid unused-variable reports
          declaredDeclarations.push({
            name,
            declNode: {
              startIndex: t.index,
              startPosition: { row: 0, column: 0 },
            },
            scopeNode: { type: String(t[1]) },
            startIndex: t.index,
            startPosition: { row: 0, column: 0 },
            scopeType: t[1],
            imported: true,
          });
        }
      } catch (e) {
        // ignore parse errors for imported file
      }
    }
  } catch (e) {
    // fail-safe: do nothing
  }
}
