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
| `run.ts`(실제 프로젝트 경로 연결)의 전체 왕복 미실증 | 설정 파일 검증·경로 해석·`claude` 프로세스 spawn(올바른 절대 경로 인자 포함)까지는 실측 확인됨. "실제 코드 파일을 읽고 그 정보로 답하는지"까지의 전체 왕복은 두 번 시도했으나 둘 다 응답이 2분 넘게 안 와서 확인 못 함. 순수 레이트리밋은 아닌 것으로 보임(같은 세션에서 `claude -p "hi"`는 몇 초 안에 정상 응답했고, `lsof`로 확인한 네트워크 연결도 Anthropic API 서버에 정상적으로 맺혀 있었음) — 도구 호출이 낀 세션에서만 반복적으로 느려지는 원인 불명의 지연. 코드 문제로 볼 근거는 없음(인자·설정 전부 정확) | [architecture.md §14.3](architecture.md#143-실측-검증-부분적) |
| Phase 3(Decision Intervention 트리거/REVISING 재작성/History 검색/파일 추적성)의 실제 `claude -p` 세션 왕복 미실증 | `npx tsc --noEmit` 통과, 스토어 계층(SQL/JSON 인코딩 로직) 자체는 API를 거치지 않는 직접 스모크 테스트로 전부 통과 확인. 하지만 Scribe Agent가 실제로 `submit_decision_record`를 `trigger_decision_intervention_id`/`revising_decision_record_id`와 함께 호출하는 왕복은, 위 `run.ts` 항목과 같은 이유(도구 호출이 낀 세션의 원인 불명 지연)로 아직 실측 못 함 | [phase3-scope.md](phase3-scope.md) |

## 다음 Phase (계획된 확장)

| Phase | 내용 | 근거 |
|---|---|---|
| Phase 3 | 구현 완료([phase3-scope.md](phase3-scope.md) DoD 5개 중 코드·스토어 계층은 전부 구현·검증됨). 실제 `claude -p` 세션 왕복만 위 표에서 미실증으로 남음 | [phase3-scope.md](phase3-scope.md) |
| Phase 4+ | 3개 이상 프로젝트 확장, Linux 지원 검토, 인터페이스 고도화(웹 UI 등 — requirements.md §3 기준으로 그때 판단) | [mvp-scope.md](mvp-scope.md#phase-2-이후와의-관계) |
