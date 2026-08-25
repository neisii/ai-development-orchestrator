# AI Development Orchestrator

Human-in-the-loop orchestration system for coordinating multiple AI agents across software projects.

여러 개의 대규모 프로젝트를 각각 독립적인 AI Agent가 담당하고, Human이 전체 개발 과정을 오케스트레이션하는 개발 파이프라인입니다.

핵심 목표는 Human을 개발 과정에서 제거하는 것이 아니라, Human이 여러 AI Agent를 효율적으로 지휘하면서도 Agent의 구현 능력을 최대한 활용할 수 있도록 하는 것입니다.

## 핵심 개념

- **Orchestrator** — Agent 실행과 프로젝트 간 통신 조율
- **Project Agent** — 프로젝트별 구현 담당
- **Scribe Agent** — 의사결정 기록 담당
- **Human** — 요구사항, 설계, 판단 및 Intervention 담당
- **Question / Answer Gate** — Agent 간 정보 교환 품질 검증
- **Decision Record** — 의사결정의 배경과 근거 보존
- **Event Log** — Agent 활동 및 시스템 이벤트 기록

자세한 정의는 [docs/glossary.md](docs/glossary.md)를 참고하세요.

## 문서

- [요구사항 (requirements.md)](docs/requirements.md) — 프로젝트 목적, 운영 모델, Human/Agent 역할, 통신·질문/답변·Human Intervention·Scribe·Decision Record 규칙, 핵심 원칙
- [핵심 개념 (glossary.md)](docs/glossary.md)
- [MVP 범위 (mvp-scope.md)](docs/mvp-scope.md) — 1단계에서 검증할 최소 범위와 완료 기준
- [Phase 3 범위 (phase3-scope.md)](docs/phase3-scope.md) — Decision Context 확장, History 검색, Code 추적성 범위 정의
- [아키텍처 (architecture.md)](docs/architecture.md) — Claude Code 헤드리스/hook/MCP를 조합한 오케스트레이터 설계, 실측 검증 기록
- [데이터 모델 (data-model.md)](docs/data-model.md) — Agent/Question/Answer/Event Log/Intervention/Decision Record 스키마
- [다이어그램 (diagrams.md)](docs/diagrams.md) — 유스케이스 다이어그램, Question/Answer 왕복·Human Intervention 시퀀스 다이어그램
- [백로그 (backlog.md)](docs/backlog.md) — 미해결 항목, 조건부 트리거, 다음 Phase 계획
- [실 테스트 가이드 (testing-guide.md)](docs/testing-guide.md) — 직접 실행해서 확인하는 방법(자동 시나리오 지켜보기, `npm run demo`로 직접 개입해보기)
- [조사: MCP 세션 지연 (investigation-mcp-session-delay.md)](docs/investigation-mcp-session-delay.md) — "원인 불명의 지연"으로 남아있던 문제를 단계별로 격리해 근본 원인(`ORCHESTRATOR_DB_PATH` 누락)을 찾고 고친 기록

## 현재 상태

Phase 1(MVP 오케스트레이션 루프) + Phase 2(Scribe Agent/Decision Record) + Phase 3(Decision Intervention 트리거, 거절 재작성, History 검색, Code 추적성) 구현 완료. Node.js/TypeScript로 `src/`에 다음을 구현했다.

- `ProcessManager` — Agent(Claude Code 헤드리스 세션) spawn/pause/resume/stop
- MCP 서버(`ask_agent`/`answer_question`/`submit_decision_record`) — Agent 간 통신, Scribe의 기록 제출을 전부 오케스트레이터 경유로 강제
- Hook 수신 서버 — Event Log 수집
- `Orchestrator` — 승인된 질문/답변 자동 전달, Agent 상태 기록, Human Intervention 적용, 거절 사유가 있는 Question/Answer·Decision Intervention·거절된 Decision Record(재작성)를 Scribe Agent에게 자동 위임
- `admin-cli` — 질문/답변 승인, Event Log·Agent 상태 조회, Pause/Resume/Stop/Direct Instruction, Decision Record 검토·승인, Decision Intervention 기록(`decide-choice`), 과거 결정 검색(`search-decisions`)·파일 경로로 역추적(`show-decisions-for-file`)
- `run-demo`(`npm run demo`) — 빈 임시 디렉터리로 오케스트레이션 메커니즘 자체를 지켜보는 인터랙티브 진입점
- `run`(`npm run start`) — `orchestrator.config.json`에 적은 **실제 프로젝트 경로**로 Agent를 띄우는 진입점 (템플릿: `orchestrator.config.example.json`)

mvp-scope.md의 MVP 완료 기준 7개, Phase 2 흐름, Phase 3(Decision Intervention 트리거·거절 재작성·History 검색·파일 추적성 DoD 5개)까지 전부 실제 `claude -p` 세션으로 검증됨(실측 기록은 architecture.md 참고). Scribe Agent는 `submit_decision_record` 도구 하나만 가질 수 있어 코드 수정이나 다른 Agent 지시가 구조적으로 불가능하다. 사용법은 [testing-guide.md](docs/testing-guide.md), 미해결 항목과 다음 단계는 [backlog.md](docs/backlog.md) 참고. (Windows/macOS 우선 지원, Linux는 추후 고려)
