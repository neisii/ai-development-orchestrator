import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { AgentStore, computeActivityLabel } from "./agent-store.js";
import { InterventionStore } from "./intervention-store.js";
import { DecisionRecordStore } from "./decision-record-store.js";
import { DecisionInterventionStore } from "./decision-intervention-store.js";
import type { DecisionRecord } from "./types.js";

// Human이 대기 중인 Question/Answer를 확인하고 승인/거절하고, Event Log와 Agent 상태를
// 조회하고, Agent에 개입(pause/resume/stop/직접 지시)하고, Decision Record 초안을
// 검토·승인하는 최소 CLI.
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
//   npm run admin -- list-decisions [--all]
//   npm run admin -- show-decision <id>
//   npm run admin -- decide-decision <id> approve
//   npm run admin -- decide-decision <id> reject "사유"
//   npm run admin -- decide-choice <agentId> "<선택한 안>" "<기각된 안>" "<근거>"
//   npm run admin -- search-decisions <keyword>
//   npm run admin -- show-decisions-for-file <path>

const REVIEWER = "human";

// DB에는 그대로 UTC(ISO 8601)로 저장한다 — 정렬/비교에 안전하고 다른 프로세스와 공유하기도
// 쉽다. 여기 admin-cli는 사람이 직접 읽는 화면이라 표시할 때만 KST로 바꾼다(§1의 "원시 데이터와
// 파생 표시를 분리한다" 원칙과 같은 방식 — 저장 형식과 표시 형식을 섞지 않는다).
function formatKst(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const timePart = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false });
  return `${datePart} ${timePart} KST`;
}

const db = openDb();
const eventLog = new EventLogStore(db);
const store = new QaStore(db, eventLog);
const agentStore = new AgentStore(db);
const interventionStore = new InterventionStore(db);
const decisionRecords = new DecisionRecordStore(db, eventLog);
const decisionInterventions = new DecisionInterventionStore(db, eventLog);

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
      console.log(`  생성: ${formatKst(q.createdAt)}`);
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
      console.log(`  생성: ${formatKst(a.createdAt)}`);
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
      console.log(`[${formatKst(e.timestamp)}] ${e.agentId} ${e.type} (${e.source})`);
      if (e.type === "ASSISTANT_MESSAGE") {
        const text = (e.payload as { text?: string }).text ?? "";
        console.log(`  ${text.length > 200 ? text.slice(0, 200) + "..." : text}`);
      }
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
      console.log(`  갱신: ${formatKst(a.updatedAt)}`);
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

  case "list-decisions": {
    const showAll = args.includes("--all");
    const records = showAll ? decisionRecords.list() : decisionRecords.listDrafts();
    if (records.length === 0) {
      console.log(showAll ? "Decision Record 없음" : "대기 중인 Decision Record 없음");
      break;
    }
    for (const r of records) {
      console.log(`[${r.id}] ${r.status} (${r.triggerType})`);
      console.log(`  결론: ${r.conclusion}`);
      console.log(`  생성: ${formatKst(r.createdAt)}`);
    }
    break;
  }

  case "show-decision": {
    const [id] = args;
    requireId(id);
    const r = decisionRecords.get(id);
    if (!r) {
      console.error(`decision_record ${id}를 찾을 수 없습니다.`);
      process.exit(1);
    }
    printDecisionRecord(r);
    break;
  }

  case "decide-decision": {
    const [id, decision, reason] = args;
    requireDecisionArgs(id, decision);
    decisionRecords.decide(id, decision === "approve" ? "APPROVED" : "REJECTED", REVIEWER, reason ?? null);
    if (decision === "approve") {
      console.log(`Decision Record ${id} -> APPROVED`);
    } else {
      console.log(`Decision Record ${id} -> REVISING (Scribe가 사유를 반영해 같은 레코드를 다시 작성합니다)`);
    }
    break;
  }

  // phase3-scope.md §1.2: requirements.md §12.4 Decision Intervention. Agent가 제안한 A안/B안
  // 중 Human이 고른 결과를 기록하면, Orchestrator가 다음 polling에서 Scribe를 깨워 초안을 만든다.
  case "decide-choice": {
    const [agentId, chosenOption, rejectedOptions, reasoning] = args;
    if (!agentId || !chosenOption || !rejectedOptions || !reasoning) {
      console.error('agentId, "선택한 안", "기각된 안", "근거"가 모두 필요합니다.');
      process.exit(1);
    }
    const iv = decisionInterventions.request({ agentId, chosenOption, rejectedOptions, reasoning, requestedBy: REVIEWER });
    console.log(`${agentId}의 Decision Intervention 기록됨 (id: ${iv.id}) — 다음 polling에서 Scribe에게 전달됩니다.`);
    break;
  }

  case "search-decisions": {
    const [keyword] = args;
    if (!keyword) {
      console.error("keyword가 필요합니다.");
      process.exit(1);
    }
    const records = decisionRecords.search(keyword);
    if (records.length === 0) {
      console.log(`"${keyword}"와 일치하는 Decision Record 없음`);
      break;
    }
    for (const r of records) {
      console.log(`[${r.id}] ${r.status} (${r.triggerType})`);
      console.log(`  결론: ${r.conclusion}`);
      console.log(`  생성: ${formatKst(r.createdAt)}`);
    }
    break;
  }

  case "show-decisions-for-file": {
    const [path] = args;
    if (!path) {
      console.error("path가 필요합니다.");
      process.exit(1);
    }
    const records = decisionRecords.listByFilePath(path);
    if (records.length === 0) {
      console.log(`"${path}"와 관련된 Decision Record 없음`);
      break;
    }
    for (const r of records) {
      printDecisionRecord(r);
    }
    break;
  }

  default:
    console.log(
      "사용법: list-questions | decide-question <id> approve|reject [reason] | list-answers | decide-answer <id> approve|reject [reason] | " +
        "list-events [agentId] | list-agents | pause-agent <id> | resume-agent <id> [prompt] | stop-agent <id> | instruct-agent <id> <prompt> | " +
        "list-decisions [--all] | show-decision <id> | decide-decision <id> approve|reject [reason] | " +
        'decide-choice <agentId> "<선택한 안>" "<기각된 안>" "<근거>" | search-decisions <keyword> | show-decisions-for-file <path>'
    );
}

function printDecisionRecord(r: DecisionRecord): void {
  console.log(`# Decision Record ${r.id} (${r.status})\n`);
  console.log(`## 배경\n${r.background}\n`);
  console.log(`## 문제\n${r.problem}\n`);
  console.log(`## 제약사항\n${r.constraints}\n`);
  console.log(`## 선택지\n${r.options}\n`);
  console.log(`## 선택지 비교\n${r.optionsComparison}\n`);
  console.log(`## 판단 근거\n${r.rationale}\n`);
  console.log(`## 결론\n${r.conclusion}\n`);
  console.log(`## 결정 주체\n${r.decisionMaker}\n`);
  if (r.relatedInfo) console.log(`## 관련 정보\n${r.relatedInfo}\n`);
  if (r.relatedFilePaths.length > 0) console.log(`## 관련 파일\n${r.relatedFilePaths.join("\n")}\n`);
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

function requireId(id: string | undefined): asserts id is string {
  if (!id) {
    console.error("id가 필요합니다.");
    process.exit(1);
  }
}
