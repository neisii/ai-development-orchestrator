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

// data-model.md §7 / architecture.md Phase 2 검증: 질문 거절(사유 포함) -> Scribe Agent
// 자동 트리거 -> Decision Record 초안 작성 -> Human 승인까지 실제 claude -p 세션으로 확인한다.

const workDir = mkdtempSync(join(tmpdir(), "ado-scribe-test-"));
const dbPath = join(workDir, "data.db");
const mcpConfigPath = join(workDir, "mcp-config.json");
const mcpServerPath = new URL("./mcp-server.ts", import.meta.url).pathname;

process.env.ORCHESTRATOR_DB_PATH = dbPath; // admin-cli 셸 호출도 같은 DB를 보게 한다

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
  const projectPath = mkdtempSync(join(tmpdir(), `ado-scribe-${id}-`));
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
const scribe = makeAgent("scribe-agent", "submit_decision_record");
orchestrator.registerAgent(buyerBff);
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
      "target_agent_id='api-agent', question='ProductResponse에 재고 수량 필드가 있어?', " +
      "why_needed에 적절한 근거를 적어라. 도구가 반환하는 내용을 그대로 보고해라."
  );

  const question = await waitUntil(() => store.listPendingQuestions()[0]);
  console.log(">>> 질문 도착:", question.text);

  console.log(">>> admin-cli decide-question reject (사유 포함)");
  admin(
    "decide-question",
    question.id,
    "reject",
    "이미 API 스펙 문서 v2에 재고 필드가 명시돼 있음. 문서부터 확인했어야 함."
  );

  console.log(">>> Scribe Agent가 자동으로 깨어나 Decision Record 초안을 쓰기를 기다리는 중...");
  await waitForPmState(scribe, ["RUNNING"]);
  console.log(">>> scribe-agent RUNNING 확인");
  await waitForPmState(scribe, ["COMPLETED", "FAILED"]);
  console.log(">>> scribe-agent 최종 상태:", scribe.getState());

  console.log(">>> admin-cli list-decisions (초안 확인)");
  admin("list-decisions");

  const draft = await waitUntil(() => decisionRecords.listDrafts()[0], 10000);
  console.log(">>> admin-cli show-decision (초안 내용)");
  admin("show-decision", draft.id);

  console.log(">>> admin-cli decide-decision approve");
  admin("decide-decision", draft.id, "approve");

  console.log(">>> 최종 Decision Record:", decisionRecords.get(draft.id));

  clearInterval(pollTimer);
}

main().catch((err) => {
  clearInterval(pollTimer);
  console.error(err);
  process.exit(1);
});
