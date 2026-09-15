# Software Requirements & Design Document (SRD) - AutoDevGraph

## 1. Tổng quan Kiến trúc Hệ thống (System Architecture)

AutoDevGraph được thiết kế theo kiến trúc **Meta-Agent Orchestration**, trong đó LangGraph đóng vai trò là xương sống điều phối, còn các LLM đóng vai trò là "não bộ" của các Node. 

Các thành phần chính:
1. **State Manager (LangGraph):** Quản lý luồng công việc (TODO -> IN_PROGRESS -> DONE) thông qua việc điều phối các Node.
2. **LLMLine (Provider Multiplexer):** Trình quản lý Model linh hoạt, cho phép chuyển đổi nóng (hot-swap) giữa các LLM Provider (Anthropic, OpenAI, Local) cho các Node.
3. **Agent Nodes (PO, SA, Dev, Tester):** Các thực thể tự trị (Autonomous Entities) được bọc trong bộ Prompt tư duy (Thinking Framework).
4. **PTY Interface:** Lớp giao tiếp vật lý, biến Agent thành một "người dùng" thao tác trên terminal thông qua lệnh `claude`.

## 2. Thiết kế Cơ sở hạ tầng cốt lõi (Core Modules)

### 2.1. Khung tư duy của Agent (Thinking Framework Prompts)
Mỗi Agent không chỉ nhận lệnh mà được tiêm (inject) một System Prompt ép buộc quá trình tư duy (Chain of Thought / ReAct).
**Cấu trúc Prompt:**
*   **[ROLE]:** Định nghĩa vai trò (Ví dụ: Bạn là Senior Developer).
*   **[CONTEXT]:** Hướng dẫn Agent đọc file Artifacts nào để lấy bối cảnh.
*   **[THINKING PROCESS]:** Yêu cầu Agent phải xuất ra tag `<thought>` trước khi gọi Tool. Trong tag này, Agent phải phân tích: "Mình đang ở bước nào? Lệnh trước đó trả về kết quả gì? Bước tiếp theo là gì?".
*   **[ERROR RECOVERY]:** Cấp quyền và hướng dẫn Agent cách xử lý khi luồng PTY bị kẹt (ví dụ: Sử dụng lệnh `/model` để đổi model).

### 2.2. LLMLine & Cơ chế Phục hồi lỗi động (Dynamic Model Fallback)
Hệ thống đối mặt với 2 loại lỗi và cách xử lý tương ứng:

*   **Lỗi Loại 1: Lỗi API ở Tầng LangGraph (Node LLM bị timeout/rate limit)**
    *   *Thiết kế:* Lớp `LLMLineFactory` sẽ wrap (bọc) các cuộc gọi LLM. Nếu gọi `Claude-3.5-Sonnet` thất bại 2 lần, `LLMLineFactory` tự động fallback (chuyển) sang `GPT-4o` hoặc `Claude-3-Haiku` để Node vẫn tiếp tục chạy mà không sập Graph.
*   **Lỗi Loại 2: Lỗi bên trong PTY (Claude CLI bị kẹt, lỗi mạng, trả lời ngớ ngẩn)**
    *   *Thiết kế:* Cấp cho Agent công cụ nhận diện lỗi. Trong System Prompt của Agent, thêm quy tắc: *"Nếu bạn nhận thấy output từ PTY liên tục báo lỗi kết nối (connection error), rate limit, hoặc model lặp lại một lỗi logic quá 3 lần: Bạn HÃY GỬI lệnh `/model` vào PTY để chọn một model khác nhẹ hơn hoặc ổn định hơn, sau đó thử lại lệnh trước đó."*

### 2.3. Quản lý Trí nhớ bằng File (Artifact-Driven State)
Thay vì truyền tham số qua LangGraph, hệ thống lưu trữ tại `.autodev/`:
*   `MASTER_PLAN.json`: LangGraph đọc file này để biết chuyển quyền cho Agent nào.
*   `.tasks/task_XXX.md`: Các Agent đọc/ghi vào đây để giao tiếp nghiệp vụ với nhau.

