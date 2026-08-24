import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { AgentStore } from "./agent-store.js";
import { InterventionStore } from "./intervention-store.js";
import { DecisionRecordStore } from "./decision-record-store.js";
import { ProcessManager } from "./process-manager.js";
import { Orchestrator } from "./orchestrator.js";

// pause-agent/resume-agent(Direct Instruction 포함)가 admin-cli의 "요청만 기록" ->
// Orchestrator의 "폴링하며 실제 적용" 흐름을 실제로 검증하는 수동 테스트.
// admin-cli가 하는 일은 interventionStore.request() 호출뿐이라, 여기서는 그 호출을
// 직접 재현하고(같은 코드 경로), 별도로 실제 admin-cli CLI 한 번도 셸로 호출해 배선을 확인한다.

const workDir = mkdtempSync(join(tmpdir(), "ado-intervention-test-"));
const dbPath = join(workDir, "data.db");
process.env.ORCHESTRATOR_DB_PATH = dbPath; // admin-cli 셸 호출도 같은 DB를 보게 한다

console.log("workDir:", workDir);

const db = openDb(dbPath);
const eventLog = new EventLogStore(db);
const store = new QaStore(db, eventLog);
const agentStore = new AgentStore(db);
const interventionStore = new InterventionStore(db);
const decisionRecords = new DecisionRecordStore(db, eventLog);
const orchestrator = new Orchestrator(store, agentStore, eventLog, interventionStore, decisionRecords, 1500);

const projectPath = mkdtempSync(join(tmpdir(), "ado-intervention-project-"));
const pm = new ProcessManager({ id: "buyer-bff", projectPath });
pm.on("lifecycle-change", (s) => console.log(`[buyer-bff] lifecycle -> ${s}`));
orchestrator.registerAgent(pm);

const pollTimer = orchestrator.startPolling();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForState(states: string[], timeoutMs = 30000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = pm.getState().lifecycleState;
    if (states.includes(s)) return s;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${states.join("|")}, currently ${pm.getState().lifecycleState}`);
}

async function main() {
  // 1) pause-agent: 생성 도중 개입
  pm.start(
    "Write a detailed 1500-word essay about the history of distributed systems. Do not use any tools, just write the essay."
  );
  await waitForState(["RUNNING"]);
  await sleep(1500);

  console.log(">>> admin-cli로 pause-agent 요청 (실제 CLI 셸 호출)");
  const { execSync } = await import("node:child_process");
  execSync(`npx tsx src/admin-cli.ts pause-agent buyer-bff`, { stdio: "inherit" });

  console.log(">>> Orchestrator가 pause를 적용해서 PAUSED가 되기를 기다리는 중...");
  await waitForState(["PAUSED"]);
  console.log(">>> PAUSED 확인됨:", pm.getState());

  // 2) resume-agent: 재개
  console.log(">>> resume-agent 요청 (interventionStore 직접 호출)");
  interventionStore.request("buyer-bff", "RESUME", "짧게 세 문장으로만 요약해서 마무리해줘.", "human");

  console.log(">>> 재개되어 완료되기를 기다리는 중...");
  await waitForState(["RUNNING"]);
  await waitForState(["COMPLETED", "FAILED"]);
  console.log(">>> 1차 완료 상태:", pm.getState());

  // 3) instruct-agent: 새로 시작해서 도중에 Direct Instruction
  pm.start("Write a detailed 1500-word essay about TCP congestion control. Do not use any tools.");
  await waitForState(["RUNNING"]);
  await sleep(1500);

  console.log(">>> instruct-agent 요청 (PAUSE + RESUME(prompt) 조합)");
  interventionStore.request("buyer-bff", "PAUSE", null, "human");
  interventionStore.request("buyer-bff", "RESUME", "그만 쓰고 '알겠습니다'라고만 답해줘.", "human");

  await waitForState(["COMPLETED", "FAILED"], 60000);
  console.log(">>> 2차(Direct Instruction) 최종 상태:", pm.getState());

  console.log(">>> Event Log의 INTERVENTION 항목들:");
  for (const e of eventLog.list({ agentId: "buyer-bff", limit: 50 })) {
    if (e.type === "INTERVENTION") console.log("  ", e.timestamp, e.payload);
  }

  clearInterval(pollTimer);
}

main().catch((err) => {
  clearInterval(pollTimer);
  console.error(err);
  process.exit(1);
});
