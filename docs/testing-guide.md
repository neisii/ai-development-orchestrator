# 실 테스트 가이드

지금까지 구현한 것을 직접 손으로 확인해보는 가이드다. "지켜보기"(자동 시나리오), "직접 개입하기"(빈 디렉터리 인터랙티브 데모), "실전 프로젝트에 연결하기"(진짜 경로) 세 방식을 다룬다.

## 사전 준비

```bash
npm install
claude -p "hi"   # claude CLI가 로그인돼 있는지, 정상 응답이 오는지 먼저 확인
```

마지막 명령이 몇 초 안에 정상 응답하면 준비된 것이다. 응답이 비정상적으로 느리거나 안 오면(예: CPU 사용량이 거의 안 늘어난 채로 몇십 초씩 멈춰있음), 계정 사용량 제한(5시간 단위 rate limit)에 걸렸을 가능성이 크다 — 이 상태에서는 아래 시나리오들도 똑같이 멈춘다. 시간을 두고 다시 시도한다.

## 1. 자동 시나리오로 빠르게 지켜보기

Human 역할(승인/거절/개입)을 스크립트가 대신 수행하면서 전체 흐름을 보여준다. 실제 API 호출이 여러 번 일어나 몇 분씩 걸린다.

```bash
npm run manual-test:mvp-e2e        # mvp-scope.md 완료 기준 7개 전체 (약 5~6회 API 호출)
npm run manual-test:scribe         # 질문 거절 -> Scribe 자동 기록 -> 승인
npm run manual-test:scribe-answer  # 답변 거절 -> Scribe 자동 기록 -> 승인
```

`manual-test:mvp-e2e`를 실행하면 이런 식으로 진행된다(실제 실행 결과 일부):

```
========== Phase 1: api-agent Pause -> Resume -> Direct Instruction ==========
[api-agent] lifecycle -> RUNNING
>>> admin-cli pause-agent api-agent
[api-agent] lifecycle -> PAUSED
>>> admin-cli instruct-agent api-agent (Direct Instruction)
[api-agent] lifecycle -> COMPLETED

========== Phase 2: 전체 Q&A 왕복 ==========
>>> 질문 도착: ProductResponse에 재고 수량 필드가 있어?
>>> admin-cli decide-question approve
>>> 답변 도착: ... (INSUFFICIENT_CONTEXT)
>>> admin-cli decide-answer approve

========== 기준 6: Event Log 타입별 집계 ==========
  ANSWER_CREATED: 1
  INTERVENTION: 5
  QUESTION_CREATED: 1
  ...
```

## 2. 직접 개입해보기 (인터랙티브 데모)

### 터미널 1: 데모 실행 (계속 떠 있음)

```bash
npm run demo
```

buyer-bff가 자동으로 첫 질문을 던지고 나면, 이 터미널은 아무것도 안 하고 polling만 계속한다. `Ctrl+C`로 끌 때까지 그대로 둔다.

### 터미널 2: 같은 프로젝트 디렉터리에서 admin-cli 조작

**2-1. 질문 확인하고 승인/거절**

```bash
npm run admin -- list-agents        # 세 Agent(buyer-bff/api-agent/scribe-agent) 상태 확인
npm run admin -- list-questions
npm run admin -- decide-question <id> approve
```

승인하면 몇 초~십수 초 뒤 Orchestrator가 자동으로 api-agent를 깨워 질문을 전달한다. `list-agents`로 `api-agent`가 `STARTING` → `RUNNING`으로 바뀌는 걸 확인할 수 있다.

**2-2. 답변 확인하고 승인/거절**

```bash
npm run admin -- list-answers
npm run admin -- decide-answer <id> approve
```

승인하면 buyer-bff가 자동으로 재개돼 답변을 반영한 최종 응답을 낸다.

**2-3. Decision Record 체험하기 (거절 + 사유)**

질문이나 답변을 **사유를 달아서** 거절하면 Scribe Agent가 자동으로 깨어난다.

```bash
npm run admin -- decide-answer <id> reject "이미 API 스펙 문서에 나와있는 내용이라 재확인이 불필요함"
```

몇십 초 뒤:

