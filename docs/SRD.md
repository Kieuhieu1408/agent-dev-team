# Software Requirements & Design Document (SRD) - agent-dev-team

## 1. Tổng quan Kiến trúc Hệ thống (System Architecture)

**agent-dev-team** được thiết kế theo mô hình **Terminal-Native Multi-Process Orchestrator**, kết hợp giữa:
1. **LangGraph State Engine:** Điều phối trạng thái của các Agent (PO, SA, Dev, Tester) và theo dõi tiến độ tổng thể.
2. **Terminal Process Isolation Layer (PTY Manager):** Quản lý các phiên terminal ảo chạy ngầm độc lập trên máy cục bộ của người dùng.
3. **Event Bus & Log Parser:** Cầu nối tự động hóa bắt lỗi từ Test Terminal và gửi yêu cầu sửa đổi sang Dev Terminal.
4. **Artifact-Driven Storage:** Lưu trữ trạng thái và nội dung nhiệm vụ trên ổ đĩa (`.devteam/`) thay vì truyền toàn bộ vào context window của LLM.

```
+-------------------------------------------------------------------------+
|                         CLI Interface (devteam)                         |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|             MASTER AGENT: State Manager & LangGraph Orchestrator        |
|  - Trạng thái: IDLE | PLANNING | DEV_CODING | RUNNING_TEST | SELF_HEAL  |
|  - Bộ nhớ hội thoại đa lượt: sessionMessages (BaseMessage[])            |
|  - Quản lý Artifacts: .devteam/tasks/task_XXX.md                        |
+--------------------+-------------------+--------------------------------+
                     |                   |                                |
                     v                   v                                v
+------------------------+ +------------------------+ +-------------------+
|  TERMINAL 1 (Explorer) | |   TERMINAL 2 (Dev)     | |TERMINAL 3 (Runner)|
| - node-pty (claude CLI)| | - node-pty (claude CLI)| | - node-pty (test) |
| - Tự do dùng ripgrep,  | | - Sinh code, refactor  | | - Chạy test dự án |
|   view file để audit   | | - Nhận bug để tự sửa   | | - Bắt error log   |
+------------------------+ +------------------------+ +-------------------+
```

---

## 2. Thiết kế Cơ sở hạ tầng & Các Module cốt lõi

### 2.1. Module Quản lý Terminal Độc lập (`src/terminal/`)
*   **`PTYManager.ts`:**
    *   Sử dụng thư viện `node-pty` để tạo các pseudo-terminal session độc lập với terminal hiện tại của người dùng.
    *   Cho phép spawn nhiều session cùng lúc với working directory trỏ tới thư mục dự án cần phát triển.
    *   Cung cấp API bất đồng bộ: `spawnSession(name, command, args, cwd)`, `writeToSession(name, input)`, `onOutput(name, callback)`, `killSession(name)`.
*   **`ClaudeWorker.ts`:**
    *   Lớp cơ sở quản lý các phiên Claude Code CLI Sub-Agent theo vai trò (`EXPLORER`, `DEVELOPER`, `AUDITOR`).
    *   Tự động phát hiện binary `claude`, thiết lập môi trường `ANTHROPIC_BASE_URL` / `OPENAI_API_BASE` và `--dangerously-skip-permissions`.
    *   Ghi nhận token tiêu thụ từ các Sub-Agents vào `TokenTracker`.
*   **`DevWorker.ts`:**
    *   Kế thừa từ `ClaudeWorker`, chuyên trách vai trò Developer Sub-Agent để thực thi code và unit test.
*   **`TestRunner.ts`:**
    *   Bọc một session PTY riêng biệt để thực thi lệnh build và kiểm thử của dự án (tự động nhận diện `npm test`, `mvn test`, `gradle test`, `pytest`, v.v.).
    *   Thu thập toàn bộ `stdout` và `stderr` mà không làm nghẽn tiến trình của DevWorker.

### 2.2. Module Quản lý Trạng thái (`src/core/state-manager.ts`)
*   **Mô hình State Machine:**
    *   `IDLE`: Chờ lệnh từ người dùng.
    *   `PLANNING`: PO & SA phân tích yêu cầu, tạo danh sách `tasks/*.md` và `MASTER_PLAN.json`.
    *   `DEV_CODING`: DevWorker đang tương tác với Claude CLI để viết mã.
    *   `RUNNING_TEST`: TestRunner đang chạy bộ test độc lập.
    *   `SELF_HEALING`: TestRunner phát hiện lỗi; hệ thống trích xuất log lỗi và gửi cho DevWorker tự sửa.
    *   `VERIFIED`: Tất cả các test đều pass.
    *   `DONE`: Hoàn thành toàn bộ các task trong kế hoạch.
*   **Cơ chế Checkpoint:** Lưu trữ trạng thái vào `.devteam/state.json`, hỗ trợ tính năng `devteam resume` khi người dùng khởi động lại.

### 2.3. Module Bắt & Phân tích Log (`src/watchers/log-parser.ts`)
*   **Phát hiện lỗi:** Lắng nghe stream output từ `TestRunner`. Khi tiến trình thoát với mã khác 0 (`exitCode !== 0`) hoặc bắt gặp các từ khóa lỗi (`BUILD FAILURE`, `FAIL`, `AssertionError`, `SyntaxError`...):
    *   Phân tích và trích xuất: Tên file lỗi, dòng lỗi, stacktrace và message lỗi ngắn gọn.
    *   Tạo bản tóm tắt lỗi (Bug Report).
*   **Bắn sự kiện:** Phát tín hiệu `TEST_FAILED` kèm theo Bug Report về State Manager để kích hoạt pha `SELF_HEALING`.

