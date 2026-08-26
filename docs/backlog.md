# 백로그

architecture.md/mvp-scope.md 곳곳에 흩어져 있던 미해결 항목을 한 곳에 모은다. 새로 발견되는 미해결 건은 여기 추가한다.

## 설계 공백 (원인은 명확, 우선순위 낮음)

| 항목 | 설명 | 근거 |
|---|---|---|
| `submit_decision_record`가 트리거 참조를 검증 안 함 | `trigger_question_id`/`trigger_answer_id`/`trigger_decision_intervention_id`가 실제로 존재하는 거절/개입 건을 가리키는지 확인하는 코드가 없다. Scribe에 대한 Direct Instruction을 막아서(architecture.md §19) 주 공격 경로는 닫혔지만, 정상 dispatch 도중 Scribe가 스스로 잘못된 트리거를 참조할 잔여 위험은 남아있다. Human의 Decision Record 승인 게이트가 실질적 방어선 역할을 하고 있어 급하지 않음 | [architecture.md §19](architecture.md#19-scribe에-대한-human-intervention-제한) |

## 다음 Phase (계획된 확장)

| Phase | 내용 | 근거 |
|---|---|---|
| Phase 3 | 완료. DoD 5개 전부 실제 `claude -p` 세션으로 검증됨(2026-08-25) | [phase3-scope.md](phase3-scope.md) |
| Phase 4+ | 3개 이상 프로젝트 확장, Linux 지원 검토, 인터페이스 고도화(웹 UI 등 — requirements.md §3 기준으로 그때 판단) | [mvp-scope.md](mvp-scope.md#phase-2-이후와의-관계) |
