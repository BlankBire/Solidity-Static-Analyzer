"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runNamingRulesSingleLine = runNamingRulesSingleLine;
const vscode = __importStar(require("vscode"));
const stripInline = (s) => s.split("//")[0];
const tryRegex = (src) => {
    if (!src)
        return undefined;
    try {
        return new RegExp(src);
    }
    catch {
        return undefined;
    }
};
function runNamingRulesSingleLine(line, lineIndex, naming, toggles, pushFinding) {
    if (!naming)
        return;
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
                    pushFinding(lineIndex, firstAbs, firstAbs + 1, "Invalid function identifier.", "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
                }
                else {
                    const idMatch = seg.slice(firstIdx).match(/^[A-Za-z_][A-Za-z0-9_]*/);
                    const name = idMatch ? idMatch[0] : "";
                    const nameStart = firstAbs;
                    const nameEnd = nameStart + name.length;
                    const rest = seg.slice(firstIdx + name.length);
                    if (/[^\s]/.test(rest)) {
                        pushFinding(lineIndex, nameStart, nameEnd, "Invalid function identifier.", "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
                    }
                    else {
                        const fnRegex = tryRegex(naming.functionPattern);
                        if (fnRegex && !fnRegex.test(name)) {
                            pushFinding(lineIndex, nameStart, nameEnd, `Invalid function identifier '${name}'.`, "FUNCTION_NAMING", vscode.DiagnosticSeverity.Error);
                        }
                    }
                }
            }
        }
    }
    // VARIABLE_NAMING
    if (toggles.variableNaming) {
        const decl = stripInline(line).trim();
        const startsWithType = /^(?:uint\d*|int\d*|uint|int|address|bool|string|bytes\d*|bytes|mapping\s*\(|struct\s+\w+|enum\s+\w+)/i.test(decl);
        const isFunctionLine = /^\s*function\b/i.test(decl);
        const isEventOrOther = /^\s*(contract|interface|library|event|modifier|enum|struct)\b/i.test(decl);
        if (startsWithType && !isFunctionLine && !isEventOrOther) {
            const normalized = decl.replace(/\b(mapping\s*\([^)]*\))/gi, "mapping");
            const tokens = normalized.split(/\s+/).filter(Boolean);
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
            let identifier;
            let identifierStart = -1;
            let identifierTokenIndex = -1;
            const original = stripInline(line);
            for (let t = 1; t < tokens.length; t++) {
                const tok = tokens[t];
                const isModifier = modifierKeywords.has(tok.toLowerCase());
                const isArray = /\[.*\]$/.test(tok);
                if (!isModifier && !isArray) {
                    const base = tok.replace(/[;={].*$/, "").trim();
                    if (base.length > 0) {
                        identifier = base;
                        identifierStart = original.indexOf(tok);
                        identifierTokenIndex = t;
                        break;
                    }
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
                    pushFinding(lineIndex, identifierStart, identifierStart + identifier.length, "Invalid variable identifier.", "VARIABLE_NAMING", vscode.DiagnosticSeverity.Error);
                }
                else {
                    const identifierEnd = identifierStart + identifier.length;
                    const isConstant = /\b(constant|immutable)\b/i.test(decl);
                    const varRegex = tryRegex(isConstant ? naming.constantPattern : naming.variablePattern);
                    if (varRegex && !varRegex.test(identifier)) {
                        pushFinding(lineIndex, identifierStart, identifierEnd, `Invalid variable identifier '${identifier}'.`, "VARIABLE_NAMING", vscode.DiagnosticSeverity.Error);
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
                pushFinding(lineIndex, reportCol, reportCol + 1, "Invalid contract/interface/library identifier.", "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
            }
            else {
                const name = segTrim.split(/\s+/)[0];
                const nameRelIdx = seg.indexOf(name);
                const nameStart = baseStart + (nameRelIdx >= 0 ? nameRelIdx : 0);
                const nameEnd = nameStart + name.length;
                if (!/[A-Za-z_]/.test(name[0] || "")) {
                    pushFinding(lineIndex, nameStart, nameStart + 1, "Invalid contract/interface/library identifier.", "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
                }
                else {
                    const rest = segTrim.slice(name.length).trim();
                    if (rest && !/^is\b/i.test(rest)) {
                        pushFinding(lineIndex, nameStart, nameEnd, "Invalid contract/interface/library identifier.", "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
                    }
                    else {
                        const rx = tryRegex(naming.contractPattern);
                        if (rx && !rx.test(name)) {
                            pushFinding(lineIndex, nameStart, nameEnd, `Invalid contract/interface/library identifier '${name}'.`, "CONTRACT_NAMING", vscode.DiagnosticSeverity.Error);
                        }
                    }
                }
            }
        }
    }
}
//# sourceMappingURL=naming.js.map