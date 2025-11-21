import * as vscode from "vscode";

export interface SemanticRuleToggles {
  missingVisibility: boolean;
  unsafeAddressCast: boolean;
  deprecatedThisBalance: boolean;
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

export function runSemanticRulesAst(
  content: string,
  tree: any,
  toggles: SemanticRuleToggles,
  pushFinding: PushFinding
): void {
  if (!tree?.rootNode) return;

  const visit = (node: any) => {
    if (!node) return;

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
          "No visibility specified. Did you intend to add 'public'?",
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
                    `Explicit type conversion from 'address' to '${typeText.trim()}' is disallowed.`,
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
            "'this.balance' is deprecated. Use address(this).balance instead.",
            "DEPRECATED_THIS_BALANCE",
            vscode.DiagnosticSeverity.Error
          );
        }
      }
    }

    for (const child of node.namedChildren || []) {
      visit(child);
    }
  };

  visit(tree.rootNode);
}
