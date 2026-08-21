Repository name:  ai-development-orchestrator
Project Title: AI Development Orchestrator
한 줄 설명: Human-in-the-loop orchestration system for coordinating multiple AI agents across software projects.
그리고 현재 정의한 핵심 개념은:
* Orchestrator — Agent 실행과 프로젝트 간 통신 조율
* Project Agent — 프로젝트별 구현 담당
* Scribe Agent — 의사결정 기록 담당
* Human — 요구사항, 설계, 판단 및 Intervention 담당
* Question / Answer Gate — Agent 간 정보 교환 품질 검증
* Decision Record — 의사결정의 배경과 근거 보존
* Event Log — Agent 활동 및 시스템 이벤트 기록

⸻


AI Agent 개발 오케스트레이션 파이프라인(가칭 ai-development-orchestrator) 요구사항

1. 프로젝트 목적

여러 개의 대규모 프로젝트를 각각 독립적인 AI Agent가 담당하고, Human이 전체 개발 과정을 오케스트레이션하는 개발 파이프라인을 구축한다.

기존에는 프로젝트별 디렉터리에서 각각 Claude Code를 실행하고, 각 세션의 로그를 관찰하면서 소스코드를 직접 분석하고 필요한 순간에 Agent에게 추가 지시를 내리는 방식으로 개발한다.

새로운 파이프라인은 이 과정을 체계화하여 다음을 가능하게 하는 것을 목표로 한다.

* 프로젝트별 AI Agent 독립 운영
* Agent 세션 관리
* Agent 활동 및 상태 모니터링
* Agent 간 컨텍스트 전달
* Agent 간 질문/답변 관리
* 질문 및 답변 품질 검증
* Human의 지속적인 개입 및 의사결정
* 요구사항·설계·구현 과정 관찰
* 의사결정 이력 보존
* 문제가 발생했을 때 즉각적인 조치
* 여러 프로젝트의 개발 진행 상황을 하나의 환경에서 관리

핵심 목표는 Human을 개발 과정에서 제거하는 것이 아니라, Human이 여러 AI Agent를 효율적으로 지휘하면서도 Agent의 구현 능력을 최대한 활용할 수 있도록 하는 것이다.

⸻

2. 기본 운영 모델

2.1 1 Agent : 1 Project

각 Agent는 하나의 프로젝트를 전담한다.

예를 들어 커머스 시스템이 다음과 같이 구성되어 있다면:

Commerce
├── Data Serving API
├── Buyer BFF
└── Seller BFF

각각 별도의 Agent를 할당한다.

Data Serving API → API Agent
Buyer BFF        → Buyer BFF Agent
Seller BFF       → Seller BFF Agent

하나의 Agent가 여러 프로젝트를 오가며 작업하는 방식은 기본적으로 사용하지 않는다.

프로젝트 규모가 크기 때문에 하나의 Agent가 여러 프로젝트의 컨텍스트를 동시에 관리하는 것보다 프로젝트별 컨텍스트를 격리하는 것이 효율적이라는 판단에 따른다.

⸻

3. 적용 대상 프로젝트

현재 파이프라인을 적용하려는 프로젝트의 대표적인 기술 특성은 다음과 같다.

* Spring Boot
* JDK 21
* Gradle

하지만 이는 오케스트레이션 파이프라인 자체의 기술 스택이 아니다.

오케스트레이션 시스템은 특정 언어, 프레임워크, GUI 기술 등에 제한되지 않는다.

오케스트레이션 기술 선택 기준

* 요구사항 충족
* 충분한 성능
* 효율적인 리소스 사용
* Claude Code 프로세스 및 세션 관리 용이성
* Agent 이벤트 수집 능력
* Agent 간 통신 지원
* Human 승인 및 개입 지원
* 안정적인 프로세스 제어
* 관찰 가능성
* 유지보수성
* Windows 지원
* macOS 지원

Linux 지원은 향후 고려한다.

따라서 구현 기술은 요구사항과 상세 설계 과정에서 결정한다.

⸻

4. Human의 역할

Human은 단순한 Agent 간 메시지 전달자가 아니다.

전체 개발 과정에서 다음 역할을 수행한다.

* 요구사항 분석
* 요구사항 구체화
* 설계 논의
* 프로젝트 간 책임 범위 결정
* 완료 기준 결정
* Agent의 작업 과정 관찰
* Agent가 제안한 방안 검토
* 구현 방향 수정
* Agent 간 통신 승인
* 의사결정
* Agent 직접 지시
* 작업 중단 및 재개
* 잘못된 구현 방향 수정
* 새로운 요구사항 전달

