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
 * Áp dụng các quy tắc bảo mật cho một dòng mã nguồn.
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
        "Tránh sử dụng tx.origin để xác thực. Hãy sử dụng msg.sender thay thế.",
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
        "selfdestruct có thể xóa vĩnh viễn mã nguồn hợp đồng. Hãy đảm bảo đây là hành động có chủ đích và có biện pháp kiểm soát quyền truy cập.",
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
        "delegatecall có thể dẫn đến các thay đổi ngữ cảnh không mong muốn. Hãy kiểm tra kỹ mục tiêu và dữ liệu truyền vào.",
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
        "Lời gọi hàm cấp thấp kèm value có thể dẫn đến lỗi reentrancy. Hãy sử dụng mô hình Checks-Effects-Interactions và cân nhắc các hạn chế của .transfer/.send.",
        "LOW_LEVEL_CALL_VALUE",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }
}
