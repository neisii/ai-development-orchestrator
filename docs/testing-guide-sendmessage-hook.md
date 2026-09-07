# 테스트 가이드: `PreToolUse` Hook으로 네이티브 `SendMessage` 가로채기

[concept-governance-layer.md §4.1](concept-governance-layer.md#41-1차-실측-2026-09-07-격리된-세션)에서 실측한 "Hook이 네이티브 `SendMessage` 호출을 관찰·차단·장시간 보류할 수 있는가"를 재현하는 절차다. `investigation-mcp-session-delay.md`와 같은 원칙(이 저장소도 실제 프로덕션 프로젝트도 아닌 별도의 임시 디렉터리에서, 실제 `claude -p` 세션 소모를 최소화하며 진행)을 따른다.

## 0. 준비

```bash
mkdir -p /tmp/sendmessage-hook-test/.claude
cd /tmp/sendmessage-hook-test
```

## 1. 차단(deny) 테스트

Hook이 `SendMessage` 호출을 실제로 관찰하고 막을 수 있는지 확인한다.

```bash
cat > .claude/hook-log.sh << 'HOOKEOF'
#!/bin/bash
INPUT=$(cat)
echo "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) HOOK_FIRED: $INPUT" >> /tmp/sendmessage-hook-test/hook.log
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked-by-test-hook"}}
JSON
exit 0
HOOKEOF
chmod +x .claude/hook-log.sh

cat > .claude/settings.json << 'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "SendMessage",
        "hooks": [
          { "type": "command", "command": "/tmp/sendmessage-hook-test/.claude/hook-log.sh" }
        ]
      }
    ]
  }
}
EOF

rm -f hook.log && touch hook.log

timeout 90 claude -p "SendMessage 도구로 이름이 'hook-test-target'인 에이전트에게 '테스트 메시지입니다'라는 내용을 바로 보내봐. 다른 건 하지 말고 이것만 해." \
  --allowedTools "SendMessage" \
  --output-format stream-json --verbose

cat hook.log
```

**기대 결과**: 결과 JSON의 `permission_denials`에 `SendMessage` 항목이 잡히고, `result` 텍스트에 훅에 의해 차단됐다는 설명이 나온다. `hook.log`에 `tool_name":"SendMessage"`와 함께 `to`/`message`/`summary`/`type`/`recipient`/`content`가 포함된 `tool_input` 전체가 찍힌다.

## 2. 장시간 보류(Human 승인 대기 시뮬레이션) 테스트

Hook이 오래 붙잡고 있어도 숨겨진 타임아웃 없이 안전한지 확인한다. `AskUserQuestion`의 60초 AFK 타임아웃([investigation-native-askuserquestion-timeout.md](investigation-native-askuserquestion-timeout.md))을 넘기는 70초로 잡는다.

```bash
cat > .claude/hook-log.sh << 'HOOKEOF'
#!/bin/bash
INPUT=$(cat)
START=$(date -u +%s)
echo "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) HOOK_FIRED, sleeping 70s to simulate Human approval wait" >> /tmp/sendmessage-hook-test/hook.log
sleep 70
END=$(date -u +%s)
echo "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) HOOK_RESUMED after $((END-START))s, allowing" >> /tmp/sendmessage-hook-test/hook.log
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"approved-after-simulated-wait"}}
JSON
exit 0
HOOKEOF
chmod +x .claude/hook-log.sh

rm -f hook.log && touch hook.log

time timeout 100 claude -p "SendMessage 도구로 이름이 'hook-test-target-2'인 에이전트에게 '두번째 테스트'라는 내용을 바로 보내봐. 다른 건 하지 말고 이것만 해." \
  --allowedTools "SendMessage" \
  --output-format stream-json --verbose

cat hook.log
```

**기대 결과**: `hook.log`에 `HOOK_FIRED` 직후 `HOOK_RESUMED after 70s`가 정확히 70초 뒤에 찍힌다. `time` 출력의 `total`도 70초 이상이어야 한다 — Hook 자체가 중간에 강제로 끊기지 않았다는 뜻이다.

**주의(2026-09-07 실측에서 관찰됨)**: `allow`로 통과시켜도 대상 이름(`hook-test-target-2`)이 실제로 존재하지 않으면 `SendMessage` 자체가 "에이전트를 찾을 수 없다"며 실패한다. 이 테스트의 목적은 Hook의 관찰/차단/보류 동작 확인이지 실제 메시지 전달 성공이 아니므로 이 실패는 정상이다.

## 3. 아직 이 가이드로 다루지 않는 것

- 서브에이전트(Task) 경유로 `SendMessage`를 호출했을 때도 같은 Hook이 발동하는지 (우회 가능성) — [concept-governance-layer.md §4.2](concept-governance-layer.md#42-아직-확인되지-않은-것) 참고
- 실제 FE/API 프로덕션 프로젝트의 Agent 로스터·Human 승인 흐름에 이 Hook을 실제로 연결하는 것
