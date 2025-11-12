import * as vscode from "vscode";

export interface SecurityRuleConfig {
  txOrigin: boolean;
  selfdestruct: boolean;
  delegatecall: boolean;
  lowLevelCallValue: boolean;
}

type PushFinding = (
  lineIndex: number,
  start: number,
  end: number,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity
) => void;

/**
 * Apply security-related rules for a single source line.
 */
export function runSecurityRulesSingleLine(
  line: string,
  lineLower: string,
  lineIndex: number,
  rules: SecurityRuleConfig,
  pushFinding: PushFinding
): void {
  // 1. TX_ORIGIN
  if (rules.txOrigin) {
    const idx = lineLower.indexOf("tx.origin");
    if (idx !== -1) {
      pushFinding(
        lineIndex,
        idx,
        idx + "tx.origin".length,
        "Avoid using tx.origin for authorization. Use msg.sender instead.",
        "TX_ORIGIN",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }

  // 2. SELFDESTRUCT / suicide
  if (rules.selfdestruct) {
    const m = line.match(/(selfdestruct|suicide)\s*\(/i);
    if (m && m.index !== undefined) {
      const idx = m.index;
      pushFinding(
        lineIndex,
        idx,
        idx + m[1].length,
        "selfdestruct can permanently remove contract code. Ensure this is intended and access controlled.",
        "SELFDESTRUCT",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }

  // 3. DELEGATECALL
  if (rules.delegatecall) {
    const m = line.match(/\.delegatecall\s*\(/i);
    if (m && m.index !== undefined) {
      const idx = m.index + 1; // skip '.'
      pushFinding(
        lineIndex,
        idx,
        idx + "delegatecall".length,
        "delegatecall can lead to unexpected context changes. Validate target and data.",
        "DELEGATECALL",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }

  // 4. LOW_LEVEL_CALL with value
  if (rules.lowLevelCallValue) {
    const m =
      line.match(/\.call\s*\{\s*value\s*:\s*/i) ||
      line.match(/\.call\.value\s*\(/i);
    if (m && m.index !== undefined) {
      const idx = m.index + 1; // skip '.'
      const token = m[0].toLowerCase().includes("call.value")
        ? "call.value"
        : "call{value:";
      pushFinding(
        lineIndex,
        idx,
        idx + token.length,
        "Low-level call with value can introduce reentrancy. Use Checks-Effects-Interactions and consider .transfer/.send limitations.",
        "LOW_LEVEL_CALL_VALUE",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }
}
