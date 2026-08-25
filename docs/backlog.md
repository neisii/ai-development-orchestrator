# 백로그

architecture.md/mvp-scope.md 곳곳에 흩어져 있던 미해결 항목을 한 곳에 모은다. 새로 발견되는 미해결 건은 여기 추가한다.

## 지금 처리할 필요 없음 (조건부 트리거)

| 항목 | 조건 | 근거 |
|---|---|---|
| Agent 신원 자가 신고 | Agent가 3개 이상으로 늘거나, 실제(스크래치가 아닌) 코드베이스/외부 콘텐츠를 다루기 시작하는 시점 중 더 이른 쪽 | [architecture.md §12.3](architecture.md#123-알려진-한계-126에서-해결됨), [mvp-scope.md Phase 4+](mvp-scope.md#phase-2-이후와의-관계) |

## 설계 공백 (원인은 명확, 아직 안 고침)

| 항목 | 설명 | 근거 |
|---|---|---|
| 도구 호출 없는 일반 텍스트 응답이 어디에도 안 남음 | Agent가 도구를 안 쓰고 그냥 말로만 답하면(예: `resume-agent buyer-bff "안녕"`에 "안녕하세요!"로 응답) 그 내용이 콘솔에도, Event Log에도 전혀 기록되지 않고 사라진다. 설계 누락이 아니라 애초에 다룬 적이 없던 범위 — 원인·근거는 [data-model.md §5.3](data-model.md#53-다루지-않는-것-도구-호출-없는-일반-텍스트-응답) 참고 | 2026-08-24 `resume-agent buyer-bff "안녕"` 실사용 중 발견. [data-model.md §5.3](data-model.md#53-다루지-않는-것-도구-호출-없는-일반-텍스트-응답), [architecture.md §11](architecture.md#11-미해결-사항) |

## 원인 미확정 (재조사 조건부)

| 항목 | 조건 | 근거 |
|---|---|---|
| 테스트 스크립트가 `clearInterval` 이후에도 자연 종료되지 않음 | `ProcessManager`/`Orchestrator` 단독으로는 결백 확인됨(무료 진단). 좀비 프로세스로 남지 않아 급하지 않음. Phase 3 이후 Orchestrator를 실제로 오래 띄워두게 되면(지금은 매번 스크립트를 새로 실행) 미세한 누수가 쌓이는지 재조사 — 2026-08-25에 `run.ts`를 10분 넘게 띄워둔 세션이 있었지만 이 현상 자체를 목적으로 관찰하진 않아서 조건 충족 안 함 | [architecture.md §13.4](architecture.md#134-알려진-이슈-테스트-스크립트가-자연-종료되지-않음-원인-미확정) |

## 다음 Phase (계획된 확장)

| Phase | 내용 | 근거 |
|---|---|---|
| Phase 3 | 완료. DoD 5개 전부 실제 `claude -p` 세션으로 검증됨(2026-08-25) | [phase3-scope.md](phase3-scope.md) |
| Phase 4+ | 3개 이상 프로젝트 확장, Linux 지원 검토, 인터페이스 고도화(웹 UI 등 — requirements.md §3 기준으로 그때 판단) | [mvp-scope.md](mvp-scope.md#phase-2-이후와의-관계) |
