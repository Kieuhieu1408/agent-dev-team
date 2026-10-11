# Kế Hoạch Triển Khai Mã Nguồn (Plan Mega-Prompt) - agent-dev-team

> **LƯU Ý:** File này được thiết kế như một **Mega-Prompt**. Bất cứ khi nào bạn mở một phiên làm việc mới với AI, chỉ cần yêu cầu AI đọc file này để nắm bắt đầy đủ ngữ cảnh kiến trúc và thực thi các task một cách chuẩn xác.

---

## 1. Vai trò (Role)

Bạn là một **Senior AI & Systems Engineer (Node.js & TypeScript Expert)**. Nhiệm vụ của bạn là hiện thực hóa dự án **`agent-dev-team`** (lệnh CLI: `devteam`). Đây là một công cụ điều phối đa terminal độc lập trên máy cục bộ, quản lý trạng thái tập trung và tự động hóa quy trình phát triển phần mềm thông qua `claude CLI` mà không cần con người làm trung gian copy/paste bug.

---

## 2. Ngữ cảnh Kiến trúc Cốt lõi (Architecture Context)

Hệ thống hoạt động dựa trên các nguyên lý trọng tâm:
1. **Terminal-First (Không cần GUI cồng kềnh):** Mọi thao tác điều khiển được thực hiện qua giao diện dòng lệnh (CLI/TUI) gọn nhẹ và mượt mà.
2. **Master Agent ➔ Sub-Agent Fleet Architecture:**
   * **Master Agent (LangGraph Orchestrator):** Tiếp nhận yêu cầu con người, lưu giữ bộ nhớ hội thoại đa lượt, phân tách Master Plan và điều khiển các Sub-Agents.
   * **Terminal 1 (Explorer / Auditor Sub-Agent):** Điều phối `claude CLI` tự do dùng ripgrep, view file, git để khảo sát kiến trúc, review convention và audit bug nghiệp vụ.
   * **Terminal 2 (Developer Sub-Agent):** Điều phối `claude CLI` để phân tích và viết code, tạo unit test.
   * **Terminal 3 (Test Runner):** Thực thi các lệnh build/test độc lập (`npm test`, `mvn test`, `pytest`...) mà không làm nghẽn Terminal 1 & 2.
3. **Centralized State Management:** Quản lý vòng đời tác vụ thông qua State Machine:
   `IDLE` ➔ `PLANNING` ➔ `DEV_CODING` ➔ `RUNNING_TEST` ➔ `SELF_HEALING` ➔ `VERIFIED` ➔ `DONE`.
   Lưu trữ tiến độ tại `.devteam/state.json` và `.devteam/tasks/task_XXX.md`.
4. **Closed-Loop Self-Healing:** Khi Test Runner bắt được lỗi, Log Parser tự động trích xuất stacktrace và gửi thông tin lỗi sang Developer Sub-Agent để Claude CLI tự fix code cho tới khi pass.
5. **Human-in-the-Loop (HITL) & Guardrails:** Tự động chặn các câu lệnh nguy hiểm và cho phép người dùng can thiệp khi cần thiết.

---

## 3. Thông số Kỹ thuật (Technical Specifications)

* **Ngôn ngữ:** TypeScript (Node.js >= 18).
* **CLI Command Entry:** Lệnh `devteam` map vào `./dist/cli.js`.
* **File Cấu Hình (`config.json`):**
  * Tối giản chỉ gồm 3 trường: `{ "provider": "9router", "model": "gemini", "apiKey": "sk-..." }`.
  * Hỗ trợ lưu trữ cục bộ tại `./config.json` hoặc toàn cục tại `~/.devteam/config.json`.
* **LLM Provider (9Router / OpenAI Compatible):**
  * `Base URL`: `https://9router.com/v1`.
  * **2 Model Combos:**
    1. `gemini` (Mặc định): upstream `ag/gemini-pro-agent` (Context 1.0M, Max 64k).
    2. `claude-sonnet`: upstream `ag/claude-sonnet-4-6` (Context 1.0M, Max 128k).
* **Thư viện chính:**
  * `@langchain/langgraph`: Điều phối đồ thị trạng thái Agent Team.
  * `@langchain/openai`: Kết nối LLM Provider qua chuẩn OpenAI.
  * `node-pty`: Quản lý các tiến trình pseudo-terminal ngầm trên macOS/Linux.
  * `@clack/prompts`: Xây dựng giao diện dòng lệnh TUI trực quan, spinner, prompt.
  * `dotenv`: Quản lý biến môi trường dự phòng.

---

## 4. Cấu trúc Thư mục Dự án Yêu cầu

