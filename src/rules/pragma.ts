import * as vscode from "vscode";

export interface PragmaRuleConfig {
  missingLicense: boolean;
  missingVersion: boolean;
}

/**
 * Run pragma-related rules: SPDX license header and pragma solidity version.
 * This operates on the original content (comments preserved).
 */
export function runPragmaRules(
  content: string,
  rules: PragmaRuleConfig,
  pushFinding: (
    lineIndex: number,
    start: number,
    end: number,
    message: string,
    code: string,
    severity: vscode.DiagnosticSeverity
  ) => void
): void {
  // SPDX license: check first ~10 lines for comment markers containing SPDX-License-Identifier
  if (rules.missingLicense) {
    const originalLines = content.split(/\r?\n/);
    let hasLicense = false;
    for (let i = 0; i < Math.min(10, originalLines.length); i++) {
      const line = originalLines[i].trim();
      if (
        /^\/\/\s*SPDX-License-Identifier\s*:/.test(line) ||
        /^\/\*\s*SPDX-License-Identifier\s*:/.test(line)
      ) {
        hasLicense = true;
        break;
      }
    }
    if (!hasLicense) {
      pushFinding(
        0,
        0,
        1,
        "Missing SPDX-License-Identifier. Add a license identifier at the top of the file (e.g., // SPDX-License-Identifier: MIT).",
        "MISSING_LICENSE",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }

  // pragma solidity version: scan first ~20 non-comment lines for `pragma solidity`
  if (rules.missingVersion) {
    const originalLines = content.split(/\r?\n/);
    let hasVersion = false;
    for (let i = 0; i < Math.min(20, originalLines.length); i++) {
      const line = originalLines[i];
      const noCommentLine = line.split("//")[0].trim();
      if (/^pragma\s+solidity\s+/.test(noCommentLine)) {
        hasVersion = true;
        break;
      }
    }
    if (!hasVersion) {
      pushFinding(
        0,
        0,
        1,
        "Missing pragma solidity version. Add a version declaration at the top of the file (e.g., pragma solidity ^0.8.0;).",
        "MISSING_VERSION",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }
}