## 3. Cấu trúc Dự án (Project Structure)

Dựa trên thiết kế kiến trúc và BRD, dự án được cấu trúc như sau:

```text
autodevgraph/
├── package.json
├── tsconfig.json
├── .env.example               # Khai báo các API Keys (Anthropic, OpenAI...)
├── src/
│   ├── index.ts               # Điểm khởi chạy hệ thống (Entry point)
│   ├── config/
│   │   └── settings.ts        # Đọc cấu hình từ .env và settings mặc định
│   ├── core/                  # Các module dùng chung, độc lập nghiệp vụ
│   │   ├── llmline/           # Tầng quản lý Model linh hoạt (Tính năng mới)
│   │   │   ├── LLMFactory.ts  # Khởi tạo model dựa trên config
│   │   │   └── Fallback.ts    # Logic Circuit Breaker & Fallback Provider
│   │   ├── logger/            # Trình quản lý Log ra console (Observer)
│   │   └── guardrails/        # Kiểm tra an toàn trước khi chạy lệnh PTY
│   ├── graph/                 # Tầng điều phối (LangGraph)
│   │   ├── state.ts           # Cấu trúc AgentState (Chỉ chứa metadata điều phối)
│   │   ├── router.ts          # Logic luân chuyển giữa các Node
│   │   └── builder.ts         # Lắp ráp Graph (Nodes + Edges)
│   ├── agents/                # Tầng nghiệp vụ (Các Vai trò)
│   │   ├── prompts/           # Chứa System Prompts (Thinking Framework)
│   │   │   ├── developer.ts
│   │   │   ├── tester.ts
│   │   │   └── architect.ts
│   │   ├── BaseAgent.ts       # Interface chung xử lý vòng lặp ReAct
│   │   ├── DeveloperNode.ts   
│   │   ├── TesterNode.ts      
│   │   └── ProductOwnerNode.ts
│   ├── tools/                 # Các công cụ cấp cho Agent
│   │   ├── pty/               # Sub-module Terminal Ảo
│   │   │   ├── PTYManager.ts  # Quản lý tiến trình node-pty
│   │   │   └── PTYTool.ts     # Tool wrapping cho Agent gọi
│   │   └── file_system/       # Tool đọc/ghi file Artifacts
│   │       ├── ReadArtifact.ts
│   │       └── WriteArtifact.ts
├── .autodev/                  # Bàn cờ ảo - Không commit lên Git
│   ├── context.md             
│   ├── MASTER_PLAN.json       
│   └── tasks/                 
└── workspace/                 # Thư mục mã nguồn mục tiêu (Nơi PTY hoạt động)
```

## 4. Đặc tả Luồng Hoạt động (Workflow Specification)

1. **Khởi tạo:** `index.ts` nạp biến môi trường, thiết lập `LLMFactory`. Đọc `context.md` từ người dùng.
2. **Lên kế hoạch:** `PO_Node` chạy, chia nhỏ `context.md` thành các file trong `.tasks/`. Cập nhật `MASTER_PLAN.json`.
3. **Phân giao:** LangGraph đọc `MASTER_PLAN.json`, nhận diện tính năng đang chờ, chuyển luồng sang `Dev_Node`.
4. **Thực thi (ReAct):** 
   * `Dev_Node` sinh ra `<thought>` để phân tích task.
   * `Dev_Node` gọi `PTYTool("claude")`.
   * Chờ output từ PTY. Phân tích output.
   * Nếu PTY lỗi liên tục, `Dev_Node` sinh `<thought>: "Model hiện tại đang lỗi, cần switch."` -> Gọi `PTYTool("/model")` -> Chọn model khác -> Thử lại.
5. **Nghiệm thu:** Chuyển qua `Tester_Node` để chạy test. Nếu lỗi, cập nhật task file và trả lại cho `Dev_Node`. Nếu thành công, cập nhật `MASTER_PLAN.json` và lặp lại bước 3.