```text
agent-dev-team/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── docs/
│   ├── BRD.md
│   ├── SRD.md
│   └── PLAN.md
├── src/
│   ├── cli.ts                 # Điểm khởi chạy lệnh `devteam`
│   ├── config/
│   │   └── settings.ts        # Đọc cấu hình từ .env
│   ├── core/
│   │   ├── state-manager.ts   # State Machine và lưu trữ checkpoint (.devteam/)
│   │   ├── logger.ts          # Hiển thị UI / Spinner bằng @clack/prompts
│   │   ├── guardrails.ts      # Kiểm duyệt an toàn các lệnh terminal
│   │   └── llm-factory.ts     # Khởi tạo LLM Provider
│   ├── terminal/
│   │   ├── pty-manager.ts     # Wrapper quản lý đa tiến trình pseudo-terminal
│   │   ├── claude-worker.ts   # Quản lý các Claude Code CLI Sub-Agents (Explorer, Dev)
│   │   ├── dev-worker.ts      # Kế thừa claude-worker, chạy Developer Sub-Agent
│   │   └── test-runner.ts     # Quản lý terminal chạy test/build độc lập
│   ├── watchers/
│   │   └── log-parser.ts      # Phân tích log và trích xuất lỗi test
│   ├── graph/
│   │   ├── state.ts           # Định nghĩa cấu trúc AgentState cho LangGraph
│   │   ├── builder.ts         # Khởi tạo các Node và liên kết luồng
│   │   └── nodes/
│   │       ├── po-node.ts     # Lên kế hoạch và chia task
│   │       ├── architect-node.ts # Định hình cấu trúc kỹ thuật
│   │       ├── dev-node.ts    # Kích hoạt DevWorker
│   │       └── tester-node.ts # Kích hoạt TestRunner & nhận diện bug
│   └── tools/
│       ├── file-system.ts     # Đọc/ghi files nhiệm vụ (.devteam/tasks/)
│       └── terminal-tool.ts   # Tool LangChain gọi PTY
```

---

## 5. Kế Hoạch Thực Thi Từng Bước (Execution Roadmap)

Khi bắt đầu code, thực hiện tuần tự theo các nhiệm vụ sau:

### Task 1: Khởi tạo Dự án & Dependencies
* Tạo `package.json` với cấu hình `"bin": { "devteam": "./dist/cli.js" }`.
* Cài đặt dependencies: `@langchain/langgraph`, `@langchain/openai`, `@langchain/core`, `node-pty`, `@clack/prompts`, `dotenv`.
* Tạo file `tsconfig.json` và `.env.example`.

### Task 2: Core State Manager & Config
* Xây dựng `src/config/settings.ts` để đọc cấu hình API Key và model.
* Xây dựng `src/core/state-manager.ts` để quản lý các trạng thái (`IDLE`, `PLANNING`, `DEV_CODING`, `RUNNING_TEST`, `SELF_HEALING`, `DONE`) và lưu trữ checkpoint tại `.devteam/state.json`.
* Xây dựng `src/core/logger.ts` sử dụng `@clack/prompts`.

### Task 3: Terminal Process Isolation (PTY Engine)
* Xây dựng `src/terminal/pty-manager.ts` để spawn các tiến trình terminal ngầm trên máy cục bộ.
* Xây dựng `src/terminal/dev-worker.ts`: Điều khiển tiến trình `claude CLI`, gửi prompt và lắng nghe hoàn tất.
* Xây dựng `src/terminal/test-runner.ts`: Tự động nhận diện loại dự án và chạy test ngầm không gây block.

### Task 4: Watcher & Log Parser (Self-Healing Bridge)
* Xây dựng `src/watchers/log-parser.ts`: Bắt exit code != 0 và trích xuất stacktrace lỗi.
* Kết nối sự kiện lỗi với State Manager để kích hoạt pha `SELF_HEALING`.

### Task 5: LangGraph Agent Orchestration
* Xây dựng `src/graph/state.ts` và các Node nghiệp vụ (PO, Architect, Dev, Tester).
* Kết nối luồng hoàn chỉnh: PO chia task ➔ Dev code qua Claude CLI ➔ Tester chạy test ➔ Nếu fail thì tự đẩy bug cho Dev fix ➔ Verify thành công.

### Task 6: CLI & TUI Interface
* Xây dựng `src/cli.ts` với các lệnh: `devteam run <intent>`, `devteam status`, `devteam logs`.
* Đảm bảo trải nghiệm trực quan, có spinner và thanh tiến trình rõ ràng.

### Task 7: Build & Publish Local
* Chạy `npm run build` và `npm link` để kiểm tra trực tiếp lệnh `devteam` trên máy tính cá nhân.
