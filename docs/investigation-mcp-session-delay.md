# 조사: MCP 세션에서만 나타나는 원인 불명 지연 (해결됨)

`run.ts` 전체 왕복(architecture.md §14.3)과 Phase 3 세션 왕복(phase3-scope.md) 둘 다, `--mcp-config`가 붙은 세션에서 모델 응답이 2분 넘게 안 오는 현상 때문에 실측이 막혀 있다. "도구 호출이 낀 세션은 다 느림"이라는 뭉뚱그려진 진단을 더 정확한 후보로 쪼개서, 어디서 멈추는지 위치를 좁히는 게 이 조사의 목적이다. 근거: [backlog.md](backlog.md), [architecture.md §14.3](architecture.md#143-실측-검증-부분적).

원칙: 실제 `claude -p` 세션(Claude Code 구독의 5시간 사용량 한도를 소모)은 최대한 늦게, 최소로 돌린다. 로컬에서 세션 없이 확인 가능한 것부터 순서대로 제외해나간다.

## 절차

### 0단계. 진단용 환경 준비 (1회성)

- 별도 임시 디렉터리(`/tmp/ado-diag`)에서 진행, 실제 저장소는 안 건드림.
- MCP config: 절대경로로 `src/mcp-server.ts`를 `npx tsx`로 가리킴.
- 진단 전용 hook 서버 + hook settings.json (`writeAgentHookSettings()` 재사용), 별도 DB 경로.
- 관찰 방식: `--output-format stream-json --verbose` + 줄마다 우리가 직접 타임스탬프 찍기.

### 1~4단계. 변수를 하나씩 늘려가며 "hi" 한마디로 격리

전부 도구 호출이 필요 없는 "hi"로, claude 프로세스가 첫 응답을 내놓기까지의 시간만 본다.

| 단계 | 구성 | 보는 것 | 느리면 뜻하는 것 |
|---|---|---|---|
| 1 (기준선) | 옵션 없음 | 몇 초 내 응답하는지 재확인 | — |
| 2 (MCP만) | `--mcp-config --strict-mcp-config` | `system/init` 줄 도착 시각 (모델 요청 전에 MCP `initialize`/도구 목록 교환이 끝나야 함) | 우리 `mcp-server.ts` 핸드셰이크 자체가 느림 → 5-a |
| 3 (hook만) | `--settings` | `SessionStart` hook의 curl(타임아웃 없음, `agent-settings.ts:9`) 응답 시각 | hook 서버 응답이 느리거나 안 옴 → 5-b |
| 4 (둘 다) | 2+3 | 2, 3이 무죄인데 조합만 느린가 | 두 메커니즘이 겹칠 때만 나는 상호작용 버그 |

**이미 제외됨(세션 없이 로컬에서 확인 완료)**: 작업 폴더가 iCloud 등 동기화 파일시스템에 있는지(아님), `npx tsx src/mcp-server.ts` 콜드스타트 자체가 느린지(0.7초, 안 느림).

**분기 5-a**: `mcp-server.ts`에 `openDb()`/`McpServer` 생성/`transport.connect()` 세 지점에 임시 타임스탬프 로그를 찍고 2단계 재실행 — 어느 구간에서 튀는지 좁힌다.

**분기 5-b**: 진단용 hook 서버 자체 로그와 대조해 "도달은 했는데 응답이 안 온 것"인지 "연결 자체가 안 된 것"인지 구분. 근본 수정 후보: `curlCommand()`에 `--max-time 5` 추가(`agent-settings.ts`).

### 5단계. 실제로 도구를 부르게 하는 프롬프트 (여기부터 5시간 사용량 한도 소모 + 이전에 겪은 지연 재현 위험)

1~4단계가 전부 빠르다는 전제. 오케스트레이터/승인 루프 없이 `claude` 단독 실행으로, `tool_use` 블록이 찍히는 시각만 본다(찍히면 즉시 중단).

- 수 초~수십 초 내 찍힘 → 모델은 정상 → 원인은 그 이후 단계 → 6단계
- 2분 가까이 안 찍힘 → 모델/API 쪽 지연 → 도구 설명(description)을 줄인 버전으로 A/B 비교

### 6단계. 오케스트레이터 폴링 루프 쪽 확인 (5단계에서 모델이 무죄로 나온 경우만)

`run.ts` 실전 구동 중 멈춰있는 동안 다른 터미널에서 `admin-cli list-events`/`list-questions`로 어디까지 진행됐는지 확인.

- Question까지 정상 생성됨 → 버그 아님, 승인 대기 중인 정상 상태
- `TOOL_PRE`는 찍혔는데 Question 미생성 → MCP 서버의 `ask_agent` 핸들러 문제 → stderr 확인
- `TOOL_PRE`조차 안 찍힘 → hook 미발동 → 3단계로 재점검

## 결과 기록

| 단계 | 시각(KST) | 명령/구성 | 소요시간 | 관찰 | 판단 |
|---|---|---|---|---|---|
| 0-a | 2026-08-25 | 작업 폴더 iCloud 여부 확인 | 즉시 | 로컬 APFS, iCloud/FileProvider 확장속성 없음 | 네트워크 파일시스템 원인 **제외** |
| 0-b | 2026-08-25 | `npx tsx src/mcp-server.ts` 콜드스타트 (4초 타임아웃) | 0.72s | 에러 없음, stdout 무출력(정상 — stdio 서버는 요청 전엔 조용함) | npx 콜드스타트 원인 **제외** |
| 1 | 2026-08-25 13:15 | `claude -p "hi"` (옵션 없음) | 3.51s (`ttft_ms` 1692) | 정상 응답 | 기준선 재확인, 이상 없음 |
| 2 | 2026-08-25 13:16 | `claude -p "hi" --mcp-config ... --strict-mcp-config` | 3.56s | `system/init`의 `mcp_servers`에 `{"name":"orchestrator","status":"connected"}`, `tools`에 3개 MCP 도구 정상 등록. 핸드셰이크 지연 없음 | MCP 핸드셰이크 원인 **제외** |
| 3 | 2026-08-25 13:16 | `claude -p "hi" --settings ...` | 3.22s | 진단 hook 서버 DB에 `SESSION_START`/`SESSION_END` 둘 다 정상 도착(각각 04:16:52.629Z, 04:16:55.010Z) | hook curl 경로 원인 **제외** |
| 4 | 2026-08-25 13:16 | `claude -p "hi" --mcp-config ... --strict-mcp-config --settings ...` | 3.58s (`ttft_ms` 1880) | 정상 응답, 이상 없음 | 상호작용 버그(둘 다 붙였을 때만 느려짐) **제외** |

**중간 결론**: 세션/프로세스 준비 단계(MCP 핸드셰이크, hook 경로, 둘의 조합) 전부 무죄로 확인됐다. "hi"처럼 도구 호출이 필요 없는 프롬프트는 이 조합 어디에도 지연이 없다 — 즉 이전에 겪은 2분 지연은 **세션 설정이 아니라, 모델이 실제로 도구를 호출해야 하는 상황(5단계) 또는 그 이후의 오케스트레이터 승인 대기 루프(6단계)에서만 재현되는 문제**로 좁혀졌다.

| 5 | 2026-08-25 13:22 | `claude -p "<ask_agent 호출 유도>" --mcp-config ... --strict-mcp-config --allowedTools mcp__orchestrator__ask_agent` (45초 강제 종료) | `tool_use`(`ask_agent`) 블록이 세션 시작 후 **4초 만에** 도착(04:22:31 init → 04:22:35.260 tool_use). 모델 판단 자체는 전혀 안 느림 | 5단계에서 "모델이 도구 호출을 안 하거나 늦게 한다"는 가설은 **기각**. 그런데 admin-cli로 진단 DB(`/tmp/ado-diag/data.db`)에서 `list-questions`를 조회하니 **"대기 중인 질문 없음"** — 도구는 분명 호출됐는데 Question이 안 보임 → 6단계로 직행해서 원인 추적 |

## 🎯 근본 원인 발견

`list-questions`가 비어 보인 이유는 지연이 아니라 **엉뚱한 DB 파일을 보고 있었기 때문**이었다.

```bash
$ find /tmp/ado-diag -iname "*.orchestrator*" -o -iname "data.db*"
/tmp/ado-diag/.orchestrator/data.db      # <- MCP 서버 서브프로세스가 실제로 쓴 파일
/tmp/ado-diag/data.db                    # <- 내가 hook 서버용으로 지정한 파일 (다른 파일!)

$ ORCHESTRATOR_DB_PATH=/tmp/ado-diag/.orchestrator/data.db npx tsx src/admin-cli.ts list-questions
[cdc29752-...] diag-agent -> other-agent
  질문: 최근 배포된 API 버전이 몇이야?
  생성: 2026-08-25T04:22:35.267Z   # tool_use 도착 7ms 뒤 — Question 생성 자체는 즉시 성공
```

**메커니즘**: `db.ts`의 `openDb()`는 `ORCHESTRATOR_DB_PATH` 환경변수가 없으면 상대 경로 `.orchestrator/data.db`를 기본값으로 쓴다(`db.ts:8,10`). `mcp-config.json`에 `"orchestrator": { "command": "npx", "args": ["tsx", mcpServerPath] }`처럼 **`env`를 안 주면**, claude가 spawn하는 MCP 서버 서브프로세스는 claude 자신의 cwd(= 그 Agent의 `projectPath`)를 그대로 물려받는다. 그 결과 MCP 서버는 orchestrator가 보는 공유 DB가 아니라, **그 Agent의 프로젝트 디렉터리 밑에 자기만의 `.orchestrator/data.db`를 새로 만들어 거기다 쓴다.**

**증거 — 이미 검증된 스크립트는 전부 이걸 명시적으로 고쳐뒀었다**:

```
$ grep -n "ORCHESTRATOR_DB_PATH" src/manual-test-*.ts
manual-test-intervention.ts:   env: 직접 설정 안 함 (Question/Answer 안 씀, 무관)
manual-test-scribe.ts:32:        env: { ORCHESTRATOR_DB_PATH: dbPath },
manual-test-scribe-answer.ts:33:        env: { ORCHESTRATOR_DB_PATH: dbPath },
manual-test-mvp-e2e.ts:46:        env: { ORCHESTRATOR_DB_PATH: dbPath },
manual-test-orchestrator.ts:31:        env: { ORCHESTRATOR_DB_PATH: dbPath },
```

실제로 사람이 개입해 끝까지 성공한 스크립트(`manual-test-scribe.ts`, `manual-test-mvp-e2e.ts`, `manual-test-orchestrator.ts`)는 **전부** mcp-config의 `env`에 `ORCHESTRATOR_DB_PATH`를 명시적으로 못박아뒀다. 반면 `src/run.ts`와 `src/run-demo.ts`는 **이 env를 빠뜨렸다** — 이 둘이 정확히, 여태 전체 왕복 검증이 한 번도 끝까지 성공한 적 없는 두 스크립트다.

**증상과의 정합성**: buyer-bff가 `ask_agent`를 호출 → 즉시 성공, Question 생성 → 하지만 자기 프로젝트 디렉터리 밑 고아 DB에 씀 → orchestrator/admin-cli는 진짜 공유 DB를 보므로 영원히 "대기 중인 질문 없음" → 아무도 승인 못 함 → `mcp-server.ts`의 `waitForQuestionDecision`이 내부 타임아웃(기본 10분)까지 계속 폴링 → 그동안 claude 프로세스는 "살아있지만 CPU 거의 안 씀"(API 응답 대기처럼 보이는 모양) → 우리가 2분쯤 기다리다 포기. **레이트리밋도, API 지연도 아니었다. `run.ts`/`run-demo.ts`의 mcp-config 생성 코드에 있는 결정론적 버그였다.**

## 수정 검증 (2-a): 진단 mcp-config에 `env` 추가 후 재현

코드는 아직 안 고쳤고, `/tmp/ado-diag/mcp-config.json`에만 `env: { "ORCHESTRATOR_DB_PATH": "/tmp/ado-diag/data.db" }`를 추가해서 가설이 맞는지만 먼저 확인했다.

```bash
$ ORCHESTRATOR_DB_PATH=/tmp/ado-diag/data.db npx tsx src/admin-cli.ts list-questions
[de067f87-...] diag-agent -> other-agent
  질문: env 수정 검증용 질문입니다
  생성: 2026-08-25T04:35:19.488Z   # tool_use 도착 후 즉시 생성 (여전히 빠름)

$ stat -f "%Sm %N" /tmp/ado-diag/.orchestrator/data.db   # 고아 DB
Aug 25 13:25:01 2026   # 수정 전 그대로, 이번엔 안 건드림
```

지정한 DB에 정확히 생겼고, 고아 DB는 이번 실행에서 전혀 건드리지 않았다(수정 시각 그대로). **가설 확정 — `env: { ORCHESTRATOR_DB_PATH: ... }` 한 줄이 원인 전부를 설명하고 고친다.**

## 실제 코드 수정 + 전체 왕복 재현 (해결 확인)

`src/run.ts`, `src/run-demo.ts` 둘 다 mcp-config 생성부에 `env: { ORCHESTRATOR_DB_PATH: dbPath }`를 추가하고, `openDb()`도 같은 `dbPath`를 명시적으로 넘기도록 고쳤다(그동안 `manual-test-*.ts`만 갖고 있던 패턴을 옮긴 것). `npx tsc --noEmit` 통과 확인 후, 깨끗한 `.orchestrator` 상태에서 `npm run demo`를 다시 띄워 전체 왕복을 재현했다.

| 시각(UTC) | 이벤트 |
|---|---|
| 04:39:08.412 | buyer-bff `ask_agent` 호출 → Question 즉시 생성(공유 DB에 정상 반영) |
| 04:39:xx | `decide-question approve` |
| 04:47:40 | Orchestrator가 api-agent에 자동 전달, api-agent `RUNNING` |
| 04:47:59.692 | api-agent 답변 생성(`INSUFFICIENT_CONTEXT` — 빈 임시 디렉터리라 정상적인 답) |
| — | `decide-answer approve` |
| 04:50:15 | api-agent `COMPLETED` |
| 04:50:22 | buyer-bff에 자동 전달 후 buyer-bff도 `COMPLETED` |

이 프로젝트에서 `run-demo.ts`의 자동 Q&A 왕복이 사람 개입까지 포함해 끝까지 성공한 것은 이번이 처음이다(기존 검증은 전부 `manual-test-*.ts`가 대신했고, `run-demo.ts`/`run.ts` 자체의 왕복은 architecture.md §14.3에 "부분 검증"으로 남아 있었다).

## 결론

레이트리밋도 API 쪽 지연도 아니었다. `src/run.ts`/`src/run-demo.ts`가 MCP 서버 서브프로세스에 `ORCHESTRATOR_DB_PATH`를 넘기지 않아, 각 Agent가 자기 프로젝트 디렉터리 밑에 아무도 안 보는 고아 DB를 만들어 쓰던 결정론적 버그였다. 수정 후 전체 왕복이 즉시(수 초~수십 초 단위) 정상 동작함을 확인했다.

## Phase 3 재시도 결과 (2026-08-25)

같은 수정으로 Phase 3 왕복도 풀렸다. `run.ts`(실제 파일이 있는 `/tmp/ado-diag/read-test`를 가리키는 config)로 재현:

1. **Decision Intervention → 자동 초안**: `admin-cli decide-choice buyer-bff ...` → 다음 polling에서 Scribe 자동 기동 → DRAFT 생성 확인.
2. **거절 → REVISING → 같은 레코드 재작성**: `decide-decision <id> reject "학습 곡선 리스크도 넣어줘"` → Scribe가 정확히 그 내용을 반영해 같은 id로 재제출(선택지 비교/판단 근거에 "학습 곡선" 문구 추가됨) 확인.
3. **search-decisions**: 실제 키워드("GraphQL")로 검색되고, 없는 키워드로는 안 걸림 확인.
4. **relatedFilePaths 채워짐**: buyer-bff가 먼저 `ProductResponse.txt`를 Read하게 한 뒤, 그 파일 내용과 명시적으로 연관된 두 번째 Decision Intervention을 트리거하니 Scribe가 `related_file_paths`에 정확히 그 파일 경로를 채워 제출함 확인.
5. **show-decisions-for-file**: 그 정확한 경로로 역조회 성공, 상위 디렉터리(부분 경로)로는 안 걸림(오탐 없음) 확인.

phase3-scope.md의 완료 기준 5개 전부 실제 `claude -p` 세션으로 확인 완료.
