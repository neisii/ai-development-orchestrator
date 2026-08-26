# MVP 범위 정의

[requirements.md](requirements.md)의 26개 원칙 중, 오케스트레이션 루프 자체(Agent 실행·통신·Q&A 검증·Human Intervention·관찰 가능성)를 먼저 검증하는 것을 MVP 목표로 삼는다. Scribe Agent / Decision Record는 별도 레이어로 분리 가능하다고 판단해 Phase 2 이후로 미룬다.

## MVP 목표

Human이 최소 2개의 독립 프로젝트를 각각 담당하는 Project Agent를 Orchestrator를 통해 실행하고, Agent 간 통신·질문/답변·Intervention을 실제로 지휘할 수 있는지를 CLI 환경에서 검증한다.

## 포함 범위 (In Scope)

| # | 항목 | 관련 섹션 |
|---|---|---|
| 1 | 1 Agent : 1 Project — 최소 2개 프로젝트, 2개 Project Agent | [§2](requirements.md#2-기본-운영-모델) |
| 2 | Orchestrator를 통한 Agent 세션 관리 (시작/일시정지/재개/중단) | [§12.1](requirements.md#121-execution-control) |
| 3 | Agent 간 통신은 전부 Orchestrator 경유 | [§7](requirements.md#7-agent-간-통신) |
| 4 | Question Eligibility Check → Human Review(승인/거절) → 전달 | [§8](requirements.md#8-질문-생성-품질-검증), [§9](requirements.md#9-질문-human-review) |
| 5 | Answer Eligibility Check → Answer 상태(enum) → Human Review | [§10](requirements.md#10-답변-품질-검증), [§11](requirements.md#11-답변-불가능한-상황) |
| 6 | Human Intervention: Execution Control + Direct Instruction | [§12.1](requirements.md#121-execution-control), [§12.2](requirements.md#122-direct-instruction) |
| 7 | Event Log: 최소 활동 유형(파일 읽기/수정, 명령 실행, 테스트 실행/결과, 오류, 상태 변경, 질문/답변 생성, Intervention) | [§13](requirements.md#13-agent-activity--event-log) |
| 8 | Agent 상태 enum 노출 (관찰 가능성 확보) | [§14](requirements.md#14-agent-상태) |
| 9 | 인터페이스: CLI/터미널 (로그 스트림 + 프롬프트 기반 승인·개입) | — |

## 제외 범위 (Out of Scope — Phase 2+)

| # | 항목 | 관련 섹션 | 사유 |
|---|---|---|---|
| 1 | Scribe Agent / Decision Record 생성 | [§15](requirements.md#15-scribe-agent)–[§20](requirements.md#20-orchestrator와-scribe) | 오케스트레이션 루프와 독립적으로 검증 가능한 레이어 |
| 2 | Decision Context 9단계 파이프라인 공식화 | [§18](requirements.md#18-decision-context) | Scribe 도입 이후 의미가 생김 |
| 3 | Decision History 재활용 (과거 결정 검색 → 새 작업 주입) | [§23](requirements.md#23-decision-history의-재활용) | 축적된 Decision Record가 있어야 성립 |
| 4 | Code ↔ Decision Record 양방향 추적성/색인 | [§21](requirements.md#21-decision-record와-코드의-연결)–[§22](requirements.md#22-왜-이렇게-구현되어-있지에-대한-대응) | 위와 동일 |
| 5 | Decision Intervention의 공식 기록화, "위험한 작업 승인" 등 일반화된 Review/Approval 워크플로우 | [§12.3](requirements.md#123-review--approval), [§12.4](requirements.md#124-decision-intervention) | MVP에서는 Direct Instruction으로 임시 대체 가능 |
| 6 | 3개 이상 프로젝트 확장, 동적 Agent 프로비저닝 | [§2](requirements.md#2-기본-운영-모델) | 2개로 핵심 패턴(격리·질문·개입) 검증 충분 |
| 7 | Linux 지원 | [§3](requirements.md#3-적용-대상-프로젝트) | requirements.md에서 이미 "추후 고려"로 명시 |

## 완료 기준 (Definition of Done)

다음 시나리오가 실제로 동작하면 MVP를 완료로 간주한다. **전 항목 실제 `claude -p` 세션으로 검증 완료** — 개별 검증 기록은 [architecture.md](architecture.md)의 해당 섹션을, 7개 전부를 하나로 잇는 통합 테스트는 [architecture.md §12.7](architecture.md#127-완료-기준-7개를-잇는-통합-테스트)(`src/manual-test-mvp-e2e.ts`)을 참고.

1. ✅ API Agent, Buyer BFF Agent 2개를 Orchestrator가 각각 독립된 세션으로 실행할 수 있다. (architecture.md §12.4)
2. ✅ Buyer BFF Agent가 정보 부족을 인지 → Question 생성 → Eligibility Check 통과 → Human이 터미널에서 승인/거절할 수 있다. (architecture.md §12.4)
3. ✅ 승인된 질문이 API Agent에게 전달되고, API Agent가 Answer Eligibility Check를 거쳐 답변 상태(`ANSWERABLE` 등)와 함께 답변한다. 답변이 Human Review를 거친 뒤 Buyer BFF Agent에게 전달된다. (architecture.md §12.4)
4. ✅ Human이 임의 시점에 특정 Agent를 Pause / Resume / Stop 할 수 있다. (architecture.md §12.6)
5. ✅ Human이 특정 Agent에게 Direct Instruction을 전달하면 해당 Agent의 다음 행동에 즉시 반영된다. (architecture.md §12.6 — `PAUSE`+프롬프트가 있는 `RESUME` 조합으로 구현)
6. ✅ 위 모든 이벤트가 Event Log에 시간순으로 기록되고 터미널에서 확인 가능하다. ([§6.1](architecture.md#61-구현-및-실측-검증), `admin-cli list-events`)
7. ✅ 각 Agent의 현재 상태가 실시간으로 표시된다. ([§12.5](architecture.md#125-agent-상태-cli-14-대응-mvp-scopemd-완료-기준-충족), `admin-cli list-agents`)

   **원안과의 차이**: `ANALYZING`/`IMPLEMENTING`/`WAITING_APPROVAL` 등 requirements.md §14의 단일 enum을 그대로 표시하는 대신, [data-model.md §2.2~2.3](data-model.md#22-lifecycle-state-신뢰-가능-오케스트레이터-동작을-결정)에서 신뢰 가능한 Lifecycle State(7개)와 조회 시점에 계산되는 참고용 Activity Label(`ANALYZING`/`IMPLEMENTING`/`TESTING`)로 분리했다. 도구 호출만으로 `ANALYZING`과 `IMPLEMENTING`을 구분하는 게 본질적으로 휴리스틱이라 오케스트레이터 동작(승인 대기 여부 등)의 근거로 쓰기엔 신뢰도가 낮다고 판단한 의도적 이탈이며, "실시간으로 상태를 확인할 수 있다"는 완료 기준의 취지 자체는 충족한다.

## Phase 2 이후와의 관계

MVP가 검증되면 다음 순서로 확장한다. 미해결 항목을 모아둔 목록은 [backlog.md](backlog.md) 참고.

- **Phase 2 (완료)**: Scribe Agent 도입, 최소 Decision Record(배경/문제/선택지/결정/근거) 기록. 실제 `claude -p` 세션으로 검증됨 — [architecture.md §13](architecture.md#13-phase-2-scribe-agent와-decision-record) 참고.
- **Phase 3 (완료)**: Decision Context 공식화(Decision Intervention 트리거, 거절 재작성), Decision History 재활용, Code ↔ Decision Record 추적성. 완료 기준 5개 전부 실제 `claude -p` 세션으로 검증됨 — [phase3-scope.md](phase3-scope.md) 참고.
- **Phase 4 (후보)**: 인터페이스 고도화(웹 UI 등) — 설계에 앞서 필요성부터 판단한다. 3개 이상 프로젝트 확장(신규 개발 불필요, 검증 작업)과 Linux 지원 검토(테스트 환경 확보 조건부)는 별도 Phase가 아니라 [backlog.md](backlog.md#지금-처리할-필요-없음-조건부-트리거)에서 관리한다.

  **선행 조건(해결됨)**: "Agent 신원 자가 신고" 한계 — [architecture.md §17](architecture.md#17-agent-신원-검증-123-해결) 참고. Agent별 mcp-config에 `ORCHESTRATOR_AGENT_ID`를 심어 연결 자체를 신뢰 경계로 쓰고, `from_agent_id` 인자가 이와 다르면 거절 + Event Log 기록하도록 고쳤다.
