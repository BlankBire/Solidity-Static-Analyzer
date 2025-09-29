Solidity Static Analyzer (VS Code Extension)

Phát hiện cảnh báo phân tích mã tĩnh cho hợp đồng Solidity ngay khi người dùng gõ.

Tính năng

## Bảo mật (Security Rules)
- Cảnh báo dùng `tx.origin`: `tx.origin` có thể bị lợi dụng khi user gọi qua một contract trung gian dẫn tới mất quyền kiểm soát.
- Cảnh báo gọi `selfdestruct`/`suicide`: `selfdestruct`/`suicide` sẽ xoá toàn bộ code contract khỏi blockchain, gửi toàn bộ Ether còn lại trong contract tới recipient, địa chỉ contract vẫn tồn tại nhưng trở thành "trống rỗng" dẫn tới rủi ro mất toàn bộ tài sản.
- Cảnh báo dùng `delegatecall(...)`: Khi dùng `delegatecall`, biến trong contract gọi có thể bị ghi đè bởi logic của contract bị gọi, nếu hai contract không có layout storage giống hệt nhau thì dữ liệu bị phá.
- Nhắc nhở low-level `.call{ value: ... }(...)` hoặc `.call.value(...)(...)`: Khi gửi ETH bằng `.call{value: ...}`, code của recipient sẽ được thực thi ngay (qua fallback/receive), nếu contract nhận là độc hại, nó có thể gọi lại vào contract gửi trước khi trạng thái được cập nhật. Ngoài ra, `.call` còn không giới hạn gas.

## Cú pháp (Syntax Rules)
- **Thiếu dấu chấm phẩy**: Phát hiện các statement thiếu dấu chấm phẩy cuối dòng.
- **Thiếu dấu ngoặc đơn**: Phát hiện function calls thiếu dấu ngoặc đơn.
- **Thiếu dấu ngoặc nhọn**: Phát hiện các control flow statements (if/else/for/while) thiếu dấu ngoặc nhọn.
- **Thiếu return statement**: Phát hiện function có return type nhưng thiếu return statement.
- **Từ khóa sai**: Phát hiện việc sử dụng từ khóa deprecated như `var`, `suicide`.
- **Thiếu kiểu dữ liệu**: Phát hiện khai báo biến thiếu kiểu dữ liệu.
- **Thiếu payable modifier**: Phát hiện function xử lý ETH nhưng thiếu `payable` modifier.

## Tự động
- Tự chạy khi mở/sửa/lưu file `.sol`.

Phát triển (Development)

- Sau khi git clone, tại VS Code nhấn File - Open Folder - chọn thư mục solidity-static-analyzer trong thư mục đã tạo để clone
- npm install
- npm run compile
- Nhấn F5 trong VS Code để chạy Extension Development Host

Cấu hình (settings.json)

- `solidityStaticAnalyzer.enable`: boolean (bật/tắt extension).
- **Security Rules**: `solidityStaticAnalyzer.rules.txOrigin | selfdestruct | delegatecall | lowLevelCallValue`: boolean (bật/tắt từng rule bảo mật).
- **Syntax Rules**: `solidityStaticAnalyzer.rules.missingSemicolon | missingParentheses | missingBraces | missingReturn | wrongKeywords | missingDataType | missingPayable`: boolean (bật/tắt từng rule cú pháp).
- `solidityStaticAnalyzer.maxProblems`: number (giới hạn số vấn đề mỗi file).

Đóng gói (Packaging)

- npm install -g @vscode/vsce
- vsce package

Giới hạn hiện tại

- Chỉ kiểm tra theo heuristic cơ bản, nên dùng thêm các công cụ chuyên sâu trong CI để phân tích bảo mật toàn diện.
