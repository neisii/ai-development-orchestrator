import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
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

// 실제 프로젝트에 연결해서 오케스트레이터를 띄우는 진입점 (architecture.md §14.2 참고).
// `npm run demo`(src/run-demo.ts)는 빈 임시 디렉터리로 오케스트레이션 메커니즘 자체를
// 검증하는 용도였고, 이건 반대로 orchestrator.config.json에 적힌 실제 프로젝트 경로로
// Agent를 띄운다. 이 스크립트는 첫 작업을 자동으로 시키지 않는다 — 실제 작업 내용은
// 프로젝트마다 다르므로 사람이 admin-cli로 직접 지시한다.

const ConfigSchema = z.object({
  agents: z
    .array(
      z.object({
        id: z.string().min(1),
        projectPath: z.string().min(1),
        // 협업 Agent 로스터를 만드는 데만 쓴다(§18). 없어도 동작하지만, 있으면 다른 Agent가
        // "이 id가 뭘 담당하는지"까지 알고 ask_agent를 쓸 근거가 생긴다.
        role: z.string().optional(),
      })
    )
    .min(1),
  hookPort: z.number().int().positive().default(8787),
});

const configPath = resolve(process.argv[2] ?? "orchestrator.config.json");
if (!existsSync(configPath)) {
  console.error(`설정 파일을 찾을 수 없습니다: ${configPath}`);
  console.error("orchestrator.config.example.json을 복사해서 orchestrator.config.json을 만드세요.");
  process.exit(1);
}

const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(configPath, "utf-8")));
if (!parsed.success) {
  console.error(`설정 파일이 잘못됐습니다: ${configPath}`);
  console.error(parsed.error.format());
  process.exit(1);
}
const config = parsed.data;

for (const agent of config.agents) {
  const projectPath = resolve(agent.projectPath);
  if (!existsSync(projectPath)) {
    console.error(`Agent "${agent.id}"의 projectPath가 존재하지 않습니다: ${projectPath}`);
    process.exit(1);
  }
}

mkdirSync(".orchestrator", { recursive: true });
// claude CLI는 --mcp-config/--settings 경로를 자기 cwd(Agent별 프로젝트 디렉터리) 기준으로
// 해석하므로 반드시 절대 경로여야 한다(architecture.md §14.1에서 실측 확인된 버그).
const dbPath = resolve(".orchestrator/data.db");
const mcpServerPath = new URL("./mcp-server.ts", import.meta.url).pathname;

// Agent마다 별도 mcp-config 파일을 쓴다 — 예전엔 파일 하나를 전부 공유해서 env로 Agent별
// 값을 구분할 방법이 없었다. ORCHESTRATOR_DB_PATH는 고아 DB 버그(investigation-mcp-session-delay.md)
// 방지용, ORCHESTRATOR_AGENT_ID는 신원 위장 방지용(architecture.md §16) — 이 MCP 서버
// 서브프로세스는 자기가 어느 Agent를 위한 것인지 이 값으로만 판단하고, from_agent_id 인자가
// 이 값과 다르면 무조건 거절한다.
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

// requirements.md §8 Question Eligibility Check는 "다른 프로젝트 정보가 필요하다고 이미
// 판단한 다음" 그 질문을 보내도 되는지 검증하는 체크리스트다. 그런데 애초에 "이건 다른
// Agent 담당이다"라고 알아챌 근거 — 다른 Agent가 누구고 뭘 담당하는지 — 는 시스템 어디에도
// 없었다. 사람이 쓰는 ad-hoc 프롬프트에 우연히 힌트가 있지 않으면 Agent가 스스로 ask_agent를
// 쓸 근거가 없다는 게 실사용 중 확인됐다(architecture.md §18). 매 턴 프롬프트와 무관하게
// 항상 깔리도록 --append-system-prompt로 넘긴다.
function buildRosterPrompt(selfId: string): string | undefined {
  const others = config.agents.filter((a) => a.id !== selfId);
  if (others.length === 0) return undefined;
  const roster = others.map((a) => `- ${a.id}: ${a.role ?? "(역할 설명 없음)"}`).join("\n");
  return (
    `당신은 여러 프로젝트를 각각 담당하는 Agent들 중 하나(${selfId})입니다. 함께 협업하는 다른 Agent는 다음과 같습니다:\n` +
    `${roster}\n\n` +
    `당신 자신의 컨텍스트만으로 해결할 수 없는, 위 Agent의 책임 영역에 속하는 정보가 필요하면 ask_agent 도구로 ` +
    `해당 id를 target_agent_id로 지정해 직접 물어보세요. 다만 질문을 보내기 전에 스스로 다음을 점검하세요` +
    `(Question Eligibility Check, requirements.md §8): 현재 컨텍스트만으로 해결 가능한가? 정말 다른 프로젝트 ` +
    `정보가 필요한가? 다른 프로젝트의 책임 영역인가? 질문 대상 Agent가 적절한가? 필요한 정보가 명확한가?`
  );
}

