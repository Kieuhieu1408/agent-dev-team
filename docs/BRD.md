# Business Requirements Document (BRD) - Dự án AutoDevGraph

## 1. Tổng quan dự án (Executive Summary)

AutoDevGraph là một hệ thống Multi-Agent được xây dựng trên nền tảng LangGraph và TypeScript. Hệ thống mô phỏng một nhóm phát triển phần mềm (Team Dev) bao gồm các vai trò: Product Owner (PO), Solution Architect (SA), Developer (Dev), và Tester. 

Điểm đột phá của kiến trúc này là:
1. **Agent tự quyết định (Agentic Orchestration):** Hệ thống không dùng các luồng (workflow) định sẵn cứng nhắc. LLM bên trong mỗi Agent tự quyết định các bước thực hiện dựa trên vai trò của mình.
2. **Giao tiếp qua Artifacts (Tài liệu):** Các Agent không truyền toàn bộ ngữ cảnh (mã nguồn, yêu cầu) qua lại thông qua tin nhắn (messages), mà đọc/ghi vào các file tài liệu sống (Living Documents) đóng vai trò như "trí nhớ" hay "bàn cờ ảo".
3. **Mô phỏng thao tác người dùng qua PTY:** Thay vì trực tiếp chỉnh sửa mã nguồn, các Agent (Dev/Tester) tương tác với hệ thống thông qua một Pseudo-Terminal (PTY), đóng vai trò như một người dùng đang điều khiển công cụ **Claude Code CLI**.

## 2. Yêu cầu chức năng (Functional Requirements - FR)

### FR1. Quản lý trạng thái bằng Artifacts (File-based Memory)
*   **Mô tả:** Hệ thống phải sử dụng hệ thống file nội bộ (ví dụ: `.autodev/`) để lưu trữ tiến độ và yêu cầu, thay vì phụ thuộc vào bộ nhớ ngữ cảnh (Context Window) của LLM.
*   **Chi tiết:**
    *   PO_Agent có khả năng khởi tạo và cập nhật các file nhiệm vụ (Task Files).
    *   SA_Agent có khả năng bổ sung thiết kế kỹ thuật vào các file nhiệm vụ.
    *   Hệ thống đồ thị (LangGraph) đọc trạng thái của các file này để biết tính năng nào đang ở giai đoạn nào (TODO, IN_PROGRESS, DONE) nhằm điều phối luồng.

### FR2. Điều phối đa tác tử (Agentic Orchestration)
*   **Mô tả:** Hệ thống hỗ trợ và luân chuyển luồng công việc giữa các Node đóng vai trò riêng biệt.
*   **Chi tiết:**
    *   Các Node cốt lõi: `PO_Node`, `SA_Node`, `Dev_Node`, `Tester_Node`.
    *   Luồng luân chuyển không cố định tuyến tính mà dựa trên kết quả đầu ra của Node. (Ví dụ: Tester báo lỗi, luồng tự động vòng lại Dev; Dev hoàn thành task, luồng vòng lại Supervisor để lấy task mới).

### FR3. Tích hợp Pseudo-Terminal (PTY Tool)
*   **Mô tả:** Cung cấp công cụ cho các Agent tương tác với môi trường CLI như một con người.
*   **Chi tiết:**
    *   Xây dựng một Tool (ví dụ: `Execute_PTY_Command`) cấp quyền cho Agent.
    *   Tool này có khả năng khởi chạy tiến trình `claude`, gửi lệnh stdin và đọc kết quả stdout/stderr.
    *   Tool phải có khả năng nhận diện khi nào dòng lệnh kết thúc (chờ lệnh mới) để trả kết quả về cho Agent "nhìn" (Observe).

### FR4. Human-in-the-Loop (HITL) & Safety Guardrails
*   **Mô tả:** Đảm bảo an toàn hệ thống và cho phép con người can thiệp khi cần thiết.
*   **Chi tiết:**
    *   Phân tích luồng output từ PTY để phát hiện các mẫu rủi ro hoặc câu hỏi yêu cầu quyền (ví dụ: `[Y/n]`).
    *   Cơ chế Guardrails sẽ phân loại: 
        *   An toàn: Tự động phản hồi (ví dụ: tự động điền `Y`).
        *   Rủi ro: Tạm dừng (Interrupt) Node hiện tại, văng ra ngoài LangGraph và yêu cầu người dùng thật xác nhận bằng một thông báo tóm tắt nguyên nhân.

## 3. Yêu cầu phi chức năng (Non-Functional Requirements - NFR)

### NFR1. Khả năng mở rộng (Extensibility)
*   **Kiến trúc mở:** Dễ dàng bổ sung các vai trò Agent mới (VD: Security Reviewer, DevOps) bằng cách kế thừa các Interface/Base Class đã có mà không phá vỡ đồ thị hiện tại.
*   **LLM Agnostic:** Tầng giao tiếp với LLM phải được trừu tượng hóa (thông qua `@langchain/core`), cho phép thay đổi model (Claude 3.5 Sonnet, Opus, v.v.) qua biến môi trường.

