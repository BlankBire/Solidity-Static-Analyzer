import * as vscode from "vscode";

export interface SemanticRuleToggles {
  missingVisibility: boolean;
  unsafeAddressCast: boolean;
  deprecatedThisBalance: boolean;
  legacyConstructor: boolean;
  msgSenderTransfer: boolean;
  lowLevelCallNoData: boolean;
  uncheckedLowLevelCall: boolean;
  legacyFallbackFunction: boolean;
  tryReturnShadowing: boolean;
  unusedTryReturnVariable: boolean;
}

type PushFinding = (
  lineIndex: number,
  start: number,
  end: number,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity
) => void;

const uintWidth = (typeName: string): number | undefined => {
  const match = /^u?int(\d+)?$/i.exec(typeName.trim());
  if (!match) return undefined;
  if (!match[1]) return 256; // plain uint/int defaults to 256 bits
  return parseInt(match[1], 10);
};

const getDescendant = (node: any, predicate: (child: any) => boolean): any => {
  if (!node) return undefined;
  const queue = [...(node.namedChildren || [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (predicate(current)) return current;
    if (current.namedChildren && current.namedChildren.length) {
      queue.push(...current.namedChildren);
    }
  }
  return undefined;
};

const LOW_LEVEL_CALL_NAMES = new Set([
  "call",
  "callcode",
  "delegatecall",
  "staticcall",
]);

const REQUIRE_FUNCTIONS = new Set(["require", "assert"]);

const getNodeText = (content: string, node: any): string => {
  if (!node) return "";
  return content.slice(node.startIndex, node.endIndex);
};

const unwrapExpression = (node: any): any => {
  let current = node;
  while (
    current &&
    current.type === "expression" &&
    current.namedChildren &&
    current.namedChildren.length === 1
  ) {
    current = current.namedChildren[0];
  }
  return current;
};

const unwrapExpressionParents = (node: any): { container: any; inner: any } => {
  let inner = node;
  let parent = inner?.parent;
  while (parent && parent.type === "expression") {
    inner = parent;
    parent = parent.parent;
  }
  return { container: parent, inner };
};

const findAncestorCall = (node: any): any => {
  let current = node?.parent;
  while (current) {
    if (current.type === "call_expression") return current;
    current = current.parent;
  }
  return undefined;
};

export function runSemanticRulesAst(
  content: string,
  tree: any,
  toggles: SemanticRuleToggles,
  pushFinding: PushFinding
): void {
  if (!tree?.rootNode) return;

  const extractVersion = () => {
    const pragmaRegex = /pragma\s+solidity\s+([^;]+)/gi;
    let match: RegExpExecArray | null;
    let best: { major: number; minor: number; patch: number } | undefined;
    while ((match = pragmaRegex.exec(content)) !== null) {
      const segment = match[1] || "";
      const versionMatch = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(segment);
      if (!versionMatch) continue;
      const major = parseInt(versionMatch[1], 10);
      const minor = parseInt(versionMatch[2], 10);
      const patch = versionMatch[3] ? parseInt(versionMatch[3], 10) : 0;
      if (!best) {
        best = { major, minor, patch };
        continue;
      }
      if (major > best.major) {
        best = { major, minor, patch };
        continue;
      }
      if (major === best.major && minor > best.minor) {
        best = { major, minor, patch };
        continue;
      }
      if (major === best.major && minor === best.minor && patch > best.patch) {
        best = { major, minor, patch };
      }
    }
    return best;
  };

  const versionInfo = extractVersion();
  const versionAtLeast = (
    v: { major: number; minor: number; patch: number } | undefined,
    major: number,
    minor: number
  ) => {
    if (!v) return false;
    if (v.major > major) return true;
    if (v.major < major) return false;
    if (v.minor > minor) return true;
    if (v.minor < minor) return false;
    return v.patch >= 0;
  };

  const collectContracts = (): any[] => {
    const result: any[] = [];
    const walk = (node: any) => {
      if (!node) return;
      const type = String(node.type);
      if (type === "contract_declaration" || type === "contract_definition") {
        result.push(node);
      }
      for (const child of node.namedChildren || []) {
        walk(child);
      }
    };
    walk(tree.rootNode);
    return result;
  };
  const contracts = collectContracts();

  const contractStateVariables = new Map<any, Set<string>>();
  for (const contractNode of contracts) {
    const names = new Set<string>();
    const bodyNode = (contractNode.namedChildren || []).find(
      (child: any) => child.type === "contract_body"
    );
    const members = bodyNode?.namedChildren || [];
    for (const member of members) {
      if (member.type === "state_variable_declaration") {
        for (const child of member.namedChildren || []) {
          if (child.type === "identifier") {
            const name = getNodeText(content, child).trim();
            if (name) {
              names.add(name);
            }
          }
        }
      }
    }
    contractStateVariables.set(contractNode, names);
  }

  const functionParamCache = new Map<any, Set<string>>();
  const getFunctionParamNames = (fnNode: any): Set<string> => {
    if (!fnNode) return new Set<string>();
    if (functionParamCache.has(fnNode)) {
      return functionParamCache.get(fnNode)!;
    }
    const paramNames = new Set<string>();
    for (const child of fnNode.namedChildren || []) {
      if (child.type === "parameter") {
        const idNode = (child.namedChildren || []).find(
          (c: any) => c.type === "identifier"
        );
        if (idNode) {
          const name = getNodeText(content, idNode).trim();
          if (name) paramNames.add(name);
        }
      }
    }
    functionParamCache.set(fnNode, paramNames);
    return paramNames;
  };

  const findEnclosingContract = (node: any): any | undefined => {
    let current = node;
    while (current) {
      if (contractStateVariables.has(current)) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  };

  const functionNodeTypes = new Set([
    "function_definition",
    "function_declaration",
    "constructor_definition",
    "modifier_definition",
  ]);

  const findEnclosingFunction = (node: any): any | undefined => {
    let current = node;
    while (current) {
      if (functionNodeTypes.has(String(current.type))) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  };

  const identifierUsedInNode = (node: any, target: string): boolean => {
    if (!node) return false;
    if (node.type === "identifier") {
      const text = getNodeText(content, node).trim();
      if (text === target) {
        return true;
      }
    }
    for (const child of node.namedChildren || []) {
      if (identifierUsedInNode(child, target)) {
        return true;
      }
    }
    return false;
  };

  if (toggles.legacyConstructor) {
    const enforceLegacy =
      versionAtLeast(versionInfo, 0, 5) ||
      (!!versionInfo && versionInfo.major >= 1);
    const shouldWarn = enforceLegacy || !versionInfo;
    const severity = enforceLegacy
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;
    if (shouldWarn) {
      for (const contractNode of contracts) {
        const contractNameNode = (contractNode.namedChildren || []).find(
          (child: any) => child.type === "identifier"
        );
        if (!contractNameNode) continue;
        const contractName = getNodeText(content, contractNameNode).trim();
        if (!contractName) continue;
        const bodyNode = (contractNode.namedChildren || []).find(
          (child: any) => child.type === "contract_body"
        );
        const members = bodyNode?.namedChildren || [];
        for (const member of members) {
          if (member.type !== "function_definition") continue;
          const fnNameNode = (member.namedChildren || []).find(
            (child: any) => child.type === "identifier"
          );
          if (!fnNameNode) continue;
          const fnName = getNodeText(content, fnNameNode).trim();
          if (!fnName) continue;
          if (fnName === contractName) {
            const startPos = fnNameNode.startPosition || member.startPosition;
            pushFinding(
              startPos.row,
              startPos.column,
              fnNameNode.endPosition?.column ?? startPos.column + fnName.length,
              "Hãy thay thế cú pháp constructor cũ bằng từ khóa 'constructor' từ Solidity 0.5+.",
              "LEGACY_CONSTRUCTOR",
              severity
            );
          }
        }
      }
    }
  }

  const visit = (node: any) => {
    if (!node) return;

    if (
      toggles.legacyFallbackFunction &&
      node.type === "fallback_receive_definition"
    ) {
      const snippet = getNodeText(content, node).replace(/^\s+/, "");
      if (/^function\s*\(/i.test(snippet)) {
        const startPos = node.startPosition || { row: 0, column: 0 };
        const severity = versionAtLeast(versionInfo, 0, 6)
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;
        const endColumn = startPos.column + "function".length;
        pushFinding(
          startPos.row,
          startPos.column,
          endColumn,
          "Cú pháp fallback ẩn danh đã lỗi thời. Hãy sử dụng 'fallback() external' hoặc 'receive() external payable' thay vì 'function()'.",
          "LEGACY_FALLBACK_FUNCTION",
          severity
        );
      }
    }

    let callMemberObject: any | undefined;
    let callMemberProperty: any | undefined;
    let callMethodName = "";
    let callArguments: any[] = [];
    if (node.type === "call_expression") {
      const calleeRaw = (node.namedChildren || [])[0];
      const callee = unwrapExpression(calleeRaw);
      if (callee && callee.type === "member_expression") {
        callMemberObject = unwrapExpression(callee.namedChildren?.[0]);
        callMemberProperty = unwrapExpression(callee.namedChildren?.[1]);
        if (callMemberProperty) {
          callMethodName = getNodeText(content, callMemberProperty).trim();
        }
      }
      callArguments = (node.namedChildren || []).filter(
        (child: any) => child.type === "call_argument"
      );
    }

    if (toggles.missingVisibility && node.type === "function_definition") {
      const hasVisibility = (node.namedChildren || []).some((child: any) => {
        const t = String(child.type);
        return t === "visibility" || t === "visibility_specifier";
      });
      if (!hasVisibility) {
        const nameNode = (node.namedChildren || []).find(
          (child: any) => child.type === "identifier"
        );
        const startPos = nameNode?.startPosition || node.startPosition;
        const endPos = nameNode?.endPosition || {
          row: startPos.row,
          column: startPos.column + "function".length,
        };
        pushFinding(
          startPos.row,
          startPos.column,
          endPos.column,
          "Chưa xác định visibility. Bạn có định thêm 'public' không?",
          "MISSING_VISIBILITY",
          vscode.DiagnosticSeverity.Error
        );
      }
    }

    if (toggles.unsafeAddressCast && node.type === "type_cast_expression") {
      const primitive = (node.namedChildren || []).find(
        (child: any) => child.type === "primitive_type"
      );
      if (primitive) {
        const typeText = content.slice(
          primitive.startIndex,
          primitive.endIndex
        );
        const width = uintWidth(typeText);
        if (width !== undefined && width < 160) {
          const callArg = (node.namedChildren || []).find(
            (child: any) => child.type === "call_argument"
          );
          if (callArg) {
            const member = getDescendant(
              callArg,
              (child) => child.type === "member_expression"
            );
            if (member) {
              const objectNode = member.namedChildren?.[0];
              const propertyNode = member.namedChildren?.[1];
              if (objectNode && propertyNode) {
                const objectText = content
                  .slice(objectNode.startIndex, objectNode.endIndex)
                  .trim();
                const propertyText = content
                  .slice(propertyNode.startIndex, propertyNode.endIndex)
                  .trim();
                if (
                  objectNode.type === "identifier" &&
                  objectText === "msg" &&
                  propertyText === "sender"
                ) {
                  const startPos = primitive.startPosition;
                  pushFinding(
                    startPos.row,
                    startPos.column,
                    primitive.endPosition.column,
                    `Chuyển đổi kiểu dữ liệu tường minh từ 'address' sang '${typeText.trim()}' không được phép.`,
                    "UNSAFE_ADDRESS_CAST",
                    vscode.DiagnosticSeverity.Error
                  );
                }
              }
            }
          }
        }
      }
    }

    if (toggles.deprecatedThisBalance && node.type === "member_expression") {
      const objectNode = node.namedChildren?.[0];
      const propertyNode = node.namedChildren?.[1];
      if (objectNode && propertyNode) {
        const objectText = content
          .slice(objectNode.startIndex, objectNode.endIndex)
          .trim();
        const propertyText = content
          .slice(propertyNode.startIndex, propertyNode.endIndex)
          .trim();
        if (
          objectNode.type === "identifier" &&
          objectText === "this" &&
          propertyText === "balance"
        ) {
          const startPos = objectNode.startPosition || node.startPosition;
          const endPos = propertyNode.endPosition || node.endPosition;
          pushFinding(
            startPos.row,
            startPos.column,
            endPos.column,
            "'this.balance' đã lỗi thời. Hãy sử dụng address(this).balance thay thế.",
            "DEPRECATED_THIS_BALANCE",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }

    if (toggles.msgSenderTransfer && node.type === "call_expression") {
      if (
        callMemberObject &&
        callMemberProperty &&
        callMemberObject.type === "member_expression" &&
        /^(transfer|send)$/i.test(callMethodName)
      ) {
        const baseObject = unwrapExpression(
          callMemberObject.namedChildren?.[0]
        );
        const baseProperty = unwrapExpression(
          callMemberObject.namedChildren?.[1]
        );
        if (
          baseObject &&
          baseProperty &&
          baseObject.type === "identifier" &&
          getNodeText(content, baseObject).trim() === "msg" &&
          getNodeText(content, baseProperty).trim() === "sender"
        ) {
          const startPos = baseObject.startPosition || node.startPosition;
          const endPos = callMemberProperty.endPosition || node.endPosition;
          pushFinding(
            startPos.row,
            startPos.column,
            endPos.column,
            "Hãy ép kiểu msg.sender thành payable(msg.sender) trước khi gọi transfer/send.",
            "MSG_SENDER_TRANSFER",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }

    if (node.type === "call_expression") {
      const isLowLevel = LOW_LEVEL_CALL_NAMES.has(callMethodName.toLowerCase());
      if (isLowLevel && callMemberProperty && callMemberObject) {
        if (toggles.lowLevelCallNoData && callArguments.length === 0) {
          const startPos =
            callMemberProperty.startPosition || node.startPosition;
          const endPos = callMemberProperty.endPosition || node.endPosition;
          pushFinding(
            startPos.row,
            startPos.column,
            endPos.column,
            'Lời gọi hàm cấp thấp yêu cầu đối số calldata. Hãy truyền vào bytes payload (sử dụng "" nếu calldata trống).',
            "LOW_LEVEL_CALL_NO_DATA",
            vscode.DiagnosticSeverity.Error
          );
        }

        if (toggles.uncheckedLowLevelCall) {
          const { container } = unwrapExpressionParents(node);
          const parentCall = (() => {
            let curParent = node.parent;
            while (curParent) {
              if (curParent.type === "call_expression" && curParent !== node) {
                return curParent;
              }
              curParent = curParent.parent;
            }
            return undefined;
          })();

          const inAssignment = (() => {
            let current = node.parent;
            while (current) {
              const t = String(current.type);
              if (
                t === "assignment_expression" ||
                t === "variable_declaration_statement" ||
                t === "return_statement"
              ) {
                return true;
              }
              current = current.parent;
            }
            return false;
          })();

          if (!inAssignment && container?.type === "expression_statement") {
            const startPos =
              callMemberProperty.startPosition || node.startPosition;
            const endPos = callMemberProperty.endPosition || node.endPosition;
            pushFinding(
              startPos.row,
              startPos.column,
              endPos.column,
              "Kết quả của lời gọi hàm cấp thấp bị bỏ qua. Hãy thu thập cờ boolean thành công và xử lý lỗi cụ thể.",
              "UNCHECKED_LOW_LEVEL_CALL",
              vscode.DiagnosticSeverity.Error
            );
          } else if (parentCall && container?.type === "call_argument") {
            const parentCalleeRaw = (parentCall.namedChildren || [])[0];
            const parentCallee = unwrapExpression(parentCalleeRaw);
            let parentName = "";
            if (parentCallee?.type === "identifier") {
              parentName = getNodeText(content, parentCallee).trim();
            } else if (parentCallee?.type === "member_expression") {
              const prop = unwrapExpression(parentCallee.namedChildren?.[1]);
              if (prop) parentName = getNodeText(content, prop).trim();
            }
            if (REQUIRE_FUNCTIONS.has(parentName.toLowerCase())) {
              const startPos =
                callMemberProperty.startPosition || node.startPosition;
              const endPos = callMemberProperty.endPosition || node.endPosition;
              pushFinding(
                startPos.row,
                startPos.column,
                endPos.column,
                "Lời gọi hàm cấp thấp trả về (bool success, bytes data); hãy phân tách tuple trước khi truyền vào require/assert.",
                "LOW_LEVEL_CALL_TUPLE",
                vscode.DiagnosticSeverity.Error
              );

              const requireRangeNode = (() => {
                if (!parentCallee) return parentCall;
                if (parentCallee.type === "member_expression") {
                  return (
                    unwrapExpression(parentCallee.namedChildren?.[1]) ||
                    parentCallee
                  );
                }
                return parentCallee;
              })();
              const requireStart =
                requireRangeNode?.startPosition || parentCall.startPosition;
              const requireEnd =
                requireRangeNode?.endPosition || parentCall.endPosition;
              if (requireStart && requireEnd) {
                pushFinding(
                  requireStart.row,
                  requireStart.column,
                  requireEnd.column,
                  "require/assert mong đợi một cờ boolean thành công; hãy phân tách tuple của lời gọi hàm cấp thấp trước khi truyền vào.",
                  "REQUIRE_LOW_LEVEL_CALL_TUPLE",
                  vscode.DiagnosticSeverity.Error
                );
              }
            }
          }
        }
      }
    }

    if (
      node.type === "try_statement" &&
      (toggles.tryReturnShadowing || toggles.unusedTryReturnVariable)
    ) {
      const returnParams = (node.namedChildren || []).filter(
        (child: any) => child.type === "parameter"
      );
      if (returnParams.length > 0) {
        const successBlock = (node.namedChildren || []).find(
          (child: any) => child.type === "block_statement"
        );
        const contractNode = findEnclosingContract(node);
        const contractVars = contractNode
          ? contractStateVariables.get(contractNode) || new Set<string>()
          : new Set<string>();
        const functionNode = findEnclosingFunction(node);
        const fnParamNames = functionNode
          ? getFunctionParamNames(functionNode)
          : new Set<string>();

        for (const paramNode of returnParams) {
          const idNode = (paramNode.namedChildren || []).find(
            (c: any) => c.type === "identifier"
          );
          if (!idNode) continue;
          const name = getNodeText(content, idNode).trim();
          if (!name) continue;

          if (toggles.tryReturnShadowing) {
            let shadowTarget = "";
            if (fnParamNames.has(name)) {
              shadowTarget = "function parameter";
            } else if (contractVars.has(name)) {
              shadowTarget = "state variable";
            }
            if (shadowTarget) {
              pushFinding(
                idNode.startPosition.row,
                idNode.startPosition.column,
                idNode.endPosition.column,
                `Biến binding '${name}' trong try returns bị trùng tên với một ${shadowTarget}. Hãy đổi tên biến try returns để tránh gây nhầm lẫn.`,
                "TRY_RETURN_SHADOWING",
                vscode.DiagnosticSeverity.Warning
              );
            }
          }

          if (toggles.unusedTryReturnVariable) {
            if (name.startsWith("_")) {
              continue;
            }
            const isUsed = successBlock
              ? identifierUsedInNode(successBlock, name)
              : false;
            if (!isUsed) {
              pushFinding(
                idNode.startPosition.row,
                idNode.startPosition.column,
                idNode.endPosition.column,
                `Biến binding '${name}' trong try returns chưa bao giờ được đọc trong thành công block. Hãy xóa nó hoặc sử dụng giá trị này bên trong try block.`,
                "UNUSED_TRY_RETURN",
                vscode.DiagnosticSeverity.Warning
              );
            }
          }
        }
      }
    }

    for (const child of node.namedChildren || []) {
      visit(child);
    }
  };

  visit(tree.rootNode);
}
