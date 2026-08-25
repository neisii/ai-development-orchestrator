import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { AgentStore } from "./agent-store.js";
import { InterventionStore } from "./intervention-store.js";
import { DecisionRecordStore } from "./decision-record-store.js";
import { DecisionInterventionStore } from "./decision-intervention-store.js";
import { ProcessManager } from "./process-manager.js";
import { Orchestrator } from "./orchestrator.js";

// 사람이 직접 admin-cli로 개입해보는 인터랙티브 데모.
// 이 터미널은 계속 떠 있고, 다른 터미널에서 `npm run admin -- ...`을 직접 입력해서 조작한다.
//
// DB는 admin-cli의 기본 경로(.orchestrator/data.db)를 그대로 쓴다 — 그래야 다른 터미널에서
// ORCHESTRATOR_DB_PATH를 따로 안 맞춰도 같은 DB를 보게 된다. 다시 깨끗하게 시작하고 싶으면
// 이 스크립트를 끄고 `rm -rf .orchestrator`로 지운 뒤 다시 실행하면 된다.

mkdirSync(".orchestrator", { recursive: true });
// claude CLI는 --mcp-config 경로를 자기 cwd(Agent별 임시 작업 디렉터리) 기준으로 해석하므로
// 반드시 절대 경로여야 한다. 상대 경로를 썼다가 "MCP config file not found"로 실패했었다.
const dbPath = resolve(".orchestrator/data.db");
const mcpServerPath = new URL("./mcp-server.ts", import.meta.url).pathname;

// Agent마다 별도 mcp-config 파일을 쓴다 — 예전엔 파일 하나를 전부 공유해서 env로 Agent별 값을
// 구분할 방법이 없었다. env 없이 두면 이 서브프로세스가 claude의 cwd(각 Agent의 임시 프로젝트
// 디렉터리)를 물려받아, db.ts의 상대 경로 기본값이 Agent마다 별도 고아 DB를 만든다 — Question이
// 실제로는 즉시 생성되지만 admin-cli가 보는 공유 DB에는 영원히 안 잡혀서 승인 대상이 못 되고,
// ask_agent 호출은 내부 타임아웃까지 조용히 멈춰있는 것으로 관측됐다(investigation-mcp-session-delay.md).
// ORCHESTRATOR_AGENT_ID는 신원 위장 방지용(architecture.md §16) — 이 값과 from_agent_id 인자가
// 다르면 mcp-server.ts가 무조건 거절한다.
function writeMcpConfig(agentId: string): string {
  const path = resolve(`.orchestrator/${agentId}-mcp-config.json`);
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
  2000
);

function makeAgent(id: string, tool: string): ProcessManager {
  const projectPath = mkdtempSync(join(tmpdir(), `ado-demo-${id}-`));
  const pm = new ProcessManager({
    id,
    projectPath,
    mcpConfigPath: writeMcpConfig(id),
    allowedTools: [`mcp__orchestrator__${tool}`],
  });
  pm.on("lifecycle-change", (s) => console.log(`[${id}] ${s}`));
  return pm;
}

const buyerBff = makeAgent("buyer-bff", "ask_agent");
const apiAgent = makeAgent("api-agent", "answer_question");
const scribe = makeAgent("scribe-agent", "submit_decision_record");
orchestrator.registerAgent(buyerBff);
orchestrator.registerAgent(apiAgent);
orchestrator.registerScribe(scribe);
orchestrator.startPolling();

console.log("======================================================");
console.log("  Orchestrator 인터랙티브 데모 (이 터미널은 그대로 둔다)");
console.log("======================================================");
console.log("DB: .orchestrator/data.db (admin-cli 기본 경로와 동일 — 다른 터미널에서 별도 설정 불필요)");
console.log("");
console.log("다른 터미널을 열어서 이 프로젝트 디렉터리(" + process.cwd() + ")로 이동한 뒤:");
console.log("  npm run admin -- list-agents");
console.log("  npm run admin -- list-questions");
console.log("  npm run admin -- decide-question <id> approve");
console.log('  npm run admin -- decide-question <id> reject "사유"');
console.log("  npm run admin -- list-answers");
console.log("  npm run admin -- decide-answer <id> approve");
console.log('  npm run admin -- decide-answer <id> reject "사유"   (사유를 달면 Scribe가 자동으로 깨어남)');
console.log("  npm run admin -- pause-agent buyer-bff");
console.log('  npm run admin -- resume-agent buyer-bff "계속 진행해"');
console.log('  npm run admin -- instruct-agent api-agent "..."');
console.log("  npm run admin -- list-decisions");
console.log('  npm run admin -- show-decision <id>');
console.log('  npm run admin -- decide-decision <id> approve');
console.log("  npm run admin -- list-events");
console.log("");
console.log(">>> buyer-bff에게 첫 질문을 시킵니다 (실제 API 호출 발생)...");

buyerBff.start(
  "You are agent 'buyer-bff'. Call the ask_agent tool exactly once: from_agent_id='buyer-bff', " +
    "target_agent_id='api-agent', question='ProductResponse에 배송 예정일 필드가 있어?', " +
    "why_needed에 적절한 근거를 적어라. 도구가 반환하는 내용을 그대로 보고해라."
);

console.log(">>> 이제부터 admin-cli list-questions로 질문을 확인하고 직접 승인/거절해보세요.");
console.log(">>> Ctrl+C로 종료합니다.\n");

process.on("SIGINT", () => {
  console.log("\n>>> 종료 중 — 실행 중인 Agent가 있으면 정리합니다...");
  for (const pm of [buyerBff, apiAgent, scribe]) {
    pm.stop();
  }
  setTimeout(() => process.exit(0), 500);
});
