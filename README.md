# Solidify – Real-Time Solidity Analyzer

Solidify is a Visual Studio Code extension that surfaces static-analysis diagnostics for Solidity smart contracts **while you type**. It combines a high-speed `tree-sitter` parser with targeted regular-expression scans to deliver instant feedback without breaking the developer’s flow.

## Feature Highlights

- **Security heuristics**: Guards against high-impact pitfalls such as `tx.origin`, unsafe `delegatecall`, `selfdestruct`, low-level value transfers, and risky address downcasts.
- **Syntax & quality rules**: Spots missing semicolons/braces, deprecated keywords, unreachable returns, missing `payable`, unused variables, and missing visibility specifiers.
- **Semantic safeguards**: Alerts on `uint32(msg.sender)`-style casts and legacy `this.balance`, recommending safer Solidity 0.8+ patterns.
- **Real-time experience**: Automatically re-analyzes whenever a `.sol` document opens, changes, or saves.
- **Modular rule engine**: Rules in `src/rules/` are isolated, making it easy to extend or tune individual checks.

## Getting Started

1. **Clone & open**
   ```bash
   git clone https://github.com/BlankBire/Solidity-Static-Analyzer.git
   code solidity-static-analyzer
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Compile TypeScript**
   ```bash
   npm run compile
   ```
4. **Launch the extension sandbox**
   Press `F5` in VS Code to open an Extension Development Host with Solidify preloaded.

## Usage

- Open any Solidity file (`*.sol`) inside the Extension Development Host. Diagnostics appear as squiggles, in the Problems panel, and via hover tooltips.
- Quick filtering: Use the Problems panel (`Ctrl+Shift+M`) to filter diagnostics by severity or rule ID.
- To disable or fine-tune rules, edit your user/workspace `settings.json` (see below).

## Configuration Options

| Setting                                              | Type    | Description                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `solidityStaticAnalyzer.enable`                      | boolean | Master toggle for the extension.                                                                                                                                                                                                           |
| `solidityStaticAnalyzer.maxProblems`                 | number  | Per-file diagnostic cap (default: 100).                                                                                                                                                                                                    |
| `solidityStaticAnalyzer.rules.txOrigin` etc.         | boolean | Enable/disable individual security rules (`txOrigin`, `selfdestruct`, `delegatecall`, `lowLevelCallValue`).                                                                                                                                |
| `solidityStaticAnalyzer.rules.missingSemicolon` etc. | boolean | Enable/disable syntax & quality rules (`missingParentheses`, `missingBraces`, `missingReturn`, `wrongKeywords`, `missingDataType`, `missingPayable`, `missingVisibility`, `unsafeAddressCast`, `deprecatedThisBalance`, `unusedVariable`). |

## Architecture Snapshot

Solidify follows a five-layer architecture:

1. **VS Code Integration** – `extension.ts` registers document listeners and debounces rapid edits.
2. **Core Analysis Engine** – `solidityAnalyzer.ts` orchestrates pipelines, caching, and rule coordination.
3. **AST/CFG Processing** – `tree-sitter` builds incremental ASTs and lightweight control-flow views.
4. **Enhanced Rules Engine** – Modular rule packs (`src/rules/*.ts`) consume structured context to emit findings.
5. **Advanced Diagnostic Display** – Diagnostics are normalized and pushed into VS Code collections for highlights, Problems view, and (future) quick fixes.

Refer to `paper/paper.md` for a detailed discussion and diagrams.

## Evaluation Summary

| Metric          | Solidify (Ours) | Slither (Baseline) |
| --------------- | --------------- | ------------------ |
| Latency (avg)   | 82 ± 15 ms      | ~ 2.5 s            |
| Precision       | 0.61            | 0.91               |
| Recall          | 0.59            | 0.94               |
| F1 Score        | 0.60            | 0.92               |
| False Positives | 39%             | 9%                 |

Solidify prioritizes responsiveness inside the IDE; Slither remains the go-to tool for deep whole-program analysis.

## Repository Layout

- `src/` – Extension entry point and modular rule implementations.
- `test/` – Solidity contracts used for regression coverage.
- `bin/test/` – Precompiled `solc` artifacts (ABI, bytecode, JSON) consumed during testing.
- `paper/` – Academic-style writeup describing design, architecture, and evaluation.
- `poster/` – Poster assets highlighting the project overview.
- `scripts/` – Utility and demo scripts.
- `out/` – Compiled JavaScript emitted by `npm run compile`.

## Development Workflow

- Run `npm run compile -- --watch` to rebuild on file changes.
- Use VS Code’s “Run and Debug” pane to relaunch the Extension Development Host quickly.
- Add new rule modules under `src/rules/` and export a `Rule` implementation; register it in `solidityAnalyzer.ts`.
- Keep fixtures up to date with `solc` outputs under `bin/test/` for deterministic testing.

## Packaging & Distribution

1. Install the VS Code packaging CLI: `npm install -g @vscode/vsce`
2. Bump version fields in `package.json`
3. Build the extension bundle: `vsce package`
4. Publish or sideload the resulting `.vsix`

## Limitations & Roadmap

- Focuses on heuristics and local analysis; it does not replace comprehensive audits or symbolic execution.
- Cross-contract reasoning and path-sensitive dataflow are currently out of scope.
- Planned enhancements: richer quick fixes, configurable severity thresholds, caching for large workspaces, and advanced vulnerability signatures.

## Contributing

Issues and pull requests are welcome. Please open an issue describing the rule, bug, or enhancement you propose so we can discuss scope before implementation.

---

© 2025 Solidify contributors. Distributed under the repository’s LICENSE (see root for details).