### 2.4. Module Điều phối Đa Agent (`src/graph/`)
*   **LangGraph Orchestration:**
    *   `ProductOwnerNode`: Nhận yêu cầu gốc, khởi tạo `MASTER_PLAN.json`.
    *   `ArchitectNode`: Thiết kế kỹ thuật, bổ sung acceptance criteria cho từng task.
    *   `DeveloperNode`: Kích hoạt `DevWorker` để thực hiện code qua Claude CLI.
    *   `TesterNode`: Kích hoạt `TestRunner` và đánh giá kết quả từ `LogParser`.
*   **Circuit Breaker (Chống vòng lặp vô tận):**
    *   Nếu một task thất bại trong pha `SELF_HEALING` quá số lần quy định (mặc định: 3 lần), hệ thống tự động tạm dừng và xin chỉ thị của lập trình viên qua giao diện CLI.

### 2.5. Module Kiểm duyệt An toàn (`src/core/guardrails.ts`)
*   Kiểm tra regex và semantic các câu lệnh trước khi thực thi trên terminal ngầm:
    *   Chặn các lệnh nguy hiểm như `rm -rf /`, `mkfs`, sửa đổi các file nhạy cảm ngoài workspace (`/etc`, `~/.ssh`).
    *   Cảnh báo và yêu cầu xác nhận đối với các thao tác git mang tính phá hủy (`git reset --hard`, `git push --force`).

---

## 3. Cấu trúc Thư mục Chi tiết (Source Code Structure)

```text
agent-dev-team/
├── package.json
├── tsconfig.json
├── config.json                # File cấu hình (chỉ gồm: provider, model, apiKey)
├── config.example.json        # File mẫu cấu hình
├── .env.example
├── .gitignore
├── README.md
├── docs/
│   ├── BRD.md                 # Tài liệu yêu cầu nghiệp vụ
│   ├── SRD.md                 # Tài liệu thiết kế kỹ thuật
│   └── PLAN.md                # Kế hoạch triển khai mã nguồn
├── src/
│   ├── cli.ts                 # CLI entry point (lệnh `devteam`)
│   ├── config/
│   │   └── settings.ts        # Quản lý config.json (chỉ có: provider, model, apiKey)
│   ├── core/
│   │   ├── state-manager.ts   # State Machine và lưu trữ checkpoint
│   │   ├── logger.ts          # Định dạng output màn hình TUI (@clack/prompts)
│   │   ├── guardrails.ts      # Kiểm tra an toàn trước khi chạy lệnh
│   │   └── llm-factory.ts     # Khởi tạo LLM Provider (9Router, Anthropic, OpenAI)
│   ├── terminal/
│   │   ├── pty-manager.ts     # Wrapper quản lý đa tiến trình pseudo-terminal
│   │   ├── dev-worker.ts      # Điều khiển Claude CLI qua PTY
│   │   └── test-runner.ts     # Chạy build và test ngầm
│   ├── watchers/
│   │   └── log-parser.ts      # Lọc và trích xuất stacktrace lỗi
│   ├── graph/
│   │   ├── state.ts           # Schema trạng thái của LangGraph
│   │   ├── router.ts          # Điều hướng luân chuyển giữa các Agent
│   │   ├── builder.ts         # Khởi tạo Graph (Nodes & Edges)
│   │   └── nodes/
│   │       ├── po-node.ts
│   │       ├── architect-node.ts
│   │       ├── dev-node.ts
│   │       └── tester-node.ts
│   └── tools/
│       ├── file-system.ts     # Đọc/ghi files nhiệm vụ (.devteam/)
│       └── terminal-tool.ts   # Tool LangChain để Agent giao tiếp với PTY
└── .devteam/                  # Bàn cờ ảo runtime (không commit Git)
    ├── MASTER_PLAN.json
    └── tasks/
```

---

## 4. Đặc tả Quy trình Vận hành (Operational Workflows)

### Quy trình 1: Khởi động & Lên kế hoạch
1. Người dùng gõ: `devteam run "Tạo tính năng X"`.
2. `PO_Node` phân tích yêu cầu, tạo file `MASTER_PLAN.json` và chia nhỏ thành `tasks/task_01.md`, `tasks/task_02.md`...
3. `Architect_Node` bổ sung yêu cầu kiến trúc và acceptance criteria vào từng file task.

### Quy trình 2: Thực thi & Kiểm thử độc lập (The Autonomous Closed Loop)
1. LangGraph chuyển trạng thái sang `DEV_CODING` cho `task_01`.
2. `DevWorker` gửi chỉ thị vào phiên Claude CLI trên Terminal 1 để viết code.
3. Khi Claude CLI hoàn tất, LangGraph chuyển trạng thái sang `RUNNING_TEST`.
4. `TestRunner` kích hoạt trên Terminal 2 để chạy lệnh test của dự án (`npm test`, `mvn test`...).
5. **Kịch bản A (Test thành công):**
   * Exit code = 0.
   * Chuyển trạng thái sang `VERIFIED`. Đánh dấu `task_01` hoàn thành trong `MASTER_PLAN.json`.
   * Tiếp tục chuyển sang `task_02`.
6. **Kịch bản B (Test thất bại - Kích hoạt Self-Healing):**
   * Exit code != 0.
   * `LogParser` trích xuất lỗi stacktrace.
   * Chuyển trạng thái sang `SELF_HEALING`.
   * Đẩy thông báo lỗi ngược lại cho `DevWorker` trên Terminal 1: *"Test thất bại tại class X với lỗi Y, hãy phân tích và sửa mã nguồn"*.
   * Claude CLI sửa code xong -> Tự động quay lại bước 4 chạy lại test.
