# Nội dung cần chủ sản phẩm phê duyệt trước khi mở cho người dùng thật

Trạng thái cập nhật 2026-11-24: **CHỦ SẢN PHẨM ĐÃ DUYỆT NỘI DUNG CONSENT VÀ BƯỚC TỐI THIỂU HÓA TRONG CHAT** và yêu cầu ký. Hai bản đã được ký/xác minh Ed25519, hiệu lực đến 2027-02-22, nằm trong bộ cấu hình ngoài Git dưới thư mục `.vera-match-production` của người vận hành. Khóa ký mới được tạo theo ủy quyền này; không có khẳng định xác minh danh tính pháp lý bên ngoài. File candidate trong repository vẫn là bản tham chiếu chưa ký; không tự kích hoạt publication trên một máy chủ.

Phạm vi được duyệt không bao gồm thời hạn retention/purge cuối cùng, quy trình tối thiểu hóa định danh sau cửa sổ trạng thái, hoặc xác minh hạ tầng đã triển khai. Người vận hành cho biết tự đứng tên và phục vụ cả tiếng Việt/tiếng Anh; đã cung cấp email công khai về dữ liệu: **buiquynhhuong2101@gmail.com**. Email này đã được thêm vào footer của ứng dụng. Không tự suy đoán tên pháp lý từ địa chỉ email.

## Consent

Nội dung chính xác bằng tiếng Việt và tiếng Anh nằm trong `consent-policy.candidate.json` cùng thư mục. Mỗi mục có SHA-256 để nội dung được phê duyệt phải trùng với nội dung hiển thị cho thành viên. Năm mục luôn tùy chọn riêng biệt, tắt mặc định: ghép đôi từ hồ sơ, lưu video, chuyên gia xem video, chia sẻ các nhận định đã chọn, và dùng các nhận định được chọn để ghép đôi. Việc đồng ý lại không làm sống lại quyền cũ. Không sử dụng video để tự động suy luận tính cách.

Phê duyệt trong chat đã được áp dụng đúng nguyên văn các mục và đúng phiên bản. Bản candidate không tự cho phép ứng dụng nhận consent thật; người vận hành phải cài bộ cấu hình đã ký với khóa công khai đáng tin trên host. Mỗi thành viên vẫn phải tự lựa chọn các consent của mình.

## Xử lý khi đóng tài khoản

Bản `closure-policy.candidate.json` chỉ phê duyệt bước tối thiểu hóa dưới đây, không phê duyệt xóa hoàn toàn:

1. Chặn tài khoản, thu hồi phiên đăng nhập/token và tất cả consent ngay khi yêu cầu hợp lệ được nhận.
2. Video được tombstone, hủy phân công còn hiệu lực và dọn trên storage bằng worker có kiểm chứng. Chờ hết hạn các khả năng upload đã cấp; không nói rằng việc xóa là tức thì.
3. Sau khi có bằng chứng dọn media và không còn báo cáo/tranh chấp đang mở: xóa hồ sơ, sở thích, câu trả lời bảng hỏi và tên hiển thị; tăng revision để dữ liệu/quyền cũ không được dùng lại. Vô hiệu hóa các cặp ghép cũ và xóa score/reasons có thể thay đổi.
4. Xóa nội dung review nháp chưa gửi và các quan sát/claim nháp tương ứng. Lịch sử quyết định, review đã gửi, tranh chấp, báo cáo an toàn, block và bằng chứng bất biến được giữ với quyền hạn chế, chờ chính sách retention được phê duyệt. Không tạo lịch sử thu hồi staff giả và không tự bỏ block.
5. Chỉ ghi receipt cho phần thực sự đã đối soát. Chuyển sang `RETENTION_PENDING`, không có trạng thái hoặc tuyên bố “đã xóa sạch”. Báo cáo/tranh chấp đang mở giữ tác vụ ở trạng thái chờ.
6. Email đã xác minh hiện được dùng cho kênh xem trạng thái trong 30 ngày theo quyết định sản phẩm hiện có. Việc tối thiểu hóa email/định danh sau đó và purge cuối cùng cần quy trình đã được phê duyệt; phần này chưa được tự động bật.

## Các quyết định retention còn bắt buộc

Không có thời hạn pháp lý mặc định nào được tác nhân tự gán. Trước khi phát hành thật, người có thẩm quyền phải chốt:

- Tên pháp nhân/người vận hành, địa chỉ liên hệ về dữ liệu và phạm vi thị trường áp dụng.
- Mục đích/cơ sở và thời hạn giữ cho từng nhóm: định danh/email, báo cáo an toàn và tranh chấp, bằng chứng consent/QA/matching, nhật ký vận hành, journal độc lập và backup.
- Người có quyền đặt/gỡ legal hold, cách xử lý yêu cầu xóa và khiếu nại, quy trình tối thiểu hóa sau cửa sổ trạng thái 30 ngày.
- Khi nào backup hết vòng đời, cách xác minh purge, xử lý object version/history và nhà cung cấp; không chỉ kiểm tra object hiện tại.

Các quyết định này là điều kiện để triển khai purge cuối cùng và duyệt phát hành. Chữ ký cho bước tối thiểu hóa không thay thế quyết định retention và không tự chứng minh tuân thủ pháp luật.

## Hạ tầng cần tài khoản thật

Cần nơi chạy API/web/PostgreSQL, một journal độc lập không phục hồi cùng backup ứng dụng, DNS/TLS, SMTP gửi email thật và storage riêng tư. Bộ source có script sinh cấu hình/key, service systemd, nginx, hướng dẫn cài đặt và bài kiểm tra; không có tài khoản dịch vụ trả phí hoặc máy chủ thật được mua/tạo. Chỉ mua tên miền chưa cung cấp các tài nguyên này.

## Cách phê duyệt

Sau khi nội dung và các quyết định trên được chốt, chủ sản phẩm cung cấp reference phê duyệt/cơ sở xử lý, ngày hiệu lực/hết hạn, rồi dùng khóa Ed25519 do người vận hành giữ ngoài API để ký đúng candidate. Các giá trị null/`REVIEW_REQUIRED`, bản nháp, chữ ký sai hoặc hết hạn đều bị từ chối. Không đưa private key hoặc mật khẩu vào chat/Git.