```bash
npm run admin -- list-agents        # scribe-agent가 STARTING -> RUNNING -> COMPLETED로 바뀌는 걸 확인
npm run admin -- list-decisions     # DRAFT 상태의 Decision Record 확인
npm run admin -- show-decision <id> # 배경/문제/제약사항/선택지/선택지 비교/판단 근거/결론/결정 주체 전문 확인
npm run admin -- decide-decision <id> approve
```

`show-decision`으로 보이는 내용은 실제로 이런 식이다(과거 실행에서 나온 예):

```
## 판단 근거
API 스펙 문서 v2에 재고 필드가 이미 명시되어 있었으므로, api-agent에게 직접 질문하기
전에 문서부터 확인했어야 한다는 것이 거절 사유다.

## 결론
buyer-bff의 질문은 거절되었다. 이미 API 스펙 문서 v2에 재고 필드가 명시되어 있으므로
문서부터 확인했어야 한다.
```

Decision Record를 `decide-decision <id> reject "사유"`로 거절하면 그 자리에서 끝나지 않는다. 같은 레코드가 `REVISING` 상태로 바뀌고, 다음 polling에서 Scribe가 그 사유를 담은 프롬프트로 다시 깨어나 **같은 레코드**를 고쳐서 재제출한다(`list-decisions`로 다시 조회하면 같은 id가 갱신된 초안으로 보인다).

**2-3-1. Decision Intervention 체험하기 (Phase 3)**

Agent가 A안/B안 같은 선택지를 냈고 Human이 그중 하나를 고른 상황을 `admin-cli`로 직접 기록할 수 있다. Question/Answer와 달리 도구 호출을 거치지 않는다 — 사람이 곧바로 기록한다.

```bash
npm run admin -- decide-choice buyer-bff "A안: REST로 통일" "B안: GraphQL 도입" "기존 팀 역량과 인프라가 REST에 맞춰져 있음"
```

다음 polling에서 Scribe가 자동으로 깨어나 Decision Record 초안을 만든다. 이후는 위 §2-3와 동일하게 `list-decisions`/`show-decision`/`decide-decision`으로 검토한다.

**2-3-2. Decision History 검색 / 파일 경로로 역추적 (Phase 3)**

```bash
npm run admin -- search-decisions "REST"              # background/problem/conclusion/relatedInfo 부분 일치 검색
npm run admin -- show-decisions-for-file src/api-client.ts   # relatedFilePaths에 이 경로가 포함된 Decision Record
```

`show-decisions-for-file`은 Scribe가 `submit_decision_record` 호출 시 `related_file_paths`로 실제 골라 넣은 경로와 정확히 일치해야 걸린다(부분 문자열 매치 아님).

**2-4. Pause / Resume / Stop / Direct Instruction 체험하기**

Agent가 `RUNNING`일 때(긴 답변을 작성 중일 때가 확인하기 좋다) 다른 터미널에서:

```bash
npm run admin -- pause-agent api-agent
npm run admin -- list-agents                              # PAUSED 확인
npm run admin -- resume-agent api-agent "계속 진행해줘"
npm run admin -- instruct-agent api-agent "그만 쓰고 짧게 요약만 해줘"   # Pause+Resume 조합
npm run admin -- stop-agent buyer-bff                      # 완전 중단 (재개 안 함)
```

**2-5. 전체 이력 확인**

```bash
npm run admin -- list-events            # 전체 Event Log (시간순)
npm run admin -- list-events buyer-bff  # 특정 Agent만
npm run admin -- list-decisions --all   # DRAFT뿐 아니라 APPROVED/REVISING까지
```

## 3. 실전 프로젝트에 연결하기

`npm run demo`는 빈 임시 디렉터리로 메커니즘 자체를 확인하는 용도다. 실제 코드가 있는 프로젝트에 연결하려면 `npm run start`를 쓴다.

```bash
cp orchestrator.config.example.json orchestrator.config.json
```

`orchestrator.config.json`을 열어 실제 경로로 채운다(이 파일은 gitignore돼 있어 커밋되지 않는다):

```json
{
  "agents": [
    { "id": "buyer-bff", "projectPath": "/Users/me/projects/buyer-bff", "role": "구매자용 BFF" },
    { "id": "api-agent", "projectPath": "/Users/me/projects/data-serving-api", "role": "상품 데이터 API" }
  ],
  "hookPort": 8790
}
```

