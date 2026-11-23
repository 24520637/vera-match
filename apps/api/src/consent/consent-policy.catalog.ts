import type { ConsentPurpose } from "@prisma/client";

/** Product wording finalized by Huong. Publication still requires real external approval. */
export const candidatePolicyVersion = "2026-11-23.v1";
export const candidateNotices: Readonly<Record<ConsentPurpose, Readonly<Record<"en" | "vi", string>>>> = {
  "PROFILE_MATCHING": {
    "en": "I allow VERA Match to use my eligible profile, preferences and questionnaire answers to suggest matches and process my matching choices. This is optional. Turning it off stops new matching authorization; previously recorded decisions may be retained with restricted access under the retention policy.",
    "vi": "Tôi cho phép VERA Match dùng hồ sơ đủ điều kiện, sở thích và câu trả lời bảng hỏi của tôi để gợi ý kết nối và xử lý lựa chọn kết nối. Đây là lựa chọn không bắt buộc. Khi tắt, hệ thống ngừng cấp quyền kết nối mới; bằng chứng lựa chọn đã ghi có thể được giữ với quyền truy cập hạn chế theo chính sách lưu trữ."
  },
  "VIDEO_STORAGE": {
    "en": "I allow VERA Match to store my private video and provide authorized private playback. This does not make it public. Turning this off stops new API access and starts verified cleanup. Links already issued may work until their short expiry; deletion is not instant and retained evidence or backups follow the retention policy.",
    "vi": "Tôi cho phép VERA Match lưu video riêng tư và cung cấp phát lại khi có quyền hợp lệ. Video không trở thành công khai. Khi tắt, hệ thống ngừng cấp quyền truy cập API mới và bắt đầu dọn dẹp có xác minh. Liên kết đã cấp có thể dùng đến lúc hết hạn ngắn; việc xóa không tức thì và bằng chứng hoặc bản sao lưu được giữ theo chính sách lưu trữ."
  },
  "EXPERT_VIDEO_REVIEW": {
    "en": "I allow an assigned, authorized expert to review my private video and authorized quality reviewers to check that review. This does not authorize personality inference or public sharing. Turning it off stops new review access and cancels eligible assignments; restricted historical evidence may remain under the retention policy.",
    "vi": "Tôi cho phép chuyên gia được phân công và có quyền hợp lệ đánh giá video riêng tư, cùng người kiểm tra chất lượng có quyền kiểm tra đánh giá đó. Việc này không cho phép suy đoán tính cách hoặc chia sẻ công khai. Khi tắt, hệ thống ngừng cấp quyền đánh giá mới và hủy các phân công còn đủ điều kiện; bằng chứng lịch sử có thể được giữ với quyền hạn chế theo chính sách lưu trữ."
  },
  "REPORT_SHARING": {
    "en": "I allow only factual claims from my reviewed report that I separately confirm and choose to share to be shown in supported matching features. My full report and video are not published by this choice. I can turn this off to stop future sharing; restricted historical evidence may remain.",
    "vi": "Tôi chỉ cho phép những thông tin thực tế từ báo cáo đã kiểm tra mà tôi xác nhận riêng và chủ động chia sẻ được hiển thị trong tính năng kết nối được hỗ trợ. Lựa chọn này không công khai toàn bộ báo cáo hoặc video. Tôi có thể tắt để ngừng chia sẻ về sau; bằng chứng lịch sử có thể được giữ với quyền hạn chế."
  },
  "VIDEO_CLAIM_MATCHING": {
    "en": "I allow my separately confirmed and shared factual video claims to be used for supported matching reasons. Profile matching and selected-report sharing must also be enabled. Turning this off removes future claim-based matching authorization without changing an independent profile-matching choice.",
    "vi": "Tôi cho phép các thông tin thực tế từ video mà tôi đã xác nhận và chia sẻ riêng được dùng làm lý do kết nối được hỗ trợ. Kết nối bằng hồ sơ và chia sẻ thông tin từ báo cáo cũng phải được bật. Khi tắt, hệ thống ngừng cấp quyền kết nối dựa trên thông tin video, không thay đổi lựa chọn kết nối bằng hồ sơ độc lập."
  }
};
export const policyDependencies: Readonly<Record<ConsentPurpose, readonly ConsentPurpose[]>> = {
  "PROFILE_MATCHING": [],
  "VIDEO_STORAGE": [],
  "EXPERT_VIDEO_REVIEW": [
    "VIDEO_STORAGE"
  ],
  "REPORT_SHARING": [
    "VIDEO_STORAGE",
    "EXPERT_VIDEO_REVIEW"
  ],
  "VIDEO_CLAIM_MATCHING": [
    "PROFILE_MATCHING",
    "VIDEO_STORAGE",
    "EXPERT_VIDEO_REVIEW",
    "REPORT_SHARING"
  ]
};
