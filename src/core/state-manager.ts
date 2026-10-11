import fs from 'fs';
import path from 'path';

export type DevTeamPhase =
  | 'IDLE'
  | 'PLANNING'
  | 'DEV_CODING'
  | 'RUNNING_TEST'
  | 'SELF_HEALING'
  | 'VERIFIED'
  | 'DONE';

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'TESTING'
  | 'SELF_HEALING'
  | 'DONE'
  | 'FAILED';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MasterPlan {
  projectName: string;
  intent: string;
  architectureSummary: string;
  currentPhase: DevTeamPhase;
  currentTaskId?: string;
  tasks: TaskItem[];
  createdAt: string;
  updatedAt: string;
}

export class StateManager {
  private projectRoot: string;
  private devTeamDir: string;
  private tasksDir: string;
  private stateFilePath: string;
  private plan: MasterPlan;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.devTeamDir = path.join(this.projectRoot, '.devteam');
    this.tasksDir = path.join(this.devTeamDir, 'tasks');
    this.stateFilePath = path.join(this.devTeamDir, 'MASTER_PLAN.json');
    this.initStorage();
    this.plan = this.loadState();
  }

  private initStorage(): void {
    if (!fs.existsSync(this.devTeamDir)) {
      fs.mkdirSync(this.devTeamDir, { recursive: true });
    }
    if (!fs.existsSync(this.tasksDir)) {
      fs.mkdirSync(this.tasksDir, { recursive: true });
    }
  }

  private loadState(): MasterPlan {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(raw);
      } catch {
        // Fallback to default
      }
    }

    return {
      projectName: path.basename(this.projectRoot),
      intent: '',
      architectureSummary: '',
      currentPhase: 'IDLE',
      tasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public saveState(): void {
    this.plan.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.stateFilePath, JSON.stringify(this.plan, null, 2), 'utf-8');
  }

  public getPlan(): MasterPlan {
    return { ...this.plan };
  }

  public setPhase(phase: DevTeamPhase): void {
    this.plan.currentPhase = phase;
    this.saveState();
  }

  public getPhase(): DevTeamPhase {
    return this.plan.currentPhase;
  }

  public initPlan(intent: string, architectureSummary: string, tasks: Omit<TaskItem, 'status' | 'retryCount' | 'createdAt' | 'updatedAt'>[]): void {
    const now = new Date().toISOString();
    const taskItems: TaskItem[] = tasks.map((t) => ({
      ...t,
      status: 'TODO',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    }));

    this.plan = {
      projectName: path.basename(this.projectRoot),
      intent,
      architectureSummary,
      currentPhase: 'PLANNING',
      currentTaskId: taskItems.length > 0 ? taskItems[0].id : undefined,
      tasks: taskItems,
      createdAt: now,
      updatedAt: now,
    };

    // Write task markdown files
    for (const task of taskItems) {
      this.writeTaskMarkdown(task);
    }

    this.saveState();
  }

  public writeTaskMarkdown(task: TaskItem): void {
    const mdPath = path.join(this.tasksDir, `${task.id}.md`);
    const content = `# Nhiệm vụ: ${task.title} (${task.id})

**Trạng thái:** \`${task.status}\`  
**Số lần tự sửa (Retries):** ${task.retryCount}  
**Cập nhật lần cuối:** ${task.updatedAt}

---

## 1. Mô tả chi tiết
${task.description}

## 2. Tiêu chuẩn chấp thuận (Acceptance Criteria)
${task.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join('\n')}

${
  task.lastError
    ? `\n## ⚠️ Lỗi ghi nhận gần nhất\n\`\`\`text\n${task.lastError}\n\`\`\`\n`
    : ''
}
`;
    fs.writeFileSync(mdPath, content, 'utf-8');
  }

  public updateTaskStatus(taskId: string, status: TaskStatus, lastError?: string): void {
    const task = this.plan.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date().toISOString();
      if (lastError !== undefined) {
        task.lastError = lastError;
      }
      if (status === 'SELF_HEALING') {
        task.retryCount += 1;
      }
      this.writeTaskMarkdown(task);
      this.saveState();
    }
  }

  public getCurrentTask(): TaskItem | undefined {
    if (!this.plan.currentTaskId) {
      const next = this.plan.tasks.find((t) => t.status !== 'DONE');
      return next;
    }
    return this.plan.tasks.find((t) => t.id === this.plan.currentTaskId);
  }

  public setCurrentTaskId(id?: string): void {
    this.plan.currentTaskId = id;
    this.saveState();
  }

  public moveToNextTask(): TaskItem | undefined {
    const next = this.plan.tasks.find((t) => t.status !== 'DONE');
    if (next) {
      this.plan.currentTaskId = next.id;
    } else {
      this.plan.currentTaskId = undefined;
      this.plan.currentPhase = 'DONE';
    }
    this.saveState();
    return next;
  }
}
