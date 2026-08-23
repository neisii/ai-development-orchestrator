import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { AgentStore, computeActivityLabel } from "./agent-store.js";
import { InterventionStore } from "./intervention-store.js";

// Human이 대기 중인 Question/Answer를 확인하고 승인/거절하고, Event Log와 Agent 상태를
// 조회하고, Agent에 개입(pause/resume/stop/직접 지시)하는 최소 CLI.
//
// pause-agent/resume-agent/stop-agent/instruct-agent는 실행 중인 Orchestrator 프로세스가
// 폴링하며 실제로 적용한다 — 이 CLI는 "개입 요청"만 DB에 남긴다(Question/Answer 승인과 같은 패턴).
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
//   npm run admin -- pause-agent <agentId>
//   npm run admin -- resume-agent <agentId> [prompt]
//   npm run admin -- stop-agent <agentId>
//   npm run admin -- instruct-agent <agentId> <prompt>

const REVIEWER = "human";

const db = openDb();
const eventLog = new EventLogStore(db);
const store = new QaStore(db, eventLog);
const agentStore = new AgentStore(db);
const interventionStore = new InterventionStore(db);

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

  case "pause-agent": {
    const [agentId] = args;
    requireAgentId(agentId);
    interventionStore.request(agentId, "PAUSE", null, REVIEWER);
    console.log(`${agentId} pause 요청됨 (Orchestrator가 다음 polling에서 적용)`);
    break;
  }

  case "resume-agent": {
    const [agentId, ...promptParts] = args;
    requireAgentId(agentId);
    const prompt = promptParts.join(" ") || null;
    interventionStore.request(agentId, "RESUME", prompt, REVIEWER);
    console.log(`${agentId} resume 요청됨`);
    break;
  }

  case "stop-agent": {
    const [agentId] = args;
    requireAgentId(agentId);
    interventionStore.request(agentId, "STOP", null, REVIEWER);
    console.log(`${agentId} stop 요청됨`);
    break;
  }

  case "instruct-agent": {
    const [agentId, ...promptParts] = args;
    const prompt = promptParts.join(" ");
    requireAgentId(agentId);
    if (!prompt) {
      console.error("지시할 프롬프트가 필요합니다.");
      process.exit(1);
    }
    // requirements.md §12.2 Direct Instruction: 지금 도는 턴을 끊고(PAUSE) 그 위에 새 지시를 얹어
    // 재개(RESUME)한다. 이미 한가한 Agent라면 PAUSE는 아무 효과 없이 넘어가고 RESUME만 적용된다.
    interventionStore.request(agentId, "PAUSE", null, REVIEWER);
    interventionStore.request(agentId, "RESUME", prompt, REVIEWER);
    console.log(`${agentId}에게 직접 지시 요청됨: ${prompt}`);
    break;
  }

  default:
    console.log(
      "사용법: list-questions | decide-question <id> approve|reject [reason] | list-answers | decide-answer <id> approve|reject [reason] | " +
        "list-events [agentId] | list-agents | pause-agent <id> | resume-agent <id> [prompt] | stop-agent <id> | instruct-agent <id> <prompt>"
    );
}

function requireDecisionArgs(id: string | undefined, decision: string | undefined): asserts id is string {
  if (!id || (decision !== "approve" && decision !== "reject")) {
    console.error("id와 approve|reject가 필요합니다.");
    process.exit(1);
  }
}

function requireAgentId(agentId: string | undefined): asserts agentId is string {
  if (!agentId) {
    console.error("agentId가 필요합니다.");
    process.exit(1);
  }
}
