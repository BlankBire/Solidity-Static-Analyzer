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
 * Flags locals, parameters, return variables, and (optionally) state variables that are written but never read.
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

  const lhsContainerTypes = new Set([
    "expression",
    "tuple_expression",
    "parenthesized_expression",
    "member_expression",
    "index_access_expression",
  ]);

  const getNodeText = (node: any): string => {
    if (!node) return "";
    return content.slice(node.startIndex, node.endIndex);
  };

  const findStateVariableNode = (decl: DeclaredDecl): any | undefined => {
    let cur = decl.declNode?.parent;
    while (cur) {
      if (String(cur.type) === "state_variable_declaration") {
        return cur;
      }
      cur = cur.parent;
    }
    return undefined;
  };

  const hasPublicVisibility = (decl: DeclaredDecl): boolean => {
    const stateDecl = findStateVariableNode(decl);
    if (!stateDecl) return false;
    for (const child of stateDecl.namedChildren || []) {
      if (String(child.type) === "visibility") {
        const text = getNodeText(child).trim();
        if (/^public$/i.test(text)) {
          return true;
        }
      }
    }
    const rawText = getNodeText(stateDecl);
    return /\bpublic\b/i.test(rawText);
  };

  const functionLikeNodeTypes = new Set([
    "function_definition",
    "function_declaration",
    "modifier_definition",
    "constructor_definition",
  ]);

  const getEnclosingFunctionLike = (node: any): any | undefined => {
    let current = node?.parent;
    while (current) {
      if (functionLikeNodeTypes.has(String(current.type))) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  };

  const functionHasBody = (fnNode: any | undefined): boolean => {
    if (!fnNode) return false;
    for (const child of fnNode.namedChildren || []) {
      const t = String(child.type);
      if (t === "function_body" || t === "block" || t === "block_statement") {
        return true;
      }
    }
    return false;
  };

  const isWithinSimpleAssignmentLhs = (node: any): boolean => {
    let current = node;
    let parent = node?.parent;
    while (parent) {
      const parentType = String(parent.type);
      if (parentType === "assignment_expression") {
        const named = parent.namedChildren || [];
        const left = named[0];
        if (!left) return false;
        if (current !== left) return false;
        const right = named.length > 1 ? named[1] : undefined;
        const sliceStart = left.endIndex ?? parent.startIndex;
        const sliceEnd = right ? right.startIndex : parent.endIndex;
        const operatorText = content.slice(sliceStart, sliceEnd).trim();
        return operatorText === "=";
      }
      if (!lhsContainerTypes.has(parentType)) {
        break;
      }
      current = parent;
      parent = parent.parent;
    }
    return false;
  };

  const isReturnParameterNode = (node: any): boolean => {
    let current = node?.parent;
    while (current) {
      const type = String(current.type);
      if (
        type === "return_parameter" ||
        type === "return_parameters" ||
        type === "return_parameter_list" ||
        type === "return_type_definition"
      ) {
        return true;
      }
      if (
        /function_definition|function_declaration|modifier_definition|constructor_definition/i.test(
          type
        )
      ) {
        break;
      }
      current = current.parent;
    }
    return false;
  };

  const isFunctionLikeParameterNode = (node: any): boolean => {
    let current = node?.parent;
    let seenParameterList = false;
    while (current) {
      const type = String(current.type);
      if (type === "parameter" || type === "parameter_list") {
        seenParameterList = true;
      }
      if (
        /function_definition|function_declaration|modifier_definition|constructor_definition/i.test(
          type
        )
      ) {
        return seenParameterList;
      }
      if (type === "try_statement") {
        break;
      }
      current = current.parent;
    }
    return false;
  };

  const classifyDecl = (
    decl: DeclaredDecl
  ): "state" | "parameter" | "return" | "local" => {
    if (isStateVariable(decl)) return "state";
    if (isReturnParameterNode(decl.declNode)) return "return";
    if (isFunctionLikeParameterNode(decl.declNode)) return "parameter";
    return "local";
  };

  const buildMessage = (
    kind: "state" | "parameter" | "return" | "local",
    name: string
  ): string => {
    switch (kind) {
      case "state":
        return `State variable '${name}' is never read.`;
      case "parameter":
        return `Function parameter '${name}' is never used.`;
      case "return":
        return `Named return variable '${name}' is never used.`;
      default:
        return `Local variable '${name}' is never read.`;
    }
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
            if (!isWithinSimpleAssignmentLhs(n)) {
              found = true;
              return;
            }
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
    const declKind = classifyDecl(decl);
    if (declKind === "state" && hasPublicVisibility(decl)) {
      continue; // public state variables have implicit getters and should not be flagged
    }
    if (declKind === "return") {
      continue; // named return variables are considered part of the function interface
    }
    if (
      declKind === "parameter" &&
      !functionHasBody(getEnclosingFunctionLike(decl.declNode))
    ) {
      continue; // parameters/returns on declarations without bodies (interfaces/abstract) are not unused
    }
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
        buildMessage(declKind, name),
        "UNUSED_VARIABLE",
        vscode.DiagnosticSeverity.Warning
      );
    }
  }
}
