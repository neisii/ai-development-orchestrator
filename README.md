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

## 현재 상태

아이디어 및 요구사항 정리 단계. 구현 기술 스택과 상세 설계는 아직 확정되지 않았으며, 요구사항 충족·성능·운영 편의성 등을 기준으로 이후 단계에서 결정합니다. (Windows/macOS 우선 지원, Linux는 추후 고려)