즉 Human은 개발 과정의 최종 판단권자이자 오케스트레이터다.

⸻

5. 구현 시작 전 프로세스

Agent는 요구사항을 받은 즉시 코딩하는 것을 기본으로 하지 않는다.

요구사항
   ↓
요구사항 분석
   ↓
요구사항 구체화
   ↓
설계 논의
   ↓
프로젝트 책임 범위 확인
   ↓
프로젝트 간 의존성 확인
   ↓
완료 기준 결정
   ↓
구현 착수

Human과 Agent가 무엇을 구현할 것인지뿐만 아니라 어떤 상태를 완성으로 판단할 것인지를 결정한 후 구현을 시작한다.

⸻

6. 프로젝트 컨텍스트 격리

각 Agent는 자신의 담당 프로젝트를 중심으로 작업한다.

다른 프로젝트의 정보를 임의로 추측하거나 직접 접근하여 판단하는 것을 기본적으로 허용하지 않는다.

예를 들어 Buyer BFF Agent가 API Response의 특정 필드를 알아야 하는데 자신의 프로젝트에 정보가 없다면 추측해서 구현하지 않는다.

해당 정보를 소유한 API Agent에게 질문한다.

Buyer BFF Agent
       │
       │ 정보 부족
       ▼
Question 생성
       │
       ▼
Orchestrator
       │
       ▼
API Agent

핵심 원칙:

모르는 정보를 추측하지 않고, 해당 정보를 소유한 Agent에게 확인한다.

⸻

7. Agent 간 통신

Agent 간 통신을 지원한다.

모든 Agent 간 통신은 기본적으로 Orchestrator를 거친다.

Agent A
   ↓
Orchestrator
   ↓
Agent B

이를 통해 다음을 확보한다.

* 통신 흐름 관찰
* 메시지 기록
* 승인 처리
* 통신 차단
* Human 개입
* 통신 이력 추적
* 프로젝트 간 의존성 파악

Agent끼리 직접 통신하는 구조는 기본 모델로 사용하지 않는다.

⸻

8. 질문 생성 품질 검증

Agent가 다른 프로젝트의 정보가 필요하다고 판단했다고 해서 바로 질문하지 않는다.

먼저 Question Eligibility Check를 수행한다.

검토 항목의 예:

* 현재 컨텍스트만으로 해결 가능한가?
* 정말 다른 프로젝트 정보가 필요한가?
* 다른 프로젝트의 책임 영역인가?
* 질문 대상 Agent가 적절한가?
* 필요한 정보가 명확한가?
* 대상 Agent가 답변할 수 있는 질문인가?
* 답변을 받으면 현재 작업을 진행할 수 있는가?

조건을 충족하면 질문을 생성한다.

질문의 품질이 부족하면 Agent가 스스로 보완한다.

횟수 기반 자기반성은 요구하지 않는다.

핵심은 질문을 보내기 전에 질문의 필요성과 품질을 스스로 검증하는 것이다.

⸻

9. 질문 Human Review

질문이 생성되면 바로 전달하지 않는다.

Agent
 ↓
Question Eligibility Check
 ↓
Question 생성
 ↓
Human Review
 ↓
Approve / Reject

Human이 질문 내용과 전달 필요성을 검토한다.

승인된 질문만 대상 Agent에게 전달한다.

⸻

10. 답변 품질 검증

질문을 받은 Agent 역시 즉시 답변하지 않는다.

Answer Eligibility Check를 수행한다.

검토 항목의 예:

* 질문을 정확히 이해했는가?
* 자신의 프로젝트 책임 영역인가?
* 필요한 정보가 충분한가?
* 실제 코드·설계·스펙에 근거하고 있는가?
* 추측 없이 답변할 수 있는가?
* 질문을 충분히 충족하는가?
* 기존 정보와 충돌하지 않는가?

⸻

11. 답변 불가능한 상황

Agent는 모르는 정보를 억지로 답변하지 않는다.

예:

ANSWERABLE
PARTIALLY_ANSWERABLE
INSUFFICIENT_CONTEXT
OUT_OF_SCOPE
AMBIGUOUS
CONFLICTING_INFORMATION
UNKNOWN

특히 UNKNOWN은 정상적인 결과다.

목표는 항상 답변하는 Agent가 아니라 근거가 있는 답변을 제공하는 Agent다.

⸻

12. Human Intervention

Human Intervention은 예외적인 장애 처리 기능이 아니다.

AI Agent와 함께 개발할 때 지속적으로 발생하는 정상적인 개발 행위로 정의한다.