### NFR2. Tính ổn định và Phục hồi (Resilience & Fault Tolerance)
*   **Circuit Breakers:** Ngăn chặn vòng lặp vô hạn (ví dụ: Dev sửa sai -> Tester báo lỗi -> Dev sửa sai...). Phải có giới hạn số lần thử lại (Max Retries). Quá số lần, hệ thống cảnh báo và tạm dừng chờ Human.
*   **Checkpointing:** LangGraph phải sử dụng Checkpointer (SQLite/Memory) để lưu trạng thái từng bước. Có khả năng Resume (tiếp tục) tại điểm crash nếu ứng dụng bị tắt đột ngột.

### NFR3. Tối ưu Token & Quản lý Context Window (Memory Systems)
Để đảm bảo hiệu suất, chi phí và tránh suy giảm ngữ cảnh (Context Degradation), hệ thống áp dụng các kỹ thuật quản lý bộ nhớ tiên tiến (dựa trên Day 17 & Day 25):
*   **Prompt Caching:** Tối ưu hóa chi phí cho các thành phần tĩnh. System Prompts của các Agent (PO, SA, Dev, Tester) và các file quy chuẩn chung (`TECH_STACK.md`) sẽ được thiết kế để tận dụng tính năng Prompt Caching của LLM Provider (ví dụ: Claude Prompt Caching).
*   **Message Trimming & Filtering:** Bộ nhớ ngắn hạn (`messages` trong LangGraph State) phải được cấu hình cắt tỉa (Trim). Chỉ giữ lại một số lượng token (hoặc số lượng tin nhắn) nhất định gần nhất. Các tin nhắn cũ (không chứa thông tin hệ trọng) sẽ bị loại bỏ để giải phóng context.
*   **Active Summarization (Tóm tắt chủ động):** Khi lịch sử tương tác (đặc biệt là log từ PTY) quá dài, hệ thống sử dụng một LLM call phụ để tóm tắt quá trình (ví dụ: "Đã fix lỗi cú pháp ở file A") thay vì lưu toàn bộ chuỗi lỗi (Stack trace).
*   **Passive Memory (Artifact-Driven Context):** Mã nguồn thực tế, Spec, và tài liệu dài tuyệt đối không được đưa trực tiếp vào chuỗi hội thoại (Messages). Chúng tồn tại ở dạng Passive Memory (File trên đĩa). Agent chỉ tải chúng vào Active Context thông qua Tool (`ReadFile`) vào đúng thời điểm cần thiết, và nhả ra khi xong việc.

## 4. Đề xuất Design Patterns

1.  **State Machine Pattern:** Cốt lõi của LangGraph, điều phối luồng dựa trên trạng thái chung (`AgentState`).
2.  **Strategy Pattern:** Thiết kế các Agent (`PO_Agent`, `Dev_Agent`...) implement từ chung một interface `IAgentNode`, giúp dễ dàng tiêm (inject) và thay đổi logic của từng Agent.
3.  **Adapter/Facade Pattern:** Đóng gói sự phức tạp của việc giao tiếp với Node.js `node-pty` (tiến trình shell ảo) thành một interface Tool đơn giản, gọn gàng để cung cấp cho LangChain.
4.  **Observer Pattern:** Dùng để theo dõi và log các sự kiện xảy ra trong Graph (Ví dụ: bắn log ra màn hình console để người dùng theo dõi tiến trình thực mà không làm gián đoạn luồng).

## 5. Kiến trúc Thư mục Dự kiến (Project Structure)

```text
autodevgraph/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Entry point, khởi tạo và chạy hệ thống
│   ├── graph/                 # Định nghĩa LangGraph cốt lõi
│   │   ├── state.ts           # Giao diện AgentState (Bàn cờ chung)
│   │   ├── builder.ts         # Compile đồ thị, định nghĩa Nodes & Edges
│   │   └── checkpoints.ts     # Logic lưu/phục hồi trạng thái Graph
│   ├── agents/                # Chứa logic tự quyết định của LLM (Strategies)
│   │   ├── BaseAgentNode.ts   # Lớp nền tảng / Interface
│   │   ├── ProductOwner.ts
│   │   ├── SolutionArchitect.ts
│   │   ├── Developer.ts
│   │   └── Tester.ts
│   ├── tools/                 # Các "vũ khí" cấp cho Agent
│   │   ├── pty/               # Sub-module xử lý Terminal ảo
│   │   │   ├── PTYAdapter.ts  # Tương tác vật lý với shell
│   │   │   └── PTYTool.ts     # Langchain Tool wrapper cho PTYAdapter
│   │   └── artifacts/         # Sub-module đọc/ghi file
│   │       └── ArtifactTool.ts
│   ├── core/                  # Các tiện ích hệ thống dùng chung
│   │   ├── logger.ts          # Quản lý hiển thị (Observer)
│   │   ├── config.ts          # Đọc file cấu hình, .env
│   │   └── guardrails.ts      # Chẩn đoán lệnh PTY an toàn / rủi ro
├── .autodev/                  # Thư mục chứa "Trí nhớ" của Agent (Ignored in VCS)
│   ├── context.md             # Bối cảnh / Yêu cầu gốc
│   └── tasks/                 # Chứa các file task_01.md, task_02.md...
└── workspace/                 # Thư mục mã nguồn mục tiêu nơi Claude CLI làm việc
```
