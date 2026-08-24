import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { DecisionInterventionRequest } from "./types.js";
import type { EventLogStore } from "./event-log.js";

// phase3-scope.md §1.2 / requirements.md §12.4 참고.
// Question/Answer 거절과 달리 밑에 깔린 도구 호출이 없다 — Human이 admin-cli(decide-choice)로
// A안/B안 선택 결과를 곧바로 기록하면, 이 요청이 Orchestrator.triggerDecisionRecords()의
// 새 트리거 후보가 된다.

export class DecisionInterventionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly eventLog: EventLogStore
  ) {}

  request(input: {
    agentId: string;
    chosenOption: string;
    rejectedOptions: string;
    reasoning: string;
    requestedBy: string;
  }): DecisionInterventionRequest {
    const record: DecisionInterventionRequest = {
      id: randomUUID(),
      ...input,
      requestedAt: new Date().toISOString(),
      dispatchedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO decision_intervention_requests
         (id, agentId, chosenOption, rejectedOptions, reasoning, requestedBy, requestedAt, dispatchedAt)
         VALUES (@id, @agentId, @chosenOption, @rejectedOptions, @reasoning, @requestedBy, @requestedAt, @dispatchedAt)`
      )
      .run(record);
    this.eventLog.record({
      agentId: record.agentId,
      type: "DECISION_INTERVENTION_REQUESTED",
      source: "orchestrator",
      payload: record,
    });
    return record;
  }

  get(id: string): DecisionInterventionRequest | undefined {
    return this.db.prepare("SELECT * FROM decision_intervention_requests WHERE id = ?").get(id) as
      | DecisionInterventionRequest
      | undefined;
  }

  list(): DecisionInterventionRequest[] {
    return this.db
      .prepare("SELECT * FROM decision_intervention_requests ORDER BY requestedAt DESC")
      .all() as DecisionInterventionRequest[];
  }

  markDispatched(id: string): void {
    this.db
      .prepare("UPDATE decision_intervention_requests SET dispatchedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }
}
