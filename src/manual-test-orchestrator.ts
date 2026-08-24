import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { AgentStore } from "./agent-store.js";
import { InterventionStore } from "./intervention-store.js";
import { DecisionRecordStore } from "./decision-record-store.js";
import { DecisionInterventionStore } from "./decision-intervention-store.js";
import { ProcessManager } from "./process-manager.js";
import { Orchestrator } from "./orchestrator.js";

// ProcessManager <-> qa-store/mcp-server 통합 전체 왕복을 실제 API 호출로 검증하는 수동 테스트.
// buyer-bff가 ask_agent로 질문 -> (사람 승인 시뮬레이션) -> Orchestrator가 api-agent에게 전달
// -> api-agent가 answer_question으로 답변 -> (사람 승인 시뮬레이션) -> Orchestrator가
// buyer-bff에게 전달 -> buyer-bff가 이어서 응답.

const workDir = mkdtempSync(join(tmpdir(), "ado-orchestrator-test-"));
const dbPath = join(workDir, "data.db");
const mcpConfigPath = join(workDir, "mcp-config.json");
const mcpServerPath = new URL("./mcp-server.ts", import.meta.url).pathname;

writeFileSync(
  mcpConfigPath,
  JSON.stringify({
    mcpServers: {
      orchestrator: {
        command: "npx",
        args: ["tsx", mcpServerPath],
        env: { ORCHESTRATOR_DB_PATH: dbPath },
      },
    },
  })
);

console.log("workDir:", workDir);

const db = openDb(dbPath);
const eventLog = new EventLogStore(db);
const store = new QaStore(db, eventLog);
const orchestrator = new Orchestrator(
  store,
  new AgentStore(db),
  eventLog,
  new InterventionStore(db),
  new DecisionRecordStore(db, eventLog),
  new DecisionInterventionStore(db, eventLog),
  2000
);

function makeAgent(id: string, tool: "ask_agent" | "answer_question"): ProcessManager {
  const projectPath = mkdtempSync(join(tmpdir(), `ado-orchestrator-${id}-`));
  const pm = new ProcessManager({
    id,
    projectPath,
    mcpConfigPath,
    allowedTools: [`mcp__orchestrator__${tool}`],
  });
  pm.on("lifecycle-change", (state) => console.log(`[${id}] lifecycle -> ${state}`));
  pm.on("event", (e) => {
    const raw = e.raw as Record<string, unknown>;
    if (raw.type === "result") {
      console.log(`[${id}] turn result:`, raw.result);
    }
  });
  return pm;
}

const buyerBff = makeAgent("buyer-bff", "ask_agent");
const apiAgent = makeAgent("api-agent", "answer_question");
orchestrator.registerAgent(buyerBff);
orchestrator.registerAgent(apiAgent);

const pollTimer = orchestrator.startPolling();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil<T>(fn: () => T | undefined, timeoutMs = 30000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v !== undefined) return v;
    await sleep(intervalMs);
  }
  throw new Error("waitUntil timed out");
}

async function main() {
  // buyer-bff가 답변 전달을 위해 두 번째로 resume()될 때(RUNNING) -> 그 턴이 끝날 때(COMPLETED)를
  // 질문 승인 직후의 1차 완료와 구분해서 잡아내기 위한 플래그.
  let awaitingSecondTurn = false;
  let secondTurnRunningSeen = false;
  let secondTurnCompleted = false;
  buyerBff.on("lifecycle-change", (state) => {
    if (!awaitingSecondTurn) return;
    if (state === "RUNNING") secondTurnRunningSeen = true;
    if (state === "COMPLETED" && secondTurnRunningSeen) secondTurnCompleted = true;
  });

  buyerBff.start(
    "You are agent 'buyer-bff'. Call the ask_agent tool exactly once: from_agent_id='buyer-bff', " +
      "target_agent_id='api-agent', question='ProductResponse에 재고 수량 필드가 있어?', " +
      "why_needed에 적절한 근거를 적어라. 도구가 반환하는 내용을 그대로 보고해라."
  );

  console.log(">>> 질문이 생성되기를 기다리는 중...");
  const question = await waitUntil(() => store.listPendingQuestions()[0]);
  console.log(">>> 질문 도착:", question.text);

  console.log(">>> (사람 승인 시뮬레이션) 질문 승인");
  store.decideQuestion(question.id, "APPROVED", "human", null);

  console.log(">>> api-agent에게 전달되고 답변이 생성되기를 기다리는 중...");
  const answer = await waitUntil(() => store.listPendingAnswers()[0], 60000);
  console.log(">>> 답변 도착:", answer.text, `(${answer.contentStatus})`);

  console.log(">>> (사람 승인 시뮬레이션) 답변 승인");
  awaitingSecondTurn = true;
  store.decideAnswer(answer.id, "APPROVED", "human", null);

  console.log(">>> buyer-bff에게 답변이 전달되고 최종 응답이 나오기를 기다리는 중...");
  await waitUntil(() => (secondTurnCompleted ? true : undefined), 60000);

  console.log(">>> buyer-bff 최종 상태:", buyerBff.getState());
  console.log(">>> api-agent 최종 상태:", apiAgent.getState());

  clearInterval(pollTimer);
}

main().catch((err) => {
  clearInterval(pollTimer);
  console.error(err);
  process.exit(1);
});
