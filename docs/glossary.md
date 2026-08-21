# 핵심 개념 (Glossary)

| 개념 | 정의 |
|---|---|
| **Orchestrator** | Agent 실행과 프로젝트 간 통신을 조율하는 중앙 구성 요소. 모든 Agent 간 통신, Human의 개입, Decision Context 수집이 이곳을 경유한다. |
| **Project Agent** | 프로젝트별 구현을 담당하는 Agent. 1 Agent : 1 Project 원칙에 따라 각자 담당 프로젝트의 컨텍스트만 다룬다. (예: API Agent, Buyer BFF Agent, Seller BFF Agent) |
| **Scribe Agent** | 프로젝트 구현에는 관여하지 않고, Agent·Human의 의사결정 관련 정보를 수집해 Decision Record로 정리하는 전담 Agent. 결정자가 아니라 기록자다. |
| **Human** | 요구사항 분석, 설계 논의, 완료 기준 결정, 의사결정, Intervention을 담당하는 최종 판단권자. |
| **Question / Answer Gate** | Agent 간 정보 교환의 품질을 검증하는 절차. 질문 전에는 Question Eligibility Check, 답변 전에는 Answer Eligibility Check를 거친다. |
| **Decision Record** | 하나의 의사결정에 대한 배경, 문제, 제약, 선택지, 비교, 근거, 결론을 사람이 이해할 수 있게 정리한 기록. |
| **Event Log** | Agent의 활동(파일 읽기/수정, 명령 실행, 테스트, 오류, 상태 변경 등)을 기록한 이벤트 로그. "무슨 일이 발생했는가"를 다루며, "왜"를 다루는 Decision Record와 구분된다. |

각 개념의 상세 규칙과 흐름은 [requirements.md](requirements.md)를 참고한다.