`role`은 선택 항목이다(안 채워도 동작함). 채워두면 다른 Agent들에게 "이 id가 뭘 담당하는지" 로스터로 전달되어(architecture.md §18), 자연어로만 지시해도 필요할 때 스스로 `ask_agent`를 쓸 근거가 생긴다.

```bash
npm run start
```

`npm run demo`와 다른 점 두 가지:

- **역할이 고정돼 있지 않다**: 등록된 모든 Agent가 `ask_agent`/`answer_question`을 둘 다 가진다. 어느 프로젝트든 서로 질문하고 답할 수 있다.
- **자동으로 시작되는 작업이 없다**: 실제 프로젝트마다 첫 작업이 다르므로, 사람이 직접 지시해야 한다.

```bash
npm run admin -- resume-agent buyer-bff "여기에 실제 작업 지시를 적는다"
```

이후는 [§2](#2-직접-개입해보기-인터랙티브-데모)와 동일하게 `list-questions`/`decide-question`/`list-answers`/`decide-answer` 등으로 진행한다.

## 4. admin-cli 명령어 전체 목록

| 명령 | 설명 |
|---|---|
| `list-questions` / `decide-question <id> approve\|reject [사유]` | 질문 조회/승인/거절 |
| `list-answers` / `decide-answer <id> approve\|reject [사유]` | 답변 조회/승인/거절 |
| `list-agents` | Agent 상태(Lifecycle State + Activity Label) |
| `list-events [agentId]` | Event Log 조회. `ASSISTANT_MESSAGE`(도구 호출 없는 일반 텍스트 응답)는 내용 미리보기도 같이 출력 |
| `pause-agent <id>` / `resume-agent <id> [prompt]` / `stop-agent <id>` | 개입 |
| `instruct-agent <id> <prompt>` | Direct Instruction (Pause+Resume 조합) |
| `list-decisions [--all]` / `show-decision <id>` / `decide-decision <id> approve\|reject [사유]` | Decision Record 조회/승인/거절(거절 시 REVISING으로 돌아가 같은 레코드가 재작성됨) |
| `decide-choice <agentId> "<선택한 안>" "<기각된 안>" "<근거>"` | Decision Intervention 기록 (Phase 3) |
| `search-decisions <keyword>` | 과거 Decision Record 텍스트 검색 (Phase 3) |
| `show-decisions-for-file <path>` | 특정 파일 경로와 관련된 Decision Record 역추적 (Phase 3) |

## 5. 초기화

상태를 지우고 처음부터 다시 시작하려면(데모/실전 공통):

```bash
# 터미널 1에서 Ctrl+C로 종료 후
rm -rf .orchestrator
npm run demo   # 또는 npm run start
```

## 6. 문제 해결

- **Agent가 `STARTING` 직후 바로 `FAILED`로 바뀐다**: 콘솔에 `[agent-id] ...` 형태로 원인이 같이 찍힌다(예: 잘못된 `--mcp-config` 경로, 인증 문제). 이 메시지를 보고 원인을 확인한다.
- **한참 기다려도 질문/답변이 안 생긴다**: `ps aux | grep "claude -p"`로 프로세스가 살아있는지 확인한다. 살아있는데 CPU 시간이 거의 안 늘어나면 API 응답을 기다리는 중 — 계정 사용량 제한(5시간 rate limit)에 걸렸을 가능성이 크다. 시간을 두고 다시 시도한다.
- **`npm run demo`/`npm run start`를 두 번 동시에 띄웠다**: 같은 `.orchestrator/data.db`를 두 프로세스가 동시에 쓰면서 Agent 상태가 꼬인다. 하나를 반드시 끄고(`Ctrl+C` 또는 `pkill -f run-demo.ts` / `pkill -f run.ts`), `.orchestrator`를 지운 뒤 하나만 다시 띄운다.
- **`npm run start`가 "설정 파일을 찾을 수 없습니다"로 바로 종료된다**: `orchestrator.config.json`이 없다는 뜻. `cp orchestrator.config.example.json orchestrator.config.json` 후 실제 경로로 채운다.
- **`npm run start`가 "projectPath가 존재하지 않습니다"로 종료된다**: `orchestrator.config.json`에 적은 경로가 실제로 없는 디렉터리다. 절대 경로인지, 오타는 없는지 확인한다.
