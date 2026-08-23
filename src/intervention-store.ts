import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Intervention, InterventionKind } from "./types.js";

// docs/requirements.md §12 / docs/architecture.md §5 참고.
// admin-cli 같은 별도 프로세스는 살아있는 ProcessManager에 직접 접근할 수 없으므로,
// Question/Answer 승인과 같은 패턴으로 "개입 요청"만 여기 남기고 Orchestrator가 폴링하며
// 실제로 pause()/resume()/stop()을 실행한다.

export class InterventionStore {
  constructor(private readonly db: Database.Database) {}

  request(agentId: string, kind: InterventionKind, prompt: string | null, requestedBy: string): Intervention {
    const intervention: Intervention = {
      id: randomUUID(),
      agentId,
      kind,
      prompt,
      requestedBy,
      requestedAt: new Date().toISOString(),
      appliedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO interventions (id, agentId, kind, prompt, requestedBy, requestedAt, appliedAt)
         VALUES (@id, @agentId, @kind, @prompt, @requestedBy, @requestedAt, @appliedAt)`
      )
      .run(intervention);
    return intervention;
  }

  /** rowid를 보조 정렬 기준으로 써서, 같은 밀리초에 들어온 PAUSE -> RESUME 순서를 보존한다. */
  listPending(): Intervention[] {
    return this.db
      .prepare("SELECT * FROM interventions WHERE appliedAt IS NULL ORDER BY requestedAt, rowid")
      .all() as Intervention[];
  }

  markApplied(id: string): void {
    this.db.prepare("UPDATE interventions SET appliedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
  }
}
