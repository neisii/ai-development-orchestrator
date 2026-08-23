import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";
import { EventLogStore } from "./event-log.js";
import { ProcessManager } from "./process-manager.js";
import { startHookServer } from "./hook-server.js";
import { writeAgentHookSettings } from "./agent-settings.js";

// Hook 수신 서버가 실제로 PreToolUse/PostToolUse/SessionStart/SessionEnd 이벤트를
// 받아 Event Log에 쌓는지 검증하는 수동 테스트.

const workDir = mkdtempSync(join(tmpdir(), "ado-hooks-test-"));
const dbPath = join(workDir, "data.db");
const settingsPath = join(workDir, "settings.json");
const port = 8787;

console.log("workDir:", workDir);

const server = startHookServer(port, dbPath);
const db = openDb(dbPath);
const eventLog = new EventLogStore(db);

writeAgentHookSettings(settingsPath, "buyer-bff", `http://127.0.0.1:${port}/events`);

const projectPath = mkdtempSync(join(tmpdir(), "ado-hooks-project-"));
const pm = new ProcessManager({
  id: "buyer-bff",
  projectPath,
  settingsPath,
  allowedTools: ["Bash"],
});

pm.on("lifecycle-change", (s) => console.log(`[buyer-bff] lifecycle -> ${s}`));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  pm.start("Run the bash command 'echo hello-from-hook-test'.");

  await new Promise<void>((resolve) => {
    pm.on("lifecycle-change", (s) => {
      if (s === "COMPLETED" || s === "FAILED") resolve();
    });
  });

  await sleep(500); // PostToolUse/SessionEnd curl이 도착할 시간을 약간 더 준다

  console.log(">>> Event Log:");
  for (const e of eventLog.list({ agentId: "buyer-bff" })) {
    console.log(`  [${e.timestamp}] ${e.type} (${e.source})`);
  }

  server.close();
}

main();