Human은 Agent가 자율적으로 작업하도록 방치하는 것이 아니라, Agent의 분석과 구현을 관찰하면서 필요할 때 적극적으로 개입한다.

Human Intervention은 다음 네 가지 영역으로 구분한다.

12.1 Execution Control

Agent의 실행 상태를 제어한다.

* Pause
* Resume
* Stop
* Cancel

예:

“현재 수정 범위가 너무 커지는 것 같으니 일단 멈춰.”

⸻

12.2 Direct Instruction

Human이 Agent에게 직접 추가 지시를 전달한다.

예:

“API Agent에게 질문하지 말고 현재 API 스펙을 기준으로 구현해.”

“방금 결정한 방향을 기준으로 계속 구현해.”

“요구사항을 다시 확인했는데 이 부분은 변경해야 한다. 기존 계획을 수정해.”

이는 Agent의 작업 방향을 실시간으로 조정하기 위한 핵심 기능이다.

⸻

12.3 Review / Approval

Agent가 요청한 사항을 Human이 검토하고 승인 또는 거절한다.

예:

* Agent 질문 승인/거절
* Agent 답변 검토
* 구현 계획 승인
* 위험한 작업 승인
* 특정 설계 변경 승인

⸻

12.4 Decision Intervention

Agent의 제안에 대해 Human이 최종 의사결정을 내린다.

예:

Agent
 └─ A안 / B안 제안
          ↓
       Human
          ↓
    "A안으로 결정"

또는:

Agent
 └─ A안 제안
          ↓
       Human
          ↓
   "A안 대신 C안으로 변경"

이러한 Human Intervention은 단순 명령이 아니라 의사결정 이벤트가 될 수 있다.

⸻

13. Agent Activity / Event Log

Agent에서 발생하는 활동은 관찰 가능한 이벤트로 관리한다.

예:

* 파일 읽기
* 파일 수정
* 명령 실행
* 테스트 실행
* 테스트 결과
* 오류
* 작업 상태 변경
* 질문 생성
* 답변 생성
* Human Intervention

하지만 이것은 Decision Record와 구분한다.

Event Log
→ 무슨 일이 발생했는가?
Decision Record
→ 왜 이런 선택을 했는가?

⸻

14. Agent 상태

Agent의 상태를 시스템에서 명확하게 표현한다.

예:

ANALYZING
PLANNING
IMPLEMENTING
TESTING
WAITING_APPROVAL
WAITING_AGENT
WAITING_HUMAN
COMPLETED
FAILED
PAUSED

실제 상태 모델은 상세 설계 과정에서 확정한다.

⸻

15. Scribe Agent

별도의 Scribe Agent를 둔다.

Scribe는 프로젝트 구현을 담당하지 않는다.

역할은 다음과 같다.

각 Agent와 Human의 개발 과정에서 발생한 의미 있는 의사결정 관련 정보를 수집하고, 의사결정의 배경과 문제, 선택지, 비교 및 근거, 결론을 사람이 이해할 수 있는 기록으로 정리한다.

즉 개발팀의 회의록 작성자 / 서기 역할이다.

⸻

16. Scribe가 기록하지 않는 것

단순 활동 로그는 Decision Record의 대상이 아니다.

예:

Buyer BFF Agent가 ProductResponse.java를 읽었다.

API Agent가 특정 테스트를 실행했다.

API Agent가 특정 파일을 수정했다.

이러한 정보는 Event Log의 영역이다.

Scribe가 참고할 수는 있지만 그 자체가 의사결정 기록은 아니다.

⸻

17. Scribe가 기록하는 것

Scribe는 왜 특정 선택이 이루어졌는지를 기록한다.

기본적인 Decision Record 구조는 다음을 포함한다.

배경

왜 이 결정이 필요하게 되었는가?

문제

무엇을 해결해야 했는가?

제약사항

결정에 영향을 미치는 기존 구조나 요구사항은 무엇인가?

선택지

어떤 대안들이 검토되었는가?

선택지 비교

각 선택지의:

* 장점
* 단점
* 영향
* 비용
* 위험
* 기존 구조와의 관계

등을 기록한다.

판단 근거

왜 특정 선택지를 선택하거나 제외했는가?

결론

무엇을 결정했는가?

결정 주체

누가 최종 결정했는가?

관련 정보

가능하면:

* 요구사항
* 프로젝트
* Agent 질문
* Agent 답변
* 설계
* 구현
* 코드

등을 연결한다.

⸻

18. Decision Context

