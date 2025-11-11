## Development utility scripts

Các script trong thư mục này giúp bạn phát triển và kiểm thử nhanh bộ phân tích Solidity mà không cần chạy extension trong VS Code.

### File mẫu

- `testSample.sol`: Hợp đồng mẫu tổng hợp nhiều tình huống để kích hoạt các rule: TX_ORIGIN, SELFDESTRUCT, DELEGATECALL, low-level call với value, biến không dùng, trường hợp thiếu `payable`, v.v.

### Script phân tích nhanh

- `runUnusedVariablesDemo.js`: Demo rule UNUSED_VARIABLE (lọc riêng các cảnh báo biến không dùng từ analyzer).

### Demo theo từng rule

- `runTxOriginDemo.js`
- `runSelfdestructDemo.js`
- `runDelegatecallDemo.js`
- `runLowLevelCallDemo.js`
- `runMissingPayableDemo.js`
- `runNamingAndSyntaxDemo.js` (gồm: missing semicolon, missing parentheses, naming, missing data type, v.v.)

### AST helpers

- `dumpAstJson.js`: Sinh file JSON AST (`astDump.json`).
- `astDump.json`: Snapshot mới nhất của AST cho `testSample.sol`.

### Cách chạy nhanh bằng npm scripts

Sau khi build TypeScript:

```powershell
npm run compile

# AST JSON
npm run dev:dumpAstJson

# Analyzer demos
npm run dev:unusedVariables
npm run dev:txOrigin
npm run dev:selfdestruct
npm run dev:delegatecall
npm run dev:lowLevelCall
npm run dev:missingPayable
npm run dev:namingSyntax
```

### Tạo / cập nhật astDump.json

Chạy:

```powershell
npm run dev:dumpAstJson
```

File `scripts/astDump.json` chứa cây AST (Tree-sitter) dạng JSON tuần tự hóa, thuận tiện cho kiểm thử và diff.

> Lưu ý: Các script này không được đóng gói vào extension khi publish (chỉ dành cho phát triển nội bộ).
