# Kế Hoạch Triển Khai Code (Plan Mega-Prompt)

***LƯU Ý:** File này được thiết kế như một **Mega-Prompt**. Khi bạn mở một phiên chat (Terminal) mới với Claude Code, hãy dùng lệnh `!cat docs/PLAN.md` hoặc yêu cầu Claude đọc file này để ngay lập tức hiểu toàn bộ bối cảnh và bắt tay vào code.*

---

## 1. Vai trò (Role)
Bạn là một Senior AI Engineer & Node.js Expert. Nhiệm vụ của bạn là hiện thực hóa dự án **AutoDevGraph** (còn gọi là `h-claude`). Đây là một công cụ CLI hoạt động tương tự như Claude Code, nhưng bên trong nó là một đội ngũ Multi-Agent (LangGraph) tự động hóa quy trình phát triển phần mềm.

## 2. Ngữ cảnh Kiến trúc (Architecture Context)
Hệ thống này **KHÔNG** dùng workflow cứng ngắc, **KHÔNG** truyền file code qua message context (để tối ưu Token). Thay vào đó, nó hoạt động dựa trên các nguyên lý sau:
1.  **Agentic Orchestration:** LangGraph đóng vai trò quản đốc luân chuyển công việc (TODO -> IN_PROGRESS). LLM trong các Node (PO, SA, Dev, Tester) tự đưa ra quyết định nghiệp vụ.
2.  **Artifact-Driven Memory:** Agent đọc/ghi vào các file trong `.autodev/tasks/` làm "Bàn cờ ảo". Không lạm dụng RAG.
3.  **PTY Execution Tool:** Công cụ duy nhất của Dev_Agent và Tester_Agent là một Pseudo-Terminal (Node-PTY) chạy ẩn lệnh `claude`. Các Agent gửi lệnh vào PTY, quan sát `stdout`, và tự suy luận (ReAct) đến khi hoàn thành task.
4.  **Thinking Framework:** Mỗi Agent bắt buộc phải xuất ra thẻ `<thought> ... </thought>` trước khi hành động, giúp nó biết khi nào cần gõ lệnh `/model` để đổi LLM nếu gặp lỗi kết nối (Self-healing).
5.  **Interactive TUI:** Lớp ngoài cùng là CLI tool (`h-claude`) dùng `@clack/prompts` để hiện thanh trạng thái đẹp mắt, và cho phép Human-in-the-Loop (HITL) phê duyệt nếu Agent làm việc nguy hiểm.

## 3. Thông số Kỹ thuật (Specifications)
*   **Ngôn ngữ:** TypeScript (Node.js).
*   **Entry Point CLI:** Lệnh toàn cục `h-claude` sẽ map vào `./dist/cli.js`.
*   **LLM Provider (LLMLine):** Hệ thống sử dụng API tương thích OpenAI từ **9Router**.
    *   `Base URL`: `https://9router.com/v1`
    *   `API Key`: `sk-b0f215572cf1a335-5sgnzr-601aab9a`
*   **Thư viện lõi:** `@langchain/langgraph`, `@langchain/openai` (dùng cho 9router), `node-pty` (để giao tiếp terminal), `@clack/prompts` (làm giao diện CLI UI).

## 4. Cấu trúc Thư mục Yêu cầu (Project Structure)
(Hãy tạo đúng cấu trúc này trong quá trình code)
```text
h-claude/
├── package.json
├── tsconfig.json
├── .env
├── src/
│   ├── cli.ts                 # Điểm khởi chạy lệnh `h-claude` (TUI & Repl loop)
│   ├── core/                  
│   │   ├── llmline.ts         # Khởi tạo @langchain/openai trỏ tới 9router
│   │   ├── logger.ts          # Ghi log ra màn hình bằng clack
│   │   └── guardrails.ts      # Kiểm duyệt an toàn lệnh PTY
│   ├── graph/                 
│   │   ├── state.ts           # Định nghĩa cấu trúc AgentState cho LangGraph
│   │   └── builder.ts         # Lắp ráp Graph, định nghĩa Edges & Routing
│   ├── agents/                
│   │   ├── prompts.ts         # System prompts với <thought> tags
│   │   ├── BaseAgent.ts       # Interface nền tảng
│   │   ├── PlannerNode.ts     # Đóng vai trò PO/SA (Lên kế hoạch ra file)
│   │   └── ExecutionNode.ts   # Đóng vai trò Dev/Tester (Gọi PTY Tool)
│   └── tools/                 
│       ├── ptyManager.ts      # Wrapper cho node-pty chạy process `claude`
│       └── ptyTool.ts         # Tool class chuẩn của Langchain cho Agent gọi
```

## 5. Kế Hoạch Thực Thi (Execution Tasks)
Khi bắt đầu, bạn hãy code theo tuần tự sau. Sau mỗi bước, tự động báo cáo và chạy test (nếu cần):

*   **Task 1: Khởi tạo Project & Cài đặt (Init):**
    *   Tạo `package.json`, `tsconfig.json`. Cấu hình `bin: { "h-claude": "./dist/cli.js" }`.
    *   Cài đặt các dependency: `npm i @langchain/langgraph @langchain/openai @langchain/core node-pty @clack/prompts dotenv`.
*   **Task 2: Tầng Lõi (Core & LLMLine):**
    *   Code `src/core/llmline.ts` để kết nối API 9router bằng API Key đã cho.
    *   Code `src/core/logger.ts` bằng `@clack/prompts`.
*   **Task 3: Tầng Tools (PTY Adapter):**
    *   Tạo `src/tools/ptyManager.ts` dùng `node-pty` để tạo một shell, spawn process `claude` (nếu có trên máy).
    *   Bọc nó lại thành Langchain Tool `ptyTool.ts`.
*   **Task 4: Tầng Graph & Agents:**
    *   Xây dựng `state.ts` (quản lý `tasks`, `current_status`).
    *   Xây dựng `prompts.ts` tích hợp `<thought>` framework.
    *   Hoàn thiện `builder.ts` để nối các Node lại.
*   **Task 5: Tầng CLI (Entry Point):**
    *   Hoàn thiện `src/cli.ts` (Thêm shebang `#!/usr/bin/env node`).
    *   Xây dựng vòng lặp REPL, hiển thị thanh tiến trình spinner khi Graph đang chạy.
*   **Task 6: Build & Test:**
    *   Thêm script `"build": "tsc"` vào `package.json`.
    *   Hướng dẫn người dùng chạy `npm run build` và `npm link` để test thử lệnh `h-claude`.

---
*Bắt đầu ngay từ Task 1 khi nhận được prompt này.*
