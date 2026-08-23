import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AnswerContentStatus,
  AnswerReviewStatus,
  Question,
  QuestionStatus,
  Answer,
} from "./types.js";

// docs/data-model.md §3.2, §4.3 참고.
// SQLite에는 pub/sub이 없으므로 "결정될 때까지 대기"는 폴링으로 구현한다.
// architecture.md §4.1에서 MCP 도구 응답을 5분 넘게 들고 있어도 문제없다는 게 실측됐으므로
// 이 폴링 방식의 대기 시간 자체는 안전하다.

const POLL_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class QaStore {
  constructor(private readonly db: Database.Database) {}

  createQuestion(input: {
    fromAgentId: string;
    toAgentId: string;
    text: string;
    selfJustification: string;
  }): Question {
    const question: Question = {
      id: randomUUID(),
      ...input,
      status: "PENDING_HUMAN_REVIEW",
      humanReviewer: null,
      reviewReason: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      deliveredAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO questions (id, fromAgentId, toAgentId, text, selfJustification, status, humanReviewer, reviewReason, createdAt, reviewedAt, deliveredAt)
         VALUES (@id, @fromAgentId, @toAgentId, @text, @selfJustification, @status, @humanReviewer, @reviewReason, @createdAt, @reviewedAt, @deliveredAt)`
      )
      .run(question);
    return question;
  }

  getQuestion(id: string): Question | undefined {
    return this.db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as Question | undefined;
  }

  listPendingQuestions(): Question[] {
    return this.db
      .prepare("SELECT * FROM questions WHERE status = 'PENDING_HUMAN_REVIEW' ORDER BY createdAt")
      .all() as Question[];
  }

  /** Human의 승인/거절. §3.2: 거절 시 reviewReason이 곧 ask_agent 호출의 반환값이 된다. */
  decideQuestion(id: string, decision: "APPROVED" | "REJECTED", reviewer: string, reason: string | null): void {
    this.db
      .prepare(
        `UPDATE questions SET status = @decision, humanReviewer = @reviewer, reviewReason = @reason, reviewedAt = @reviewedAt WHERE id = @id AND status = 'PENDING_HUMAN_REVIEW'`
      )
      .run({ id, decision, reviewer, reason, reviewedAt: new Date().toISOString() });
  }

  /** 질문이 결정(APPROVED/REJECTED)될 때까지, 또는 timeoutMs를 넘길 때까지 폴링한다. */
  async waitForQuestionDecision(id: string, timeoutMs = 10 * 60 * 1000): Promise<Question> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const q = this.getQuestion(id);
      if (!q) throw new Error(`Question ${id} not found`);
      if (q.status !== "PENDING_HUMAN_REVIEW") return q;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Question ${id} was not reviewed within ${timeoutMs}ms`);
  }

  /** 승인됐지만 아직 대상 Agent에게 전달되지 않은 질문들. Orchestrator의 전달 루프가 사용한다. */
  listUndeliveredApprovedQuestions(): Question[] {
    return this.db
      .prepare("SELECT * FROM questions WHERE status = 'APPROVED' ORDER BY reviewedAt")
      .all() as Question[];
  }

  /** §3.2: APPROVED --> DELIVERED */
  markQuestionDelivered(id: string): void {
    this.db
      .prepare(`UPDATE questions SET status = 'DELIVERED', deliveredAt = ? WHERE id = ? AND status = 'APPROVED'`)
      .run(new Date().toISOString(), id);
  }

  createAnswer(input: {
    questionId: string;
    fromAgentId: string;
    text: string;
    contentStatus: AnswerContentStatus;
  }): Answer {
    const answer: Answer = {
      id: randomUUID(),
      ...input,
      reviewStatus: "PENDING_HUMAN_REVIEW",
      humanReviewer: null,
      reviewReason: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      deliveredAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO answers (id, questionId, fromAgentId, text, contentStatus, reviewStatus, humanReviewer, reviewReason, createdAt, reviewedAt, deliveredAt)
         VALUES (@id, @questionId, @fromAgentId, @text, @contentStatus, @reviewStatus, @humanReviewer, @reviewReason, @createdAt, @reviewedAt, @deliveredAt)`
      )
      .run(answer);
    // 답변이 제출됐다는 것 자체를 질문 쪽 상태에도 반영한다 (§3.2: DELIVERED --> ANSWERED).
    this.db
      .prepare(`UPDATE questions SET status = 'ANSWERED' WHERE id = ? AND status IN ('DELIVERED', 'APPROVED')`)
      .run(input.questionId);
    return answer;
  }

  getAnswer(id: string): Answer | undefined {
    return this.db.prepare("SELECT * FROM answers WHERE id = ?").get(id) as Answer | undefined;
  }

  listPendingAnswers(): Answer[] {
    return this.db
      .prepare("SELECT * FROM answers WHERE reviewStatus = 'PENDING_HUMAN_REVIEW' ORDER BY createdAt")
      .all() as Answer[];
  }

  decideAnswer(id: string, decision: "APPROVED" | "REJECTED", reviewer: string, reason: string | null): void {
    this.db
      .prepare(
        `UPDATE answers SET reviewStatus = @decision, humanReviewer = @reviewer, reviewReason = @reason, reviewedAt = @reviewedAt WHERE id = @id AND reviewStatus = 'PENDING_HUMAN_REVIEW'`
      )
      .run({ id, decision, reviewer, reason, reviewedAt: new Date().toISOString() });
  }

  async waitForAnswerDecision(id: string, timeoutMs = 10 * 60 * 1000): Promise<Answer> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const a = this.getAnswer(id);
      if (!a) throw new Error(`Answer ${id} not found`);
      if (a.reviewStatus !== "PENDING_HUMAN_REVIEW") return a;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Answer ${id} was not reviewed within ${timeoutMs}ms`);
  }

  /** 승인됐지만 아직 질문한 Agent에게 전달되지 않은 답변들. */
  listUndeliveredApprovedAnswers(): Answer[] {
    return this.db
      .prepare("SELECT * FROM answers WHERE reviewStatus = 'APPROVED' ORDER BY reviewedAt")
      .all() as Answer[];
  }

  /** §4.3: APPROVED --> DELIVERED, 그리고 연결된 Question은 §3.2: ANSWERED --> CLOSED */
  markAnswerDelivered(id: string): void {
    const answer = this.getAnswer(id);
    if (!answer) return;
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE answers SET reviewStatus = 'DELIVERED', deliveredAt = ? WHERE id = ? AND reviewStatus = 'APPROVED'`)
      .run(now, id);
    this.db
      .prepare(`UPDATE questions SET status = 'CLOSED' WHERE id = ? AND status = 'ANSWERED'`)
      .run(answer.questionId);
  }
}

export type { QuestionStatus, AnswerReviewStatus };
