import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { AgentStore } from "./agent-store.js";
import { InterventionStore } from "./intervention-store.js";
import { DecisionRecordStore } from "./decision-record-store.js";
import { DecisionInterventionStore } from "./decision-intervention-store.js";
import { ProcessManager } from "./process-manager.js";
import { Orchestrator } from "./orchestrator.js";
import { startHookServer } from "./hook-server.js";
import { writeAgentHookSettings } from "./agent-settings.js";

// mvp-scope.md "완료 기준(Definition of Done)" 7개를 하나의 시나리오로 잇는 통합 테스트.
// 실제 claude -p 세션과 실제 admin-cli 셸 호출로 진행한다 (Human 행동을 그대로 재현).
//
// 흐름:
//   Phase 1 — api-agent 단독 세션에서 Pause -> Resume -> Direct Instruction 시연 (기준 4, 5)
//   Phase 2 — buyer-bff -> ask_agent -> 승인 -> api-agent 자동 전달 -> answer_question ->
//             승인 -> buyer-bff 자동 전달 (기준 1, 2, 3). MCP 도구 호출 자체가 hook을
//             발동시키므로 Event Log(기준 6)도 이 과정에서 함께 채워진다.
//   Phase 3 — Stop 시연 (기준 4 마무리, 이미 idle이라 API 비용 없음)
//   각 단계 사이사이 admin-cli list-agents로 실시간 상태 확인 (기준 7)
//   마지막에 Event Log를 타입별로 집계 (기준 6 최종 확인)

const workDir = mkdtempSync(join(tmpdir(), "ado-mvp-e2e-"));
const dbPath = join(workDir, "data.db");
const mcpServerPath = new URL("./mcp-server.ts", import.meta.url).pathname;
const buyerSettingsPath = join(workDir, "buyer-bff-settings.json");
const apiSettingsPath = join(workDir, "api-agent-settings.json");
const hookPort = 8788;

process.env.ORCHESTRATOR_DB_PATH = dbPath; // admin-cli 셸 호출도 같은 DB를 보게 한다

// Agent마다 별도 mcp-config 파일을 쓴다 — ORCHESTRATOR_AGENT_ID로 신원을 검증하므로
// (architecture.md §16) Agent별 값이 필요해 예전처럼 파일 하나를 공유할 수 없다.
function writeMcpConfig(agentId: string): string {
  const path = join(workDir, `${agentId}-mcp-config.json`);
  writeFileSync(
    path,
    JSON.stringify({
      mcpServers: {
        orchestrator: {
          command: "npx",
          args: ["tsx", mcpServerPath],
          env: { ORCHESTRATOR_DB_PATH: dbPath, ORCHESTRATOR_AGENT_ID: agentId },
        },
      },
    })
  );
  return path;
}

console.log("workDir:", workDir);

const hookServer = startHookServer(hookPort, dbPath);
writeAgentHookSettings(buyerSettingsPath, "buyer-bff", `http://127.0.0.1:${hookPort}/events`);
writeAgentHookSettings(apiSettingsPath, "api-agent", `http://127.0.0.1:${hookPort}/events`);

const db = openDb(dbPath);
const eventLog = new EventLogStore(db);
const store = new QaStore(db, eventLog);
const agentStore = new AgentStore(db);
const interventionStore = new InterventionStore(db);
const decisionRecords = new DecisionRecordStore(db, eventLog);
const decisionInterventions = new DecisionInterventionStore(db, eventLog);
const orchestrator = new Orchestrator(
  store,
  agentStore,
  eventLog,
  interventionStore,
  decisionRecords,
  decisionInterventions,
  1500
);

function makeAgent(id: string, tool: "ask_agent" | "answer_question", settingsPath: string): ProcessManager {
  const projectPath = mkdtempSync(join(tmpdir(), `ado-mvp-e2e-${id}-`));
  const pm = new ProcessManager({
    id,
    projectPath,
    mcpConfigPath: writeMcpConfig(id),
    settingsPath,
    allowedTools: [`mcp__orchestrator__${tool}`],
  });
  pm.on("lifecycle-change", (s) => console.log(`[${id}] lifecycle -> ${s}`));
  return pm;
}

