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
- [아키텍처 (architecture.md)](docs/architecture.md) — Claude Code 헤드리스/hook/MCP를 조합한 오케스트레이터 설계, 실측 검증 기록
- [데이터 모델 (data-model.md)](docs/data-model.md) — Agent/Question/Answer/Event Log/Intervention 스키마
- [다이어그램 (diagrams.md)](docs/diagrams.md) — 유스케이스 다이어그램, Question/Answer 왕복·Human Intervention 시퀀스 다이어그램

## 현재 상태

MVP 구현 및 실측 검증 완료. Node.js/TypeScript로 `src/`에 다음을 구현했다.

- `ProcessManager` — Agent(Claude Code 헤드리스 세션) spawn/pause/resume/stop
- MCP 서버(`ask_agent`/`answer_question`) — Agent 간 통신을 강제로 오케스트레이터 경유시킴
- Hook 수신 서버 — Event Log 수집
- `Orchestrator` — 승인된 질문/답변 자동 전달, Agent 상태 기록, Human Intervention 적용
- `admin-cli` — 질문/답변 승인, Event Log·Agent 상태 조회, Pause/Resume/Stop/Direct Instruction

mvp-scope.md의 완료 기준 7개 모두 실제 `claude -p` 세션으로 검증됨(각 항목의 실측 기록은 architecture.md 참고). Scribe Agent/Decision Record는 계획대로 제외되어 있으며, 다음 단계는 mvp-scope.md의 Phase 2 이후를 참고. (Windows/macOS 우선 지원, Linux는 추후 고려)
