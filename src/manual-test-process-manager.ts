import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessManager } from "./process-manager.js";

// ProcessManager가 실제 claude 프로세스를 spawn/SIGTERM/--resume 하는지 눈으로 확인하기 위한 수동 테스트.
// 실제 API 호출이 발생한다 (토큰 소비).
//
// 도구 호출(Bash 등)은 이 환경에서 백그라운드 Task로 자동 위임되어 실행 시간을 예측하기 어려우므로,
// 순수 텍스트 생성(도구 없음)으로 "생성 도중 SIGTERM → 재개"를 검증한다.

const projectPath = mkdtempSync(join(tmpdir(), "ado-test-project-"));

console.log("projectPath:", projectPath);

const pm = new ProcessManager({
  id: "test-agent",
  projectPath,
  // claudeConfigDir 생략: 기본 ~/.claude(인증 정보 있는 곳)를 그대로 상속한다.
});

pm.on("lifecycle-change", (state) => {
  console.log(`[lifecycle] ${state}`);
});

pm.on("event", (e) => {
  const raw = e.raw as Record<string, unknown>;
  console.log(`[event] ${JSON.stringify(raw).slice(0, 150)}`);
});

function waitForState(states: string[]): Promise<string> {
  return new Promise((resolve) => {
    const check = (s: string) => {
      if (states.includes(s)) {
        pm.off("lifecycle-change", check);
        resolve(s);
      }
    };
    pm.on("lifecycle-change", check);
  });
}

async function main() {
  pm.start(
    "Write a detailed 1500-word essay about the history of distributed systems, thinking carefully and thoroughly. Do not use any tools, just write the essay as your response."
  );

  await waitForState(["RUNNING"]);
  console.log(">>> RUNNING 확인, 2초 뒤 pause() 호출 (생성 도중)");
  await new Promise((r) => setTimeout(r, 2000));

  console.log(">>> pause() 호출");
  pm.pause();

  await waitForState(["PAUSED", "FAILED", "COMPLETED"]);
  console.log(">>> pause 이후 상태:", pm.getState());

  if (pm.getState().lifecycleState === "PAUSED") {
    console.log(">>> resume() 호출");
    pm.resume("방금 중단됐어. 아까 쓰던 에세이를 이어서 완성해줘. 짧게 요약만 해도 돼.");
    await waitForState(["COMPLETED", "FAILED"]);
  }

  console.log(">>> 최종 상태:", pm.getState());
}

main();