const buyerBff = makeAgent("buyer-bff", "ask_agent", buyerSettingsPath);
const apiAgent = makeAgent("api-agent", "answer_question", apiSettingsPath);
orchestrator.registerAgent(buyerBff);
orchestrator.registerAgent(apiAgent);
const pollTimer = orchestrator.startPolling();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function admin(...args: string[]): void {
  execSync(`npx tsx src/admin-cli.ts ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
    stdio: "inherit",
  });
}

function listAgents(label: string): void {
  console.log(`\n>>> [기준 7: Agent 상태] ${label}`);
  admin("list-agents");
}

async function waitForPmState(pm: ProcessManager, states: string[], timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (states.includes(pm.getState().lifecycleState)) return;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${pm.id} in ${states.join("|")}, currently ${pm.getState().lifecycleState}`);
}

async function waitUntil<T>(fn: () => T | undefined, timeoutMs = 60000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v !== undefined) return v;
    await sleep(intervalMs);
  }
  throw new Error("waitUntil timed out");
}

async function main() {
  console.log("\n========== Phase 1: api-agent Pause -> Resume -> Direct Instruction (기준 4, 5) ==========");
  apiAgent.start(
    "Write a detailed 500-word analysis of Approach A for investigating a database schema question. " +
      "Do not use any tools. When Approach A is complete, immediately continue with a detailed 500-word " +
      "analysis of Approach B for the same investigation, still without tools."
  );
  await waitForPmState(apiAgent, ["RUNNING"]);
  await sleep(2000);

  listAgents("api-agent가 Approach A 작성 중");
  console.log(">>> admin-cli pause-agent api-agent");
  admin("pause-agent", "api-agent");
  await waitForPmState(apiAgent, ["PAUSED"]);
  listAgents("pause 적용 직후");

  console.log(">>> admin-cli resume-agent api-agent (일반 재개)");
  admin("resume-agent", "api-agent", "계속 진행해줘, 분석을 이어서 작성해줘.");
  await waitForPmState(apiAgent, ["RUNNING"]);
  await sleep(2000);

  console.log(">>> admin-cli instruct-agent api-agent (Direct Instruction)");
  admin("instruct-agent", "api-agent", "그만 작성하고, 정확히 '분석-중단됨'이라고만 답해줘. 다른 말은 하지 마.");
  await waitForPmState(apiAgent, ["COMPLETED", "FAILED"], 60000);
  console.log(">>> Phase 1 최종 상태:", apiAgent.getState());

  console.log("\n========== Phase 2: 전체 Q&A 왕복 (기준 1, 2, 3, 6) ==========");
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

  const question = await waitUntil(() => store.listPendingQuestions()[0]);
  console.log(">>> 질문 도착:", question.text);
  listAgents("buyer-bff가 질문을 낸 직후");

  console.log(">>> admin-cli decide-question approve");
  admin("decide-question", question.id, "approve");

  const answer = await waitUntil(() => store.listPendingAnswers()[0]);
  console.log(">>> 답변 도착:", answer.text, `(${answer.contentStatus})`);
  listAgents("api-agent가 답변한 직후");

  console.log(">>> admin-cli decide-answer approve");
  awaitingSecondTurn = true;
  admin("decide-answer", answer.id, "approve");

  await waitUntil(() => (secondTurnCompleted ? true : undefined), 60000);
  console.log(">>> buyer-bff 최종 상태:", buyerBff.getState());

  console.log("\n========== Phase 3: Stop (기준 4 마무리, API 비용 없음) ==========");
  console.log(">>> admin-cli stop-agent buyer-bff (이미 idle)");
  admin("stop-agent", "buyer-bff");
  await waitForPmState(buyerBff, ["STOPPED"], 5000);
  listAgents("최종");

  console.log("\n========== 기준 6: Event Log 타입별 집계 ==========");
  const allEvents = eventLog.list({ limit: 200 });
  const counts = new Map<string, number>();
  for (const e of allEvents) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  for (const [type, count] of [...counts.entries()].sort()) {
    console.log(`  ${type}: ${count}`);
  }

  hookServer.close();
  clearInterval(pollTimer);
}

main().catch((err) => {
  hookServer.close();
  clearInterval(pollTimer);
  console.error(err);
  process.exit(1);
});
