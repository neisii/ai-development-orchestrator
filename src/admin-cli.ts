import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { AgentStore, computeActivityLabel } from "./agent-store.js";

// Human이 대기 중인 Question/Answer를 확인하고 승인/거절하고, Event Log와 Agent 상태를
// 조회하는 최소 CLI.
//
// 사용법:
//   npm run admin -- list-questions
//   npm run admin -- decide-question <id> approve
//   npm run admin -- decide-question <id> reject "사유"
//   npm run admin -- list-answers
//   npm run admin -- decide-answer <id> approve
//   npm run admin -- decide-answer <id> reject "사유"
//   npm run admin -- list-events [agentId]
//   npm run admin -- list-agents

const REVIEWER = "human";

const db = openDb();
const eventLog = new EventLogStore(db);
const store = new QaStore(db, eventLog);
const agentStore = new AgentStore(db);

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "list-questions": {
    const pending = store.listPendingQuestions();
    if (pending.length === 0) {
      console.log("대기 중인 질문 없음");
      break;
    }
    for (const q of pending) {
      console.log(`[${q.id}] ${q.fromAgentId} -> ${q.toAgentId}`);
      console.log(`  질문: ${q.text}`);
      console.log(`  근거: ${q.selfJustification}`);
      console.log(`  생성: ${q.createdAt}`);
    }
    break;
  }

  case "decide-question": {
    const [id, decision, reason] = args;
    requireDecisionArgs(id, decision);
    store.decideQuestion(id, decision === "approve" ? "APPROVED" : "REJECTED", REVIEWER, reason ?? null);
    console.log(`질문 ${id} -> ${decision}`);
    break;
  }

  case "list-answers": {
    const pending = store.listPendingAnswers();
    if (pending.length === 0) {
      console.log("대기 중인 답변 없음");
      break;
    }
    for (const a of pending) {
      const q = store.getQuestion(a.questionId);
      console.log(`[${a.id}] questionId=${a.questionId} (${q?.text ?? "질문 정보 없음"})`);
      console.log(`  답변(${a.contentStatus}): ${a.text}`);
      console.log(`  생성: ${a.createdAt}`);
    }
    break;
  }

  case "decide-answer": {
    const [id, decision, reason] = args;
    requireDecisionArgs(id, decision);
    store.decideAnswer(id, decision === "approve" ? "APPROVED" : "REJECTED", REVIEWER, reason ?? null);
    console.log(`답변 ${id} -> ${decision}`);
    break;
  }

  case "list-events": {
    const [agentId] = args;
    const events = eventLog.list({ agentId, limit: 50 });
    if (events.length === 0) {
      console.log("이벤트 없음");
      break;
    }
    for (const e of events) {
      console.log(`[${e.timestamp}] ${e.agentId} ${e.type} (${e.source})`);
    }
    break;
  }

  case "list-agents": {
    const agents = agentStore.list();
    if (agents.length === 0) {
      console.log("등록된 Agent 없음");
      break;
    }
    const pendingQuestions = store.listPendingQuestions();
    for (const a of agents) {
      const activity = computeActivityLabel(eventLog, a.id);
      const waitingOn = pendingQuestions.find((q) => q.fromAgentId === a.id);
      const parts = [
        `[${a.id}] ${a.lifecycleState}`,
        activity ? `(${activity})` : null,
        `session=${a.sessionId ?? "-"}`,
        `pid=${a.pid ?? "-"}`,
        waitingOn ? `Human 승인 대기 중인 질문=${waitingOn.id}` : null,
      ].filter(Boolean);
      console.log(parts.join(" "));
      console.log(`  갱신: ${a.updatedAt}`);
    }
    break;
  }

  default:
    console.log(
      "사용법: list-questions | decide-question <id> approve|reject [reason] | list-answers | decide-answer <id> approve|reject [reason] | list-events [agentId] | list-agents"
    );
}

function requireDecisionArgs(id: string | undefined, decision: string | undefined): asserts id is string {
  if (!id || (decision !== "approve" && decision !== "reject")) {
    console.error("id와 approve|reject가 필요합니다.");
    process.exit(1);
  }
}
