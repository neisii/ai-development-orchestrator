import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { DecisionRecord, DecisionRecordTriggerType } from "./types.js";
import type { EventLogStore } from "./event-log.js";

// docs/data-model.md §7 참고.

export class DecisionRecordStore {
  constructor(
    private readonly db: Database.Database,
    private readonly eventLog: EventLogStore
  ) {}

  /** Scribe Agent의 submit_decision_record 호출이 여기로 들어온다. 즉시 DRAFT로 생성된다(§7.3). */
  create(input: {
    triggerType: DecisionRecordTriggerType;
    triggerQuestionId: string | null;
    triggerAnswerId: string | null;
    background: string;
    problem: string;
    constraints: string;
    options: string;
    optionsComparison: string;
    rationale: string;
    conclusion: string;
    decisionMaker: string;
    relatedInfo: string | null;
  }): DecisionRecord {
    const record: DecisionRecord = {
      id: randomUUID(),
      ...input,
      status: "DRAFT",
      humanReviewer: null,
      reviewReason: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO decision_records
         (id, triggerType, triggerQuestionId, triggerAnswerId, background, problem, constraints, options, optionsComparison, rationale, conclusion, decisionMaker, relatedInfo, status, humanReviewer, reviewReason, createdAt, reviewedAt)
         VALUES
         (@id, @triggerType, @triggerQuestionId, @triggerAnswerId, @background, @problem, @constraints, @options, @optionsComparison, @rationale, @conclusion, @decisionMaker, @relatedInfo, @status, @humanReviewer, @reviewReason, @createdAt, @reviewedAt)`
      )
      .run(record);
    this.eventLog.record({
      agentId: "scribe-agent",
      type: "DECISION_RECORD_CREATED",
      source: "mcp",
      payload: record,
      relatedQuestionId: record.triggerQuestionId,
      relatedAnswerId: record.triggerAnswerId,
    });
    return record;
  }

  get(id: string): DecisionRecord | undefined {
    return this.db.prepare("SELECT * FROM decision_records WHERE id = ?").get(id) as DecisionRecord | undefined;
  }

  listDrafts(): DecisionRecord[] {
    return this.db
      .prepare("SELECT * FROM decision_records WHERE status = 'DRAFT' ORDER BY createdAt")
      .all() as DecisionRecord[];
  }

  list(): DecisionRecord[] {
    return this.db.prepare("SELECT * FROM decision_records ORDER BY createdAt DESC").all() as DecisionRecord[];
  }

  decide(id: string, decision: "APPROVED" | "REJECTED", reviewer: string, reason: string | null): void {
    this.db
      .prepare(
        `UPDATE decision_records SET status = @decision, humanReviewer = @reviewer, reviewReason = @reason, reviewedAt = @reviewedAt WHERE id = @id AND status = 'DRAFT'`
      )
      .run({ id, decision, reviewer, reason, reviewedAt: new Date().toISOString() });
    const record = this.get(id);
    if (record) {
      this.eventLog.record({
        agentId: "scribe-agent",
        type: "DECISION_RECORD_REVIEWED",
        source: "orchestrator",
        payload: { decision, reviewer, reason },
        relatedQuestionId: record.triggerQuestionId,
        relatedAnswerId: record.triggerAnswerId,
      });
    }
  }

  /** 이미 이 Question/Answer에 대해 Decision Record가 만들어졌는지 (같은 트리거 중복 생성 방지). */
  hasRecordForQuestion(questionId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM decision_records WHERE triggerQuestionId = ?").get(questionId);
    return row !== undefined;
  }

  hasRecordForAnswer(answerId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM decision_records WHERE triggerAnswerId = ?").get(answerId);
    return row !== undefined;
  }
}
