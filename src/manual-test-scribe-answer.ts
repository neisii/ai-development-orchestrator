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
import { ProcessManager } from "./process-manager.js";
import { Orchestrator } from "./orchestrator.js";

// data-model.md §7.2의 두 트리거 중 아직 실행 검증이 안 됐던 ANSWER_REJECTED 경로를 확인한다.
// buyer-bff가 질문 -> 승인 -> api-agent가 답변 -> 이번엔 "답변"을 사유와 함께 거절 ->
// Scribe Agent 자동 기상 -> Decision Record 초안 -> 승인.

const workDir = mkdtempSync(join(tmpdir(), "ado-scribe-answer-test-"));
const dbPath = join(workDir, "data.db");
const mcpConfigPath = join(workDir, "mcp-config.json");
const mcpServerPath = new URL("./mcp-server.ts", import.meta.url).pathname;

process.env.ORCHESTRATOR_DB_PATH = dbPath;

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
const agentStore = new AgentStore(db);
const interventionStore = new InterventionStore(db);
const decisionRecords = new DecisionRecordStore(db, eventLog);
const orchestrator = new Orchestrator(store, agentStore, eventLog, interventionStore, decisionRecords, 1500);

function makeAgent(id: string, tool: string): ProcessManager {
  const projectPath = mkdtempSync(join(tmpdir(), `ado-scribe-answer-${id}-`));
  const pm = new ProcessManager({
    id,
    projectPath,
    mcpConfigPath,
    allowedTools: [`mcp__orchestrator__${tool}`],
  });
  pm.on("lifecycle-change", (s) => console.log(`[${id}] lifecycle -> ${s}`));
  return pm;
}

const buyerBff = makeAgent("buyer-bff", "ask_agent");
const apiAgent = makeAgent("api-agent", "answer_question");
const scribe = makeAgent("scribe-agent", "submit_decision_record");
orchestrator.registerAgent(buyerBff);
orchestrator.registerAgent(apiAgent);
orchestrator.registerScribe(scribe);
const pollTimer = orchestrator.startPolling();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function admin(...args: string[]): void {
  execSync(`npx tsx src/admin-cli.ts ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
    stdio: "inherit",
  });
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

async function waitForPmState(pm: ProcessManager, states: string[], timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (states.includes(pm.getState().lifecycleState)) return;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${pm.id} in ${states.join("|")}, currently ${pm.getState().lifecycleState}`);
}

async function main() {
  buyerBff.start(
    "You are agent 'buyer-bff'. Call the ask_agent tool exactly once: from_agent_id='buyer-bff', " +
      "target_agent_id='api-agent', question='ProductResponse에 할인율 필드가 있어?', " +
      "why_needed에 적절한 근거를 적어라. 도구가 반환하는 내용을 그대로 보고해라."
  );

  const question = await waitUntil(() => store.listPendingQuestions()[0]);
  console.log(">>> 질문 도착:", question.text);

  console.log(">>> admin-cli decide-question approve (질문은 승인)");
  admin("decide-question", question.id, "approve");

  const answer = await waitUntil(() => store.listPendingAnswers()[0], 60000);
  console.log(">>> 답변 도착:", answer.text, `(${answer.contentStatus})`);

  console.log(">>> admin-cli decide-answer reject (사유 포함) — 이번 테스트의 핵심");
  admin(
    "decide-answer",
    answer.id,
    "reject",
    "할인율은 PricingResponse에서 내려주는 필드라 ProductResponse에서 답할 사항이 아님. 잘못된 응답 대상."
  );

  console.log(">>> Scribe Agent가 자동으로 깨어나 Decision Record 초안을 쓰기를 기다리는 중...");
  await waitForPmState(scribe, ["RUNNING"]);
  console.log(">>> scribe-agent RUNNING 확인");
  await waitForPmState(scribe, ["COMPLETED", "FAILED"]);
  console.log(">>> scribe-agent 최종 상태:", scribe.getState());

  const draft = await waitUntil(() => decisionRecords.listDrafts()[0], 10000);
  console.log(">>> admin-cli show-decision (trigger_type 확인 포함)");
  admin("show-decision", draft.id);
  console.log(">>> DB상 triggerType:", decisionRecords.get(draft.id)?.triggerType);
  console.log(">>> DB상 triggerAnswerId:", decisionRecords.get(draft.id)?.triggerAnswerId);

  console.log(">>> admin-cli decide-decision approve");
  admin("decide-decision", draft.id, "approve");

  clearInterval(pollTimer);
}

main()
  .then(() => {
    // clearInterval 후에도 이벤트 루프가 자연 종료되지 않는 경우가 재현됐다(architecture.md §13.4).
    // 원인은 특정하지 못했고 좀비 프로세스가 남는 것도 아니라서, 검증 자체는 끝났으니 명시적으로 끝낸다.
    process.exit(0);
  })
  .catch((err) => {
    clearInterval(pollTimer);
    console.error(err);
    process.exit(1);
  });
