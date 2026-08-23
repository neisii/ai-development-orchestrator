import type Database from "better-sqlite3";
import type { AgentActivityLabel, AgentLifecycleState, AgentRecord, EventLogEntry } from "./types.js";
import type { EventLogStore } from "./event-log.js";

// docs/data-model.md §2 참고.

export class AgentStore {
  constructor(private readonly db: Database.Database) {}

  upsert(input: {
    id: string;
    projectPath: string;
    sessionId: string | null;
    pid: number | null;
    lifecycleState: AgentLifecycleState;
  }): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, projectPath, sessionId, pid, lifecycleState, updatedAt)
         VALUES (@id, @projectPath, @sessionId, @pid, @lifecycleState, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           sessionId = excluded.sessionId,
           pid = excluded.pid,
           lifecycleState = excluded.lifecycleState,
           updatedAt = excluded.updatedAt`
      )
      .run({ ...input, updatedAt: new Date().toISOString() });
  }

  get(id: string): AgentRecord | undefined {
    return this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRecord | undefined;
  }

  list(): AgentRecord[] {
    return this.db.prepare("SELECT * FROM agents ORDER BY id").all() as AgentRecord[];
  }
}

// docs/data-model.md §2.3 참고: 도구 이름 기반 휴리스틱이라 100% 정확하지 않을 수 있다.
const TOOL_TO_ACTIVITY: Record<string, "ANALYZING" | "IMPLEMENTING"> = {
  Read: "ANALYZING",
  Grep: "ANALYZING",
  Glob: "ANALYZING",
  Edit: "IMPLEMENTING",
  Write: "IMPLEMENTING",
  NotebookEdit: "IMPLEMENTING",
};

export function computeActivityLabel(eventLog: EventLogStore, agentId: string): AgentActivityLabel {
  const recent = eventLog.list({ agentId, limit: 20 });
  const lastToolPre = recent.find((e: EventLogEntry) => e.type === "TOOL_PRE");
  if (!lastToolPre) return null;

  const payload = lastToolPre.payload as { tool_name?: string; tool_input?: { command?: string } };
  const toolName = payload.tool_name;
  if (!toolName) return null;

  if (toolName === "Bash") {
    const command = payload.tool_input?.command ?? "";
    return /\b(test|spec)\b/i.test(command) ? "TESTING" : "IMPLEMENTING";
  }
  return TOOL_TO_ACTIVITY[toolName] ?? null;
}