의사결정은 단순한 하나의 이벤트가 아니라 의사결정이 발생한 문맥 단위로 관리한다.

개념적인 구조:

Decision Trigger
        ↓
Decision Context
        ↓
Problem
        ↓
Constraints
        ↓
Options
        ↓
Evaluation
        ↓
Discussion
        ↓
Decision
        ↓
Decision Record

Decision Trigger

결정이 필요해진 계기.

Decision Context

결정 당시의 프로젝트 및 기술적 상황.

Problem

해결해야 하는 문제.

Constraints

결정에 영향을 미치는 제약.

Options

검토 가능한 대안.

Evaluation

대안에 대한 비교와 평가.

Discussion

Agent와 Human 사이에서 이루어진 논의.

Decision

최종 선택.

Decision Record

위 정보를 지속 가능한 문서 형태로 정리한 결과물.

구체적인 데이터 모델과 상태 전이는 상세 설계 단계에서 확정한다.

⸻

19. Scribe는 결정을 내리지 않는다

Scribe의 권한을 명확히 제한한다.

Scribe
O 의사결정 내용 기록
O 논의 내용 구조화
O 선택지와 근거 정리
O 관련 정보 연결
O Decision Record 생성
O 기존 기록 업데이트
X 기술적 결정
X 요구사항 결정
X 설계 결정
X Human 결정 대체
X Agent에게 구현 지시

Scribe는 결정자가 아니라 기록자다.

⸻

20. Orchestrator와 Scribe

Scribe가 모든 Claude Code 로그를 직접 읽고 중요한 결정을 추측하게 하는 구조는 지양한다.

Orchestrator가 Agent와 Human 사이에서 발생한 의사결정 관련 정보를 수집하고, 이를 Scribe가 정리한다.

Agent A ─┐
Agent B ─┼──► Orchestrator
Human ───┘           │
                     ▼
              Decision Context
                     │
                     ▼
                Scribe Agent
                     │
                     ▼
              Decision Record

이를 통해 Scribe가 임의로 사건의 인과관계를 만들거나 중요하지 않은 활동을 의사결정으로 오인하는 문제를 줄인다.

⸻

21. Decision Record와 코드의 연결

Decision Record는 가능하면 실제 구현과 연결한다.

Code
 ↓
Decision Record
 ↓
문제
 ↓
검토했던 선택지
 ↓
선택하지 않은 대안
 ↓
최종 결정 근거

반대로:

Decision Record
 ↓
Requirement
 ↓
Question / Answer
 ↓
Project
 ↓
Implementation
 ↓
Code

와 같이 역방향 탐색도 가능하도록 한다.

목표는 코드와 의사결정 사이의 추적성을 확보하는 것이다.

⸻

22. “왜 이렇게 구현되어 있지?“에 대한 대응

이 기능의 중요한 사용 사례 중 하나다.

개발 과정에서 다음과 같은 질문이 발생할 수 있다.

왜 여기서는 이렇게 처리하지?

왜 API가 이 데이터를 제공하지 않지?

왜 BFF에서 이 작업을 하고 있지?

왜 이 설계를 선택했지?

왜 더 단순한 방법을 사용하지 않았지?

코드는 현재 상태는 보여주지만 현재 구현을 선택하게 만든 과거의 맥락까지 항상 보존하지는 않는다.

Decision History를 통해:

현재 구현
   ↓
관련 Decision Record
   ↓
당시 문제
   ↓
검토한 선택지
   ↓
선택하지 않은 대안
   ↓
선택 근거
   ↓
최종 결정

을 추적할 수 있도록 한다.

따라서 Decision History는 단순 문서가 아니라 프로젝트의 장기적인 의사결정 기억으로 활용한다.

⸻

23. Decision History의 재활용

과거 의사결정은 새로운 작업에서 Agent의 컨텍스트로 활용할 수 있다.

새로운 Task
     ↓
관련 Decision History 탐색
     ↓
관련 Decision Context 제공
     ↓
담당 Agent
     ↓
기존 결정과의 충돌 여부 확인
     ↓
구현

이를 통해 Agent가 과거에 이미 내려진 중요한 결정을 모르고 동일한 문제를 다시 검토하거나 기존 설계와 충돌하는 구현을 하는 것을 방지할 수 있다.

⸻

24. 전체 시스템 개념 구조

                              Human
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
          요구사항            설계              Intervention
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                         ┌──────▼──────┐
                         │ Orchestrator│
                         └──────┬──────┘
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
        API Agent          Buyer BFF          Seller BFF
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                         Agent / Human
                              Events
                                │
                                ▼
                       Decision Context
                                │
                                ▼
                         Scribe Agent
                                │
                                ▼
                     Decision Records
                                │
                                ▼
                  Project Decision History

