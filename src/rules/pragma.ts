import * as vscode from "vscode";

export interface PragmaRuleConfig {
  missingLicense: boolean;
  missingVersion: boolean;
}

/**
 * Chạy các quy tắc liên quan đến pragma: SPDX license và phiên bản solidity.
 * Hoạt động trên nội dung gốc (giữ nguyên comment).
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
  // SPDX license: kiểm tra ~10 dòng đầu tiên xem có comment chứa SPDX-License-Identifier không
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
        "Thiếu SPDX-License-Identifier. Hãy thêm định danh giấy phép ở đầu tệp (ví dụ: // SPDX-License-Identifier: MIT).",
        "MISSING_LICENSE",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }

  // pragma solidity version: quét ~20 dòng không phải comment đầu tiên để tìm `pragma solidity`
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
        "Thiếu pragma solidity version. Hãy thêm khai báo phiên bản ở đầu tệp (ví dụ: pragma solidity ^0.8.0;).",
        "MISSING_VERSION",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }
}
