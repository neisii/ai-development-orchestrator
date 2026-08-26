# 조사: 테스트 스크립트가 `clearInterval` 이후 자연 종료되지 않는 현상 (해결됨 — CLI 업데이트)

[architecture.md §13.4](architecture.md#134-알려진-이슈-테스트-스크립트가-자연-종료되지-않음-원인-미확정)에 남겨둔 미해결 항목. 좀비 프로세스로 남지 않고 결국 정리는 되어 급하지 않지만, 원인 후보를 더 좁혀본다. 이전 조사에서 이미 실제 `claude -p` 세션 4번을 썼으니, 이번엔 **무료로 재현 가능한지부터** 확인하고 실제 세션은 최후 수단으로만 쓴다.

## 이미 알려진 사실 (§13.4)

- `ProcessManager`/`Orchestrator` 단독 최소 재현은 깨끗하게 종료됨 — 두 컴포넌트 자체는 결백.
- 실패하는 시나리오(`manual-test-scribe-answer.ts`)에서 `clearInterval` 직후 `process._getActiveHandles()`에 `ChildProcess` 1개 + `Socket` 3개가 남아 있었음. 정체는 Orchestrator가 api-agent에게 질문을 전달할 때 spawn한 그 `claude -p` 프로세스.
- 콘솔엔 이미 `[api-agent] lifecycle -> COMPLETED`가 찍혔는데, 그 핸들 객체의 내부 카운터(`_closesNeeded: 3, _closesGot: 0`)는 아직 close 안 된 것처럼 보여 모순처럼 보였음(정확한 인과관계 미확정).
- 좀비로 안 남음 — 결국 정리됨(타임아웃이 죽이든 스스로든).
- `manual-test-scribe.ts`/`manual-test-scribe-answer.ts`는 이 현상과 무관하게 `process.exit(0)`으로 우회 중.

## 절차

### 0단계 (무료): 코드 재검토 + 가짜 프로세스로 재현

`src/process-manager.ts`의 `spawnProcess()`를 다시 보면, `child.stdout`/`child.stderr`는 읽지만 **`child.stdin`은 한 번도 안 건드린다** — `end()`도 `destroy()`도 안 한다. Node의 `ChildProcess`는 stdin/stdout/stderr 3개 스트림이 전부 close돼야 자기 자신도 완전히 close되는데, 부모가 자식의 stdin을 절대 안 끝내면 그 스트림이 영영 close 이벤트를 못 받을 수 있다 — §13.4의 `_closesNeeded: 3, _closesGot: 0`과 정확히 맞아떨어지는 가설이다.

`claude` 대신 몇 줄짜리 더미 스크립트를 PATH에 심어서 실제 API 호출 없이 검증한다:
- **A(현재 코드 그대로)**: `start()` → `COMPLETED`까지 기다림 → `_getActiveHandles()`에 `ChildProcess`가 남는지 확인 (재현 시도)
- **B(실험용으로 `child.stdin.end()` 추가)**: 같은 시나리오, 핸들이 사라지는지 확인

재현되면 원인 후보가 명확해지고, 무료로 계속 반복 검증할 수 있다. 재현 안 되면 이 가설은 기각하고 1단계로.

### 1단계 (무료, 0단계가 재현되면): `async_hooks`로 정밀 추적

한 번 스냅샷 찍는 `_getActiveHandles()` 대신 `async_hooks`로 리소스 생성/해제 전체를 로그로 남겨 정확한 타임라인을 본다.

### 2단계 (무료 가설 검증, 0단계가 재현 안 되면): "개인 Claude Code 설정" 가설

모든 Agent 프로세스의 `system/init`에 우리가 설정한 적 없는 `claude.ai Google Drive`/`Gmail`/`Google Calendar` MCP 서버가 자동으로 붙는 게 관찰됐다(`claudeConfigDir` 미지정 시 조사자 개인 `~/.claude` 상속). 남은 `Socket` 3개가 이 개인 플러그인들의 백그라운드 연결일 가능성. `AgentConfig.claudeConfigDir`로 텅 빈 격리 디렉터리를 지정해서 같은 시나리오를 돌려 확인한다.

### 3단계 (실제 세션 필요, 최대 1회): `lsof`로 살아있는 동안 관찰

0~2단계로 안 좁혀지면 실제 시나리오를 다시 돌리되, 멈춰있는 동안 `lsof -p <pid>`로 소켓 상태(`ESTABLISHED`/`CLOSE_WAIT` 등)를 직접 본다.

### 4단계: 고칠지 여부 판단

좀비도 안 남고 `run.ts`/`run-demo.ts`도 이미 SIGINT 핸들러에서 강제 `process.exit(0)`을 부르므로 실제로는 아무것도 안 막고 있다. 원인이 나와도 실제 코드 수정 여부는 그때 다시 판단한다.

## 결과 기록

| 단계 | 시각 | 방법 | 결과 | 판단 |
|---|---|---|---|---|
| 0-a | 2026-08-25 | 단일 `ProcessManager.start()` + 가짜 claude(즉시 종료), stdin 안 닫음(A) vs `child.stdin.end()` 추가(B) | 둘 다 `COMPLETED` 후 활성 핸들 0개 | stdin 미종료 가설은 **단독으로는 재현 안 됨** — 기각까지는 아니지만 이것만으로는 원인이 아님 |
| 0-b | 2026-08-25 | 두 `ProcessManager`(buyer-bff/api-agent) + 실제 `Orchestrator`(setInterval 폴링) + `QaStore`로 Question 생성→승인, api-agent가 setInterval 콜백 "안에서" `start()`되는 구조까지 재현. 가짜 claude 사용 | `clearInterval` 후 활성 핸들 **0개** — 원래 버그의 핵심 구조(Orchestrator + 다중 ProcessManager + interval-driven spawn)를 그대로 복제했는데도 재현 안 됨 | **결론: 우리 코드(`ProcessManager`/`Orchestrator`) 문제가 아니다.** 진짜 `claude` CLI 프로세스 특유의 무언가(자체 소켓, 종료 시 정리 타이밍 등) 때문일 가능성이 높음 → 2단계로 |

**중간 결론**: 0단계 두 번 다 재현 실패로, §13.4에서 "ProcessManager/Orchestrator 자체는 결백"이라고 했던 결론이 더 강하게 확인됐다. 문제가 있다면 우리 코드가 아니라 실제 `claude` 바이너리 쪽에 있다는 뜻이라, 원인 완전 규명은 이 프로젝트 범위 밖일 가능성이 크다.

## Claude Code CLI 업데이트 후 재시도 (2026-08-25, v2.1.238 → v2.1.245)

사용자가 CLI를 최신 버전으로 업데이트한 김에, 진짜 `claude` 바이너리로 원래 시나리오를 다시 재현했다.

| 단계 | 방법 | 결과 |
|---|---|---|
| 1차 | 진짜 claude로 2-Agent(buyer-bff/api-agent) 시나리오, Scribe 없이 재현 | `clearInterval` 후 핸들 0개 — 재현 안 됨. 다만 claude CLI가 stderr에 `Warning: no stdin data received in 3s, proceeding without it...`를 찍는 걸 처음 발견 — `child.stdin`을 부모가 한 번도 안 닫는다는 §0단계 가설이 실제로 매 턴 3초 지연을 유발하고 있었다는 직접 증거 |
| 2차 | 같은 시나리오, 실험용 `child.stdin.end()` 패치(process-manager-stdinfix.ts) 적용 | 3초 경고 사라짐 확인. 핸들은 원래도 0개라 비교 대상 없음 |
| 3차 | **원래 버그가 재현됐던 조건과 최대한 근접하게**: buyer-bff 질문 → 승인 → api-agent 답변 → 답변 거절(사유) → Scribe 자동 기동 → 실제 `submit_decision_record` MCP 호출까지 포함, `process.exit(0)` 우회 없이 순수 자연 종료 관찰 | Scribe까지 정상 `COMPLETED`, `clearInterval` 후 핸들 **0개** — 자연 종료됨 |

## 결론

**CLI 버전 업데이트(v2.1.238 → v2.1.245)로 해결된 것으로 판단한다.** 원래 버그를 촉발했던 시나리오(Scribe 포함, MCP 서버 서브프로세스 spawn 포함)를 실제 세션으로 그대로 재현했는데도 더 이상 걸리지 않는다. §13.4에서 이미 "ProcessManager/Orchestrator 자체는 결백"이라고 봤던 것과 종합하면, 원인은 그 시점의 claude CLI 자체에 있었고 이후 버전에서 고쳐진 것으로 보인다 — 우리 쪽 코드 수정은 필요 없다.

**부수적으로 발견한, 별개의 실제 개선 여지(해결됨)**: `ProcessManager.spawnProcess()`가 `child.stdin`을 한 번도 안 닫아서, 지금 이 프로젝트의 **모든 Agent 턴마다** claude CLI가 stdin을 3초간 기다렸다가 진행했다(`Warning: no stdin data received in 3s...`). `clearInterval` 버그와는 무관했지만 실사용 시 매 턴 3초씩 누적되는 진짜 성능 문제라 `child.stdin.end()`를 실제로 추가했다. 수정 후 "hi" 한 턴이 `STARTING → RUNNING` 0.8초, 전체 3.1초로 끝났고 stdin 경고도 사라졌다(2026-08-26 실측, `src/process-manager.ts`).
