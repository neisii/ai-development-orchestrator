# Phase 3 범위 정의

**상태: 구현 완료, 실제 세션 왕복 미실증.** 아래 범위 그대로 `src/`에 구현됐고 `npx tsc --noEmit` 통과와 스토어 계층 직접 테스트로 코드 정확성은 확인됐다. 다만 완료 기준 4번이 요구하는 "실제 세션으로 확인"까지는 아직 못했다 — 사유는 [backlog.md](backlog.md), 구현 상세는 [architecture.md §15](architecture.md#15-phase-3-decision-intervention-트리거--거절-재작성-경로--history-검색--파일-추적성) 참고.

[mvp-scope.md](mvp-scope.md)/[backlog.md](backlog.md)에서 Phase 3로 미뤄둔 세 가지(Decision Context 공식화, Decision History 재활용, Code ↔ Decision Record 추적성)와, 이미 백로그에 있던 "Decision Record 거절 시 재작성 경로 없음"을 함께 다룬다. MVP 때와 같은 원칙 — 구현 전에 범위부터 정의하고, 확신 없는 자동화(휴리스틱)보다는 사람이 개입하는 명시적 경로를 우선한다 — 을 그대로 따른다.

## 1. Decision Context 공식화 (requirements.md §18)

### 1.1 지금 상태

`Decision Trigger → Context → Problem → Constraints → Options → Evaluation → Discussion → Decision → Record` 9단계 중, 우리가 실제로 다루는 건 마지막 결과물(Record)뿐이다. `Discussion`(Agent-Human 간 논의)은 전혀 모델링돼 있지 않고, 트리거도 "사유가 있는 Question/Answer 거절" 하나뿐이다.

### 1.2 제안하는 범위

- **트리거 확장**: `Decision Intervention`(requirements.md §12.4 — Agent가 A안/B안을 제안하고 Human이 그중 하나를 고르거나 다른 안으로 바꾸는 것)을 새 트리거로 추가한다. mvp-scope.md에서 "MVP에서는 Direct Instruction으로 임시 대체 가능"이라고 미뤄뒀던 바로 그 항목이다. `admin-cli`에 `decide-choice <agentId> <선택한 안> [근거]` 같은 명령을 추가해서, 이걸 호출하면 Question/Answer 거절과 동일하게 Scribe가 자동으로 깨어난다.
- **Discussion은 "거절 시 재작성"으로 최소 구현**: 완전한 다회 대화 모델링은 과하다고 본다. 대신 §2(아래)의 "재작성 경로"를 만들면, Human이 Scribe 초안을 거절 → 사유 전달 → Scribe 재작성이라는 왕복 자체가 최소한의 Discussion이 된다.
- **9단계를 그대로 상태 필드로 늘리지 않는다**: `DecisionRecord`에 `trigger/context/problem/...` 9개 컬럼을 각각 만드는 대신, 지금처럼 최종 9개 필드(배경/문제/제약사항/선택지/선택지 비교/판단 근거/결론/결정 주체/관련 정보)로 충분하다고 본다 — 9단계 파이프라인은 "그 결과물에 뭐가 들어가야 하는가"에 대한 사양이지, 별도로 추적해야 하는 상태 기계는 아니라고 판단했다.

## 2. Decision Record 거절 시 재작성 경로 (백로그 이월)

Question/Answer는 거절 사유가 도구 호출 응답으로 그 자리에서 돌아가 Agent가 재시도할 수 있는데, Decision Record는 `REJECTED`가 종단 상태라 Scribe가 사유를 돌려받지 못한다.

### 제안

Question/Answer와 같은 패턴을 그대로 적용한다: `decide-decision <id> reject "사유"`가 실행되면, Orchestrator가 그 사유를 담아 Scribe를 다시 깨우고(`buildDecisionRevisionPrompt`), Scribe가 `submit_decision_record`를 다시 호출하면 **새 레코드가 아니라 같은 레코드를 갱신**한다(`§17 "기존 기록 업데이트"`가 이미 Scribe의 허용 범위에 있음 — data-model.md §7.1을 보면 `decision_records` 테이블에 갱신용 메서드가 없을 뿐, 막을 이유는 없다).

## 3. Decision History 재활용 (requirements.md §23)

### 3.1 제안하는 범위: 자동 주입이 아니라 수동 검색

과거 결정을 **자동으로** "관련 있어 보이는" 걸 판단해서 새 작업 프롬프트에 끼워넣는 건, 지금까지 이 프로젝트에서 반복해온 원칙(Activity Label, Decision Record 트리거 등 — "기계적으로 신뢰 가능한 신호만 자동화한다")과 어긋난다. "관련성"을 자동 판단하는 건 본질적으로 휴리스틱이고 틀렸을 때 조용히 틀린 채로 넘어간다.

대신:

- `admin-cli search-decisions <keyword>` — `background`/`problem`/`conclusion`/`relatedInfo`에서 키워드로 찾는 단순 텍스트 검색(임베딩/의미 검색 아님).
- 사람이 검색 결과를 보고, 필요하면 그 내용을 `instruct-agent`/`resume-agent`의 프롬프트에 직접 붙여넣어 새 작업에 반영한다.

자동 주입은 이번 범위에서 뺀다. 실제로 Decision Record가 쌓여서 "이런 상황에서 자동으로 보여주면 좋겠다"는 패턴이 실사용으로 확인되면 그때 자동화를 고려한다.

## 4. Code ↔ Decision Record 추적성 (requirements.md §21~22)

### 4.1 제안하는 범위

- `DecisionRecord`에 `relatedFilePaths: string[]` 필드를 추가한다.
- Scribe에게 Decision Context를 넘길 때, 트리거가 된 Question/Answer의 Agent가 최근에 다룬 파일 목록(Event Log의 `TOOL_PRE` 중 `Read`/`Edit`/`Write`의 `tool_input.file_path`)을 함께 준다. Scribe가 그중 관련 있는 것만 골라 `submit_decision_record` 호출 시 `related_file_paths`로 제출한다(Scribe의 판단에 맡기되, 최종 승인은 여전히 Human).
- `admin-cli show-decisions-for-file <path>` — 특정 파일 경로와 관련된 Decision Record를 역으로 찾는다.
- **커밋/git 연동은 범위에서 뺀다.** 파일 경로만으로도 "왜 이렇게 구현돼 있지?"라는 핵심 질문(§22)에 답할 수 있고, git 커밋 해시와 연결하려면 Agent가 실제로 커밋하는 시점을 우리가 관측해야 하는데 지금 Event Log에는 그 신호가 없다. 필요해지면 별도로 다룬다.

## 완료 기준 (Definition of Done)

1. `Decision Intervention`(A안/B안 선택)을 트리거로 Decision Record 초안이 자동 생성된다.
2. `decide-decision <id> reject "사유"` 후 같은 레코드가 갱신된 초안으로 다시 나타난다(새 레코드 아님).
3. `admin-cli search-decisions <keyword>`로 과거 결정을 찾을 수 있다.
4. 새로 생성되는 Decision Record에 관련 파일 경로가 최소 하나 이상 채워진 사례가 실제 세션으로 확인된다.
5. `admin-cli show-decisions-for-file <path>`로 그 Decision Record를 역으로 찾을 수 있다.

## 제외 범위 (이번 Phase 3에서 안 함)

| 항목 | 사유 |
|---|---|
| Decision History 자동 주입 | 관련성 자동 판단은 신뢰도 낮은 휴리스틱 — §3.1 |
| 9단계를 각각 별도 상태로 추적 | 최종 필드로 충분하다고 판단 — §1.2 |
| git 커밋 연동 | 지금 Event Log에 커밋 신호가 없음 — §4.1 |
| Decision Record의 완전한 다회 Discussion 모델링 | 거절+재작성 왕복으로 최소 구현 대체 — §1.2 |
