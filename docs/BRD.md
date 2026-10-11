# Business Requirements Document (BRD) - Dự án agent-dev-team

## 1. Tổng quan dự án (Executive Summary)

**agent-dev-team** là một hệ thống Multi-Agent và Process Orchestrator hoạt động hoàn toàn trên **Terminal**. Hệ thống được xây dựng trên nền tảng LangGraph, Node.js và PTY (Pseudo-Terminal) nhằm giải quyết điểm nghẽn lớn nhất trong việc phát triển phần mềm với AI: **Vòng lặp con người làm cầu nối thủ công (Human Relay Loop)**.

Hiện nay, khi lập trình viên sử dụng AI CLI (như Claude Code):
1. Nhập lệnh trên CLI ➔ AI sinh code.
2. Lập trình viên phải chuyển sang IDE (như IntelliJ, VSCode) để bấm Run / Test.
3. Nếu có lỗi, lập trình viên phải copy log lỗi/stacktrace từ console IDE và paste ngược lại cho AI fix.
4. Quá trình này lặp lại liên tục, gây tiêu tốn thời gian, đứt gãy sự tập trung và biến con người thành một "nhân viên chuyển phát tin nhắn".

**agent-dev-team** loại bỏ hoàn toàn sự can thiệp thủ công này bằng cách:
*   **Quản lý các Terminal độc lập trên máy cá nhân:** Mở và giám sát song song các phiên terminal ngầm (một terminal cho Claude CLI viết code, một terminal độc lập để chạy test/build).
*   **Quản lý trạng thái tập trung (State Management):** Theo dõi toàn bộ vòng đời của task (`IDLE` ➔ `PLANNING` ➔ `DEV_CODING` ➔ `RUNNING_TEST` ➔ `SELF_HEALING` ➔ `DONE`).
*   **Vòng lặp tự sửa lỗi khép kín (Self-Healing Loop):** Tự động bắt exit code và log lỗi từ terminal test, đẩy ngược lại cho Claude CLI tự sửa cho đến khi tất cả các bài test vượt qua.

---

## 2. Yêu cầu chức năng (Functional Requirements - FR)

### FR1. Quản lý trạng thái tác vụ (Centralized State Management)
*   **Mô tả:** Hệ thống phải quản lý trạng thái tập trung của toàn bộ tiến trình thông qua State Machine và lưu trữ trên hệ thống file nội bộ (`.devteam/`).
*   **Chi tiết:**
    *   Lưu trữ metadata và tiến độ trong `MASTER_PLAN.json`.
    *   Từng nhiệm vụ chi tiết được ghi vào các living documents (`.devteam/tasks/task_XXX.md`).
    *   Hệ thống đồ thị (LangGraph) đọc trạng thái để biết chính xác task đang ở bước nào (TODO, IN_PROGRESS, TESTING, BUG_FIXING, DONE) nhằm điều phối luồng mà không làm phình context window của LLM.

### FR2. Quản lý đa Terminal Sub-Agent độc lập (Multi-Terminal Sub-Agent Isolation)
*   **Mô tả:** Hệ thống quản lý hạm đội các phiên terminal (PTY) ngầm chạy song song trên máy cục bộ, điều phối các **Sub-Agent độc lập (Claude Code CLI)** cho từng vai trò chuyên biệt:
*   **Chi tiết:**
    *   **Explorer / Auditor Terminal:** Chạy `claude CLI` ở vai trò Explorer/Auditor, tận dụng toàn bộ công cụ (`ripgrep`, `ast-grep`, `ViewTool`, `BashTool`) của Claude Code để tự động điều tra, đọc hiểu kiến trúc, review coding convention, tìm bug nghiệp vụ và audit bảo mật/concurrency.
    *   **Dev Worker Terminal:** Chạy `claude CLI` ở vai trò Developer, nhận lệnh và chỉnh sửa mã nguồn.
    *   **Test Runner Terminal:** Chạy độc lập các lệnh build/test của dự án (`mvn test`, `gradle test`, `npm test`, `pytest`, `cargo test`...) mà không block terminal của Dev.
    *   **Background Service Terminal (Tuỳ chọn):** Quản lý dev server hoặc file watcher ngầm khi cần.
    *   Các terminal hoạt động độc lập, không xung đột I/O với terminal chính của người dùng.

### FR3. Vòng lặp Tự sửa lỗi Khép kín (Closed-Loop Self-Healing)
*   **Mô tả:** Tự động phát hiện lỗi kiểm thử và điều phối việc sửa lỗi mà không cần người dùng copy/paste log.
*   **Chi tiết:**
    *   Log Parser theo dõi stdout/stderr từ Test Terminal.
    *   Khi phát hiện lỗi (exit code != 0, assertion failure, compilation error):
        *   Trích xuất stacktrace và context của file gây lỗi.
        *   Bắn event lỗi sang State Manager để chuyển trạng thái sang `SELF_HEALING`.
        *   Truyền thông tin lỗi vào Dev Terminal (Claude CLI) để thực hiện sửa đổi mã nguồn.
        *   Sau khi Dev xác nhận đã sửa, tự động kích hoạt Test Terminal chạy lại kiểm thử.
    *   Cơ chế Circuit Breaker: Giới hạn số lần thử lại (ví dụ: tối đa 3-5 lần). Nếu vượt ngưỡng, chuyển sang trạng thái cảnh báo người dùng.

