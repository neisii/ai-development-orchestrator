# 백로그

architecture.md/mvp-scope.md 곳곳에 흩어져 있던 미해결 항목을 한 곳에 모은다. 새로 발견되는 미해결 건은 여기 추가한다.

## 다음 Phase (계획된 확장)

| Phase | 내용 | 근거 |
|---|---|---|
| Phase 3 | 완료. DoD 5개 전부 실제 `claude -p` 세션으로 검증됨(2026-08-25) | [phase3-scope.md](phase3-scope.md) |
| Phase 4 (후보) | 인터페이스 고도화(웹 UI 등). 설계보다 "필요성부터" 판단 필요 — 현재 CLI(`admin-cli`)가 requirements.md §3의 기술 선택 기준(요구사항 충족·성능·리소스 효율 등)을 이미 만족하는지 먼저 확인하고, 실제로 부족한 지점이 발견될 때 범위를 정의한다 | requirements.md §3 |

3개 이상 프로젝트로의 확장은 신규 개발 없이 설정 파일에 Agent를 더 추가하고 돌려보기만 하면 되는 검증 작업이라 별도 Phase로 두지 않는다. **검증 완료(2026-08-26)** — 세 번째 최소 데모 프로젝트(`ai-demo-notes-service`)로 실제 3-Agent 로스터/`ask_agent` 왕복까지 확인함 — [real-project-verification.md 시나리오 9](real-project-verification.md#시나리오-9-3개-이상-프로젝트로의-확장-2026-08-26-추가-검증) 참고.

## 지금 처리할 필요 없음 (조건부 트리거)

| 조건 | 내용 |
|---|---|
| Linux 테스트 환경 확보 시 | Linux 지원 검토(requirements.md §3 "Linux 지원은 향후 고려한다"). 설계 변경 필요성은 낮게 본다 — Node.js 크로스플랫폼 API를 쓰고 있고, 이미 지원 중인 Windows보다 오히려 Linux 쪽이 프로세스 시그널(`SIGTERM` 등) 처리에 더 native하다. 실질적으로는 새 설계보다 검증 작업에 가깝다 |
