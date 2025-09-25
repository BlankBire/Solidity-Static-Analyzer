Solidity Static Analyzer (VS Code Extension)

Phát hiện cảnh báo phân tích mã tĩnh cho hợp đồng Solidity ngay khi người dùng gõ.

Tính năng

- Cảnh báo dùng `tx.origin`: `tx.origin` có thể bị lợi dụng khi user gọi qua một contract trung gian dẫn tới mất quyền kiểm soát.
- Cảnh báo gọi `selfdestruct`/`suicide`: `selfdestruct`/`suicide` sẽ xoá toàn bộ code contract khỏi blockchain, gửi toàn bộ Ether còn lại trong contract tới recipient, địa chỉ contract vẫn tồn tại nhưng trở thành “trống rỗng” dẫn tới rủi ro mất toàn bộ tài sản.
- Cảnh báo dùng `delegatecall(...)`: Khi dùng `delegatecall`, biến trong contract gọi có thể bị ghi đè bởi logic của contract bị gọi, nếu hai contract không có layout storage giống hệt nhau thì dữ liệu bị phá.
- Nhắc nhở low-level `.call{ value: ... }(...)` hoặc `.call.value(...)(...)`: Khi gửi ETH bằng `.call{value: ...}`, code của recipient sẽ được thực thi ngay (qua fallback/receive), nếu contract nhận là độc hại, nó có thể gọi lại vào contract gửi trước khi trạng thái được cập nhật. Ngoài ra, `.call` còn không giới hạn gas.
- Tự chạy khi mở/sửa/lưu file `.sol`.

Phát triển (Development)

- npm install
- npm run compile
- Nhấn F5 trong VS Code để chạy Extension Development Host

Cấu hình (settings.json)

- solidityStaticAnalyzer.enable: boolean (bật/tắt extension).
- solidityStaticAnalyzer.rules.txOrigin | selfdestruct | delegatecall | lowLevelCallValue: boolean (bật/tắt từng rule).
- solidityStaticAnalyzer.maxProblems: number (giới hạn số vấn đề mỗi file).

Đóng gói (Packaging)

- npm install -g @vscode/vsce
- vsce package

Giới hạn hiện tại

- Chỉ kiểm tra theo heuristic cơ bản, nên dùng thêm các công cụ chuyên sâu trong CI để phân tích bảo mật toàn diện.
