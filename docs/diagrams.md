# 다이어그램

지금까지 구현·검증된 MVP 오케스트레이션 루프([architecture.md](architecture.md) §12, [mvp-scope.md](mvp-scope.md) 완료 기준 7개)를 유스케이스 다이어그램과 시퀀스 다이어그램으로 표현한다.

## 1. 유스케이스 다이어그램

Mermaid는 UML 유스케이스 다이어그램을 네이티브로 지원하지 않아, flowchart로 근사했다(액터는 사각형, 유스케이스는 스타디움 도형).

```mermaid
flowchart LR
    Human(("👤 Human"))

    subgraph SYS["AI Development Orchestrator"]
        UC1(["Agent 시작/중단
Start / Stop"])
        UC2(["Agent 일시정지/재개
Pause / Resume"])
        UC3(["직접 지시 전달
Direct Instruction"])
        UC4(["질문 승인/거절
Decide Question"])
        UC5(["답변 승인/거절
Decide Answer"])
        UC6(["Agent 상태 조회
List Agents"])
        UC7(["Event Log 조회
List Events"])
        UC8(["다른 Agent에게 질문
Ask Agent"])
        UC9(["질문에 답변
Answer Question"])
    end

    AgentA(["📦 Project Agent
(질문하는 쪽)"])
    AgentB(["📦 Project Agent
(답변하는 쪽)"])

    Human --- UC1
    Human --- UC2
    Human --- UC3
    Human --- UC4
    Human --- UC5
    Human --- UC6
    Human --- UC7

    AgentA -.발동.-> UC8
    AgentB -.발동.-> UC9
    UC8 -."Human 승인 필요".-> UC4
    UC9 -."Human 승인 필요".-> UC5
```

`admin-cli`가 Human 쪽 유스케이스(UC1~UC7)의 진입점이고, Project Agent는 MCP 도구(`ask_agent`/`answer_question`) 호출로 UC8/UC9를 스스로 발동시키지만 반드시 Human 승인(UC4/UC5)을 거쳐야 실제로 전달된다 — requirements.md §7~11의 "Agent 간 직접 통신 금지 + Human Review" 원칙이 유스케이스 구조 자체에 그대로 드러난다.

## 2. 시퀀스 다이어그램

### 2.1 Question → Answer 전체 왕복

[architecture.md §12.7](architecture.md#127-완료-기준-7개를-잇는-통합-테스트)의 통합 테스트(`manual-test-mvp-e2e.ts`)에서 실제로 검증된 흐름이다. `ask_agent`는 **답변이 아니라 질문이 승인되는 시점**에 바로 반환된다는 게 핵심이라, Agent A의 1차 턴은 Agent B가 답하기 한참 전에 이미 끝난다.

```mermaid
sequenceDiagram
    actor Human
    participant A as Project Agent A<br/>(질문하는 쪽)
    participant MCP as MCP 서버<br/>(ask_agent/answer_question)
    participant DB as SQLite<br/>(Question/Answer/EventLog)
    participant Orch as Orchestrator<br/>(polling)
    participant B as Project Agent B<br/>(답변하는 쪽)

    Human->>A: start(prompt)
    A->>MCP: ask_agent(question)
    MCP->>DB: INSERT Question<br/>(PENDING_HUMAN_REVIEW)
    Note over MCP: 도구 호출 보류,<br/>1초 간격 폴링

    Human->>DB: admin-cli decide-question approve
    DB-->>MCP: 다음 폴링에서 APPROVED 확인
    MCP-->>A: tool result: "질문 승인됨"
    A-->>Human: 1차 턴 COMPLETED

    Orch->>DB: tick() 폴링 (2초 간격)
    DB-->>Orch: 승인됐지만 미전달 Question 발견
    Orch->>B: start(질문이 담긴 프롬프트)
    Orch->>DB: markQuestionDelivered

    B->>MCP: answer_question(answer, contentStatus)
    MCP->>DB: INSERT Answer (PENDING_HUMAN_REVIEW)<br/>UPDATE Question -> ANSWERED
    Note over MCP: 도구 호출 보류, 폴링

    Human->>DB: admin-cli decide-answer approve
    DB-->>MCP: 다음 폴링에서 APPROVED 확인
    MCP-->>B: tool result: "답변 승인됨"
    B-->>Orch: 턴 COMPLETED

    Orch->>DB: tick() 폴링
    DB-->>Orch: 승인됐지만 미전달 Answer 발견
    Orch->>A: resume(답변이 담긴 프롬프트)
    Orch->>DB: markAnswerDelivered
    A-->>Human: 2차 턴 COMPLETED (최종 응답)
```

### 2.2 Human Intervention (Pause → Direct Instruction)

`admin-cli`는 "개입 요청"만 DB에 남기고, 실제 `SIGTERM`/`--resume` 호출은 살아있는 `ProcessManager`를 쥐고 있는 Orchestrator가 폴링하며 수행한다 — Question/Answer 승인과 동일한 요청/실행 분리 구조다.

```mermaid
sequenceDiagram
    actor Human
    participant DB as SQLite<br/>(Intervention/EventLog)
    participant Orch as Orchestrator<br/>(polling)
    participant PM as ProcessManager
    participant Agent as Project Agent<br/>(claude -p 프로세스)

    Note over Agent: 긴 텍스트 생성 중 (RUNNING)

    Human->>DB: admin-cli pause-agent
    Orch->>DB: tick() 폴링, PAUSE 발견
    Orch->>PM: pause()
    PM->>Agent: SIGTERM
    Agent-->>PM: exit code 143 (턴 미완료 기록)
    PM-->>Orch: lifecycle -> PAUSED
    Orch->>DB: INTERVENTION 이벤트 기록<br/>(kind=PAUSE)

    Human->>DB: admin-cli instruct-agent (새 지시)
    Note over DB: PAUSE 요청(이미 정지됨, no-op)<br/>+ prompt 있는 RESUME 요청 순서대로 큐잉
    Orch->>DB: tick() 폴링, RESUME 발견
    Orch->>PM: resume(새 지시 prompt)
    PM->>Agent: claude -p --resume <sessionId> "새 지시"
    Agent-->>PM: lifecycle -> RUNNING -> COMPLETED
    Orch->>DB: INTERVENTION 이벤트 기록<br/>(kind=RESUME, prompt 포함)
```

두 시퀀스 다이어그램 모두 [architecture.md §12.4](architecture.md#124-processmanager--qa-storemcp-server-통합), [§12.6](architecture.md#126-human-intervention의-event-log-기록), [§12.7](architecture.md#127-완료-기준-7개를-잇는-통합-테스트)에서 실제 `claude -p` 세션으로 검증된 내용을 그대로 옮긴 것이다.
