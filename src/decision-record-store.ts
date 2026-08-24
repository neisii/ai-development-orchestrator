import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { DecisionRecord, DecisionRecordTriggerType } from "./types.js";
import type { EventLogStore } from "./event-log.js";

// docs/data-model.md §7 / docs/phase3-scope.md 참고.

type DecisionRecordRow = Omit<DecisionRecord, "relatedFilePaths"> & { relatedFilePaths: string };

function rowToRecord(row: DecisionRecordRow): DecisionRecord {
  return { ...row, relatedFilePaths: JSON.parse(row.relatedFilePaths) };
}

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
    triggerDecisionInterventionId: string | null;
    background: string;
    problem: string;
    constraints: string;
    options: string;
    optionsComparison: string;
    rationale: string;
    conclusion: string;
    decisionMaker: string;
    relatedInfo: string | null;
    relatedFilePaths: string[];
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
         (id, triggerType, triggerQuestionId, triggerAnswerId, triggerDecisionInterventionId, background, problem, constraints, options, optionsComparison, rationale, conclusion, decisionMaker, relatedInfo, relatedFilePaths, status, humanReviewer, reviewReason, createdAt, reviewedAt)
         VALUES
         (@id, @triggerType, @triggerQuestionId, @triggerAnswerId, @triggerDecisionInterventionId, @background, @problem, @constraints, @options, @optionsComparison, @rationale, @conclusion, @decisionMaker, @relatedInfo, @relatedFilePaths, @status, @humanReviewer, @reviewReason, @createdAt, @reviewedAt)`
      )
      .run({ ...record, relatedFilePaths: JSON.stringify(record.relatedFilePaths) });
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

  /**
   * phase3-scope.md §2: 거절은 종단이 아니다. REVISING 상태의 레코드를 Scribe가 사유를 반영해
   * 고친 뒤 submit_decision_record(revising_decision_record_id)로 재제출하면, 새 레코드가
   * 아니라 이 메서드가 같은 레코드를 갱신하고 status를 DRAFT로 되돌려 다시 Human 승인을 받게 한다.
   */
  update(
    id: string,
    input: {
      background: string;
      problem: string;
      constraints: string;
      options: string;
      optionsComparison: string;
      rationale: string;
      conclusion: string;
      decisionMaker: string;
      relatedInfo: string | null;
      relatedFilePaths: string[];
    }
  ): DecisionRecord | undefined {
    const result = this.db
      .prepare(
        `UPDATE decision_records SET
           background = @background, problem = @problem, constraints = @constraints,
           options = @options, optionsComparison = @optionsComparison, rationale = @rationale,
           conclusion = @conclusion, decisionMaker = @decisionMaker, relatedInfo = @relatedInfo,
           relatedFilePaths = @relatedFilePaths, status = 'DRAFT',
           humanReviewer = NULL, reviewReason = NULL, reviewedAt = NULL
         WHERE id = @id AND status = 'REVISING'`
      )
      .run({ ...input, relatedFilePaths: JSON.stringify(input.relatedFilePaths), id });
    if (result.changes === 0) return undefined;
    const record = this.get(id)!;
    this.eventLog.record({
      agentId: "scribe-agent",
      type: "DECISION_RECORD_REVISED",
      source: "mcp",
      payload: record,
      relatedQuestionId: record.triggerQuestionId,
      relatedAnswerId: record.triggerAnswerId,
    });
    return record;
  }

  get(id: string): DecisionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM decision_records WHERE id = ?").get(id) as
      | DecisionRecordRow
      | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  listDrafts(): DecisionRecord[] {
    return (
      this.db.prepare("SELECT * FROM decision_records WHERE status = 'DRAFT' ORDER BY createdAt").all() as DecisionRecordRow[]
    ).map(rowToRecord);
  }

  /** phase3-scope.md §2: Scribe가 재작성해야 할, 거절되어 REVISING 상태인 레코드들. */
  listPendingRevisions(): DecisionRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM decision_records WHERE status = 'REVISING' ORDER BY reviewedAt")
        .all() as DecisionRecordRow[]
    ).map(rowToRecord);
  }

  list(): DecisionRecord[] {
    return (
      this.db.prepare("SELECT * FROM decision_records ORDER BY createdAt DESC").all() as DecisionRecordRow[]
    ).map(rowToRecord);
  }

  /**
   * phase3-scope.md §2: REJECTED가 없다. 거절 시 REVISING으로 돌아가 Scribe가 사유를 받고
   * 같은 레코드를 다시 쓸 기회를 준다.
   */
  decide(id: string, decision: "APPROVED" | "REJECTED", reviewer: string, reason: string | null): void {
    const status = decision === "APPROVED" ? "APPROVED" : "REVISING";
    this.db
      .prepare(
        `UPDATE decision_records SET status = @status, humanReviewer = @reviewer, reviewReason = @reason, reviewedAt = @reviewedAt WHERE id = @id AND status = 'DRAFT'`
      )
      .run({ id, status, reviewer, reason, reviewedAt: new Date().toISOString() });
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

  /** 이미 이 Question/Answer/Decision Intervention에 대해 Decision Record가 만들어졌는지 (같은 트리거 중복 생성 방지). */
  hasRecordForQuestion(questionId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM decision_records WHERE triggerQuestionId = ?").get(questionId);
    return row !== undefined;
  }

  hasRecordForAnswer(answerId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM decision_records WHERE triggerAnswerId = ?").get(answerId);
    return row !== undefined;
  }

  hasRecordForDecisionIntervention(interventionId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM decision_records WHERE triggerDecisionInterventionId = ?")
      .get(interventionId);
    return row !== undefined;
  }

  /** phase3-scope.md §3.1: 임베딩/의미 검색이 아니라 단순 텍스트 검색이다. */
  search(keyword: string): DecisionRecord[] {
    const pattern = `%${keyword}%`;
    return (
      this.db
        .prepare(
          `SELECT * FROM decision_records
           WHERE background LIKE @pattern OR problem LIKE @pattern OR conclusion LIKE @pattern OR relatedInfo LIKE @pattern
           ORDER BY createdAt DESC`
        )
        .all({ pattern }) as DecisionRecordRow[]
    ).map(rowToRecord);
  }

  /** phase3-scope.md §4.1: 특정 파일 경로와 관련된 Decision Record를 역으로 찾는다. */
  listByFilePath(path: string): DecisionRecord[] {
    const pattern = `%${JSON.stringify(path)}%`;
    return (
      this.db
        .prepare(`SELECT * FROM decision_records WHERE relatedFilePaths LIKE @pattern ORDER BY createdAt DESC`)
        .all({ pattern }) as DecisionRecordRow[]
    )
      .map(rowToRecord)
      .filter((r) => r.relatedFilePaths.includes(path));
  }
}
