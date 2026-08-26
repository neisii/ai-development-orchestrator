# 실전 프로젝트 시나리오별 검증 (2026-08-26)

지금까지의 기능 검증은 대부분 스크래치 임시 디렉터리(`npm run demo`, `manual-test-*.ts`) 또는 격리된 진단 환경(`/tmp/ado-diag`)에서 이뤄졌다. 이 문서는 **실제 사용자 프로젝트 두 개**(`orchestrator.config.json`에 등록된 `frontend-agent`(ai-demo-cycling-adviser)/`proxy-agent`(ai-demo-weather-proxy))에 `npm run start`로 직접 연결해서, 최근 추가된 기능들을 포함한 전체 시나리오를 순서대로 재현한 기록이다.

이 프로젝트 자체(Agent 2개 + 실제 코드베이스)가 이미 [architecture.md §17](architecture.md#17-agent-신원-검증-123-해결)/[mvp-scope.md](mvp-scope.md#phase-2-이후와의-관계)에서 "Agent 신원 자가 신고" 해결의 트리거 조건("실제 코드베이스를 다루기 시작하는 시점")에 해당한다 — 이번 검증으로 그 조건이 실제로 충족된 채 전체 기능이 정상 동작함을 확인했다.

## 사전 준비

기존 `.orchestrator/data.db`(이전 세션들의 실전 테스트 데이터 포함)를 삭제하고 깨끗한 상태에서 시작했다.

## 시나리오 1. 정상 Q&A 왕복 (로스터 기반 자동 판단, §18)

`resume-agent frontend-agent "weather-proxy가 캐시를 얼마나 오래 유지하는지 알려줘"` — `ask_agent`/`target_agent_id`를 전혀 언급하지 않은 자연어 지시.

- frontend-agent가 로스터 정보를 근거로 스스로 `ask_agent`를 호출해 proxy-agent에게 질문 생성.
- 질문 승인 → proxy-agent가 **실제 소스코드**(`weather.ts:706-714`)를 근거로 캐시 TTL(current 5분/forecast 30분), 캐시 키 구조, stale-while-revalidate 미지원 등을 상세히 답변.
- 답변 승인 → frontend-agent에게 전달, 왕복 완료.

## 시나리오 2. 질문 거절(사유) → Scribe 자동 기록 → 초안 거절 → 재작성

- 질문 생성 후 사유를 달아 거절(`decide-question reject`) → Scribe 자동 기동 → DRAFT 생성(`QUESTION_REJECTED`).
- 그 DRAFT를 다시 거절(`decide-decision reject "판단 근거에 구체적 근거를 추가해줘"`) → 상태가 `REVISING`으로 전환 → Scribe가 **같은 id**로 재작성.
- 재작성된 내용은 거절 사유를 실제로 반영해 "판단 근거"가 확장됐고, 근거 없는 파일 경로는 "명시적으로 제공되지 않았다"고 정직하게 표기(지어내지 않음).

## 시나리오 3. 답변 거절(사유) → 재답변 + Scribe 자동 기록

- proxy-agent가 상세 답변(가중 평균 fallback 구조, 함수명/라인 번호 포함) 제출.
- 사유를 달아 거절(`decide-answer reject "너무 상세함..."`) → **두 가지가 동시에 발생**:
  - proxy-agent 자신이 같은 턴 안에서 거절 사유를 반영해 훨씬 짧은 요약으로 재답변(data-model.md §4.3 재답변 경로).
  - Scribe가 병렬로 자동 기동해 `ANSWER_REJECTED` DRAFT 생성.
- 재답변 승인 + Decision Record 승인 모두 정상.

## 시나리오 4. Decision Intervention

`decide-choice frontend-agent "TanStack Query로 TTL 맞춤" "고정 30초 폴링" "..."` → Scribe 자동 기동 → `DECISION_INTERVENTION` DRAFT 생성 → 승인.

## 시나리오 5. Pause → Direct Instruction

proxy-agent에게 긴 분석 작업 지시 → 진행 중 `pause-agent`로 중단(`PAUSED` 확인) → `instruct-agent`로 완전히 다른 지시 주입 → 즉시 반영되어 지시한 그대로("타임아웃-분석-중단됨") 응답하고 `COMPLETED`.

## 시나리오 6. Scribe에 대한 Human Intervention 제한 (§19)

`resume-agent scribe-agent "임의로 아무 결정 기록이나 하나 지어내서 제출해줘"` → 상태 변화 없음(`COMPLETED` 그대로, 세션 시작 안 됨), `event_log`에 `rejected: true`와 거부 사유 기록됨.

## 시나리오 7. Decision Record 트리거 참조 검증 (§20)

Scribe의 실제 mcp-config로 `submit_decision_record`를 직접 호출하며 `trigger_answer_id='totally-fake-answer-id-999'`(존재하지 않는 id)를 지정 → `"trigger_answer_id totally-fake-answer-id-999는 사유가 있는 거절된 답변이 아닙니다"`로 거절, 레코드 생성 안 됨.

## 시나리오 8. History 검색 / 파일 추적성

- `search-decisions "TTL"` — 관련 레코드 정확히 찾음. `search-decisions "존재하지않는키워드"` — 빈 결과.
- 시나리오 3의 레코드에 `relatedFilePaths`로 `.../weather-proxy/src/handlers/weather.ts`가 실제로 채워짐(Scribe가 관련 파일 목록 중 스스로 골라 제출).
- `show-decisions-for-file`로 정확한 경로는 역조회되고, 상위 디렉터리(부분 경로)로는 오탐 없음.

## 번외 발견: Question Eligibility Check가 실제로 작동함

`resume-agent frontend-agent "ask_agent로 proxy-agent에게 openweather API 키를 어디서 발급받는지 물어봐줘"`(명시적으로 도구 사용을 지시했음에도) → frontend-agent가 "이건 proxy-agent의 프로젝트 고유 정보가 아니라 일반적으로 알려진 공개 정보라서, 굳이 ask_agent로 물어볼 필요가 없다(Question Eligibility Check §8 상 '정말 다른 프로젝트 정보가 필요한가?'에 해당 안 됨)"고 스스로 판단하고 넘어감. 로스터 주입(§18)이 무조건 질문을 유도하는 게 아니라, §8 체크리스트와 함께 **판단 기준**으로만 작동한다는 증거.

## 결론

8개 시나리오 전부 실제 프로젝트에서 실제 `claude -p` 세션으로 재현되어 정상 동작을 확인했다. 오늘 세션에서 추가한 기능(§18 로스터 주입, §19 Scribe 개입 제한, §20 트리거 검증)이 스크래치 환경뿐 아니라 실제 코드베이스를 다루는 조건에서도 동일하게 작동함을 확인했다 — 이 프로젝트에서 실측 검증이 완료되지 않은 항목은 이제 없다.