⸻

25. 전체 개발 흐름

                         Human
                           │
                           ▼
                     요구사항 분석
                           │
                           ▼
                     요구사항 구체화
                           │
                           ▼
                       설계 논의
                           │
                           ▼
                     완료 기준 결정
                           │
                           ▼
                     담당 Agent 실행
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
          자체 분석                  정보 부족
              │                         │
              │                         ▼
              │                Question Eligibility
              │                         │
              │                         ▼
              │                    Question
              │                         │
              │                         ▼
              │                  Human Approval
              │                         │
              │                         ▼
              │                  Target Agent
              │                         │
              │                         ▼
              │               Answer Eligibility
              │                         │
              │                         ▼
              │                      Answer
              │                         │
              │                         ▼
              │                  Human Review
              │                         │
              └─────────────┬───────────┘
                            │
                            ▼
                       구현 / 테스트
                            │
                            ▼
                   Human 관찰 / Intervention
                            │
                            ▼
                          완료
의사결정 발생 시:
문제 / 배경
      ↓
선택지
      ↓
비교 / 평가
      ↓
Agent ↔ Human 논의
      ↓
Human 결정
      ↓
Decision Context
      ↓
Scribe Agent
      ↓
Decision Record
      ↓
Decision History

⸻

26. 핵심 원칙

1. 1 Agent : 1 Project
    * 프로젝트별 컨텍스트를 격리한다.
2. Human-in-the-loop
    * Human은 개발 과정의 핵심 의사결정권자다.
3. Human Intervention은 정상적인 개발 과정이다
    * 예외적인 장애 대응으로 취급하지 않는다.
    * 실행 제어뿐 아니라 직접 지시, 검토, 승인, 의사결정 개입을 포함한다.
4. Agent 간 통신은 Orchestrator를 통한다
    * 모든 프로젝트 간 컨텍스트 전달을 중앙에서 관리한다.
5. 질문 전에 검증한다
    * 질문의 필요성과 품질을 Agent가 스스로 확인한다.
6. 답변 전에 검증한다
    * 답변 가능 여부와 근거를 Agent가 스스로 확인한다.
7. 모르는 것을 추측하지 않는다
    * UNKNOWN, INSUFFICIENT_CONTEXT 등의 결과를 정상적으로 허용한다.
8. Event Log와 Decision Record를 구분한다
    * 작업 이력과 의사결정 이력은 서로 다른 목적을 가진다.
9. Scribe는 결정하지 않는다
    * Scribe는 회의록 작성자이며 의사결정권자가 아니다.
10. 의사결정의 맥락을 보존한다
    * 배경, 문제, 제약, 선택지, 비교, 근거, 결론을 기록한다.
11. 코드와 의사결정을 연결한다
    * “왜 이렇게 구현되어 있는가?“라는 질문에 답할 수 있어야 한다.
12. Decision History를 미래의 컨텍스트로 활용한다
    * 과거의 설계 의도를 새로운 작업에서도 재사용한다.
13. 관찰 가능성을 보장한다
    * Human은 각 Agent의 활동과 프로젝트 간 통신을 확인할 수 있어야 한다.
14. 즉각적인 개입을 보장한다
    * Human은 필요한 경우 Agent의 작업을 즉시 제어할 수 있어야 한다.
15. 자동화보다 통제 가능성을 우선한다
    * 목표는 Human을 제거하는 것이 아니라 Human의 판단력을 여러 Agent에 효과적으로 적용하는 것이다.
16. 오케스트레이션 구현 기술에는 제한을 두지 않는다
    * 특정 언어나 프레임워크를 선결정하지 않는다.
    * 요구사항, 성능, 효율성, 운영 편의성을 기준으로 선택한다.
    * Windows와 macOS를 우선 지원한다.
    * Linux는 추후 고려한다.

⸻

최종 정의

프로젝트별 독립된 AI Agent를 배치하고, Human이 요구사항·설계·완료 기준과 중요한 의사결정을 담당하며, Agent 간 컨텍스트 교환을 Orchestrator를 통해 검증·관리하고, Human이 각 Agent의 개발 과정을 지속적으로 관찰하고 직접 개입할 수 있도록 하며, 중요한 의사결정의 배경·문제·제약·선택지·비교·근거·결론을 Scribe Agent가 지속적으로 기록하여 프로젝트의 장기적인 Decision History로 보존하는 Human-in-the-loop AI 개발 오케스트레이션 파이프라인.