const hookServer = startHookServer(config.hookPort);

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

const projectAgents: ProcessManager[] = [];
for (const agentConfig of config.agents) {
  const settingsPath = resolve(`.orchestrator/${agentConfig.id}-settings.json`);
  writeAgentHookSettings(settingsPath, agentConfig.id, `http://127.0.0.1:${config.hookPort}/events`);

  const pm = new ProcessManager({
    id: agentConfig.id,
    projectPath: resolve(agentConfig.projectPath),
    mcpConfigPath: writeMcpConfig(agentConfig.id),
    settingsPath,
    // 실제 Project Agent는 데모와 달리 역할이 고정돼 있지 않다 — 어느 프로젝트든
    // 서로 질문하고 답할 수 있어야 하므로 두 도구를 다 준다.
    allowedTools: ["mcp__orchestrator__ask_agent", "mcp__orchestrator__answer_question"],
    systemPromptAppend: buildRosterPrompt(agentConfig.id),
  });
  pm.on("lifecycle-change", (s) => console.log(`[${agentConfig.id}] ${s}`));
  orchestrator.registerAgent(pm);
  projectAgents.push(pm);
}

// Scribe는 실제 코드를 다루지 않으므로 임시 디렉터리로 충분하다.
const scribeProjectPath = mkdtempSync(join(tmpdir(), "ado-scribe-"));
const scribe = new ProcessManager({
  id: "scribe-agent",
  projectPath: scribeProjectPath,
  mcpConfigPath: writeMcpConfig("scribe-agent"),
  allowedTools: ["mcp__orchestrator__submit_decision_record"],
});
scribe.on("lifecycle-change", (s) => console.log(`[scribe-agent] ${s}`));
orchestrator.registerScribe(scribe);

orchestrator.startPolling();

console.log("======================================================");
console.log("  Orchestrator 실행 중 (이 터미널은 그대로 둔다)");
console.log("======================================================");
console.log(`설정 파일: ${configPath}`);
for (const agentConfig of config.agents) {
  console.log(`  - ${agentConfig.id}: ${resolve(agentConfig.projectPath)}`);
}
console.log(`Hook 수신 서버: http://127.0.0.1:${config.hookPort}/events`);
console.log("DB: .orchestrator/data.db (admin-cli 기본 경로와 동일 — 다른 터미널에서 별도 설정 불필요)");
console.log("");
console.log("자동으로 시작되는 작업이 없습니다. 다른 터미널에서 원하는 Agent에게 직접 첫 지시를 내리세요:");
console.log('  npm run admin -- resume-agent <agentId> "여기에 실제 작업 지시"');
console.log("이후 admin-cli 전체 명령은 docs/testing-guide.md 참고.");
console.log("");
console.log(">>> Ctrl+C로 종료합니다.\n");

process.on("SIGINT", () => {
  console.log("\n>>> 종료 중 — 실행 중인 Agent가 있으면 정리합니다...");
  for (const pm of [...projectAgents, scribe]) {
    pm.stop();
  }
  hookServer.close();
  setTimeout(() => process.exit(0), 500);
});
