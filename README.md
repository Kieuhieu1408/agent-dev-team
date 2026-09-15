# h-dev-agent (AutoDevGraph)

**h-dev-agent** (với CLI command `h-claude`) là một hệ thống Multi-Agent đột phá được xây dựng trên nền tảng LangGraph và Node.js. 

Hệ thống mô phỏng một **Team Dev ảo** (Product Owner, Solution Architect, Developer, Tester) có khả năng tự động hóa vòng đời phát triển phần mềm. Điểm khác biệt lớn nhất là các Agent thực thi công việc thông qua một **Terminal ảo (PTY)** để điều khiển trực tiếp `claude CLI`, thay vì ghi file mã nguồn một cách "mù quáng".

## 🚀 Tính năng nổi bật

*   **Đội ngũ AI Đa năng (Multi-Agent):** Điều phối các vai trò chuyên biệt (PO, SA, Dev, Tester) bằng LangGraph.
*   **Trí nhớ qua Tài liệu (Artifact-driven):** Quản lý tiến độ bằng các file `tasks/*.md` và `MASTER_PLAN.json`, loại bỏ tình trạng tràn ngữ cảnh (context bloat) và ảo giác (hallucination) thường thấy ở RAG.
*   **Mô phỏng Người dùng (PTY Execution):** Agent thao tác trên terminal bằng lệnh `claude` y hệt một lập trình viên con người, tự đọc log lỗi và tự sửa sai (ReAct).
*   **An toàn & Kiểm soát (HITL):** Tích hợp Semantic Guardrails. Tự động tạm dừng và xin phép người dùng qua Terminal UI nếu Agent định chạy các lệnh rủi ro cao.
*   **Khả năng tự phục hồi (Self-healing):** Tự động đổi LLM Provider nếu gặp lỗi kết nối hoặc rate limit.

## 📦 Cài đặt (Setup)

1. Clone dự án:
```bash
git clone https://github.com/Kieuhieu1408/h-dev-agent.git
cd h-dev-agent
```

2. Cài đặt thư viện:
```bash
npm install
```

3. Cấu hình biến môi trường:
Tạo file `.env` ở thư mục gốc và điền API Key của bạn (Sử dụng 9router hoặc OpenAI/Anthropic):
```env
LLM_PROVIDER_URL=https://9router.com/v1
LLM_API_KEY=sk-...
```

## 💻 Cách sử dụng

1. Build và liên kết lệnh toàn cục:
```bash
npm run build
npm link
```

2. Sử dụng ở bất kỳ đâu trên máy tính của bạn:
Di chuyển vào thư mục dự án bạn muốn code và gõ:
```bash
h-claude
```
Giao diện Chat (TUI) sẽ hiện ra, bạn chỉ cần mô tả ý tưởng, Team Dev Agent sẽ tự động lên kế hoạch và viết code cho bạn!