### FR4. Điều phối Đội ngũ Đa Tác tử (Master-Worker Multi-Agent Orchestration)
*   **Mô tả:** Phân chia trách nhiệm rõ ràng theo mô hình **Master Agent (Chỉ huy) ➔ Sub-Agent Fleet (Thực thi)**:
    *   **Master Agent (Supervisor / Orchestrator):** Duy trì bộ nhớ ngữ cảnh hội thoại đa lượt, phân loại ý định, làm việc trực tiếp với con người (HITL) và chỉ đạo các Sub-Agent terminal.
    *   **Explorer & Security Auditor (Claude Code CLI Sub-Agent):** Tự động bung công cụ CLI khảo sát dự án, phát hiện lỗi race condition, idempotency, exception swallowing và sai lệch tiền.
    *   **Product Owner (PO):** Tiếp nhận prompt của người dùng, phân tích và chia nhỏ thành danh sách task cụ thể (`tasks/*.md`).
    *   **Solution Architect (SA):** Định nghĩa kiến trúc, interface và các quy chuẩn kỹ thuật.
    *   **Developer (Dev Sub-Agent - Claude Code CLI):** Thao tác trên Dev Terminal để viết code theo thiết kế.
    *   **Tester (QA Agent & Test Runner):** Lập kế hoạch kiểm thử, kích hoạt Test Terminal và đánh giá kết quả kiểm thử.

### FR5. An toàn và Kiểm soát Người dùng (HITL & Guardrails)
*   **Mô tả:** Đảm bảo an toàn cho máy tính cá nhân của người dùng, ngăn chặn các lệnh nguy hiểm.
*   **Chi tiết:**
    *   Phân tích các lệnh CLI trước khi gửi vào terminal.
    *   Tự động phát hiện các lệnh rủi ro cao (ví dụ: `rm -rf`, ghi đè cấu hình hệ thống, push git force).
    *   Khi phát hiện rủi ro, hệ thống tạm dừng (Interrupt) và hiển thị cảnh báo yêu cầu người dùng xác nhận trực tiếp qua Terminal UI.

---

## 3. Yêu cầu phi chức năng (Non-Functional Requirements - NFR)

### NFR1. Trải nghiệm Terminal-First (Terminal Native)
*   Toàn bộ tương tác được thực hiện qua giao diện dòng lệnh (CLI/TUI) gọn nhẹ.
*   Không yêu cầu cài đặt web server hay ứng dụng GUI nặng nề.
*   Hiển thị trạng thái tiến độ rõ ràng bằng spinner, bảng trạng thái (status table) và màu sắc trực quan (sử dụng thư viện CLI hiện đại).

### NFR2. Tối ưu Token và Ngữ cảnh (Token Efficiency)
*   **Artifact-Driven Context:** Mã nguồn lớn và stacktrace dài không được nhồi trực tiếp vào prompt tin nhắn của LangGraph mà được đọc/ghi thông qua file trên đĩa.
*   **Log Trimming & Summarization:** Log lỗi dài được lược trích phần stacktrace trọng yếu trước khi đưa vào prompt của Claude CLI để tiết kiệm token và tăng độ chính xác của bản vá.

### NFR3. Khả năng phục hồi (Fault Tolerance & Checkpointing)
*   Hỗ trợ lưu lại checkpoint trạng thái (SQLite hoặc JSON storage).
*   Nếu người dùng bấm `Ctrl+C` hoặc máy bị tắt, có thể gõ `devteam resume` để tiếp tục từ task đang dở dang.

---

## 4. Kiến trúc Thư mục Hệ thống

```text
agent-dev-team/
├── package.json
├── tsconfig.json
├── .env.example               
├── config.json                # Cấu hình tối giản (provider, model, apiKey)
├── config.example.json        # Mẫu cấu hình
├── src/
│   ├── cli.ts                 # CLI entry point (Lệnh: devteam)
│   ├── config/
│   │   └── settings.ts        # Quản lý config.json & biến môi trường
│   ├── core/                  # Core modules dùng chung
│   │   ├── logger.ts          # Quản lý giao diện console / TUI
│   │   ├── state-manager.ts   # Quản lý State Machine & Checkpoints
│   │   └── guardrails.ts      # Kiểm duyệt an toàn các lệnh terminal
│   ├── terminal/              # Quản lý đa Terminal độc lập
│   │   ├── pty-manager.ts     # Spawn và điều khiển các tiến trình PTY ngầm
│   │   ├── dev-worker.ts      # Terminal worker điều khiển Claude CLI
│   │   └── test-runner.ts     # Terminal runner thực thi build / test
│   ├── graph/                 # Tầng điều phối LangGraph
│   │   ├── state.ts           # Schema trạng thái của Agent Team
│   │   ├── nodes/             # Các Node: PO, SA, Dev, Tester
│   │   └── builder.ts         # Khởi tạo và liên kết các node/edges
│   └── watchers/              # Lắng nghe file & log events
│       └── log-parser.ts      # Trích xuất lỗi từ terminal test
├── .devteam/                  # Thư mục lưu trạng thái và tasks (Git Ignored)
│   ├── MASTER_PLAN.json
│   └── tasks/
└── docs/                      # Tài liệu dự án (BRD, SRD, PLAN)
```
