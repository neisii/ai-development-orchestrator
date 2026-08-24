# 백로그

architecture.md/mvp-scope.md 곳곳에 흩어져 있던 미해결 항목을 한 곳에 모은다. 새로 발견되는 미해결 건은 여기 추가한다.

## 지금 처리할 필요 없음 (조건부 트리거)

| 항목 | 조건 | 근거 |
|---|---|---|
| Agent 신원 자가 신고 | Agent가 3개 이상으로 늘거나, 실제(스크래치가 아닌) 코드베이스/외부 콘텐츠를 다루기 시작하는 시점 중 더 이른 쪽 | [architecture.md §12.3](architecture.md#123-알려진-한계-126에서-해결됨), [mvp-scope.md Phase 4+](mvp-scope.md#phase-2-이후와의-관계) |

## 원인 미확정 (재조사 조건부)

| 항목 | 조건 | 근거 |
|---|---|---|
| 테스트 스크립트가 `clearInterval` 이후에도 자연 종료되지 않음 | `ProcessManager`/`Orchestrator` 단독으로는 결백 확인됨(무료 진단). 좀비 프로세스로 남지 않아 급하지 않음. Phase 3 이후 Orchestrator를 실제로 오래 띄워두게 되면(지금은 매번 스크립트를 새로 실행) 미세한 누수가 쌓이는지 재조사 | [architecture.md §13.4](architecture.md#134-알려진-이슈-테스트-스크립트가-자연-종료되지-않음-원인-미확정) |
| `run.ts`(실제 프로젝트 경로 연결)의 전체 왕복 미실증 | 설정 파일 검증·경로 해석·`claude` 프로세스 spawn(올바른 절대 경로 인자 포함)까지는 실측 확인됨. "실제 코드 파일을 읽고 그 정보로 답하는지"까지의 전체 왕복은 그날 세션의 API 응답 지연(레이트리밋으로 추정, 2분 30초 넘게 무응답)으로 끝까지 확인 못 함. 코드 문제로 볼 근거는 없음(인자·설정 전부 정확) | [architecture.md §14.3](architecture.md#143-실측-검증-부분적) |

## 설계 공백 (아직 트리거 조건 없음, Phase 3에서 같이 다룰 후보)

| 항목 | 설명 | 근거 |
|---|---|---|
| Decision Record 거절 시 재작성 경로 없음 | Question/Answer는 거절 사유가 도구 호출 응답으로 되돌아가 Agent가 같은 턴에서 재시도할 수 있는데(data-model.md §3.2/§4.3), Decision Record는 `REJECTED`가 종단 상태([data-model.md §7.3](data-model.md#73-status))라 Scribe가 거절 사유를 돌려받아 다시 쓸 방법이 없다. 사람이 사유를 남겨도 그 사유가 어디로도 안 전달됨 | [data-model.md §7.3](data-model.md#73-status) |

## 다음 Phase (계획된 확장)

| Phase | 내용 | 근거 |
|---|---|---|
| Phase 3 | Decision Context 공식화(requirements.md §18의 9단계 파이프라인), Decision History 재활용, Code ↔ Decision Record 추적성 | [mvp-scope.md](mvp-scope.md#phase-2-이후와의-관계) |
| Phase 4+ | 3개 이상 프로젝트 확장, Linux 지원 검토, 인터페이스 고도화(웹 UI 등 — requirements.md §3 기준으로 그때 판단) | [mvp-scope.md](mvp-scope.md#phase-2-이후와의-관계) |
