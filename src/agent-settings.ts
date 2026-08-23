import { writeFileSync } from "node:fs";

// docs/architecture.md §6 참고. Claude Code hook 설정 형식은 공식 문서에 버전이 명시돼
// 있지 않아, 로컬 v2.1.238로 직접 실험해서 확인했다(PreToolUse/PostToolUse는
// matcher+hooks 배열, SessionStart/SessionEnd는 matcher 없이도 동작).

function curlCommand(hookServerUrl: string, agentId: string): string {
  const url = `${hookServerUrl}?agentId=${encodeURIComponent(agentId)}`;
  return `curl -s -X POST '${url}' -H 'Content-Type: application/json' -d @- -o /dev/null`;
}

/** Agent별 settings.json을 생성해서, hook 이벤트를 Hook 수신 서버로 전달하게 한다. */
export function writeAgentHookSettings(path: string, agentId: string, hookServerUrl: string): void {
  const cmd = curlCommand(hookServerUrl, agentId);
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd }] }],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd }] }],
      SessionStart: [{ hooks: [{ type: "command", command: cmd }] }],
      SessionEnd: [{ hooks: [{ type: "command", command: cmd }] }],
    },
  };
  writeFileSync(path, JSON.stringify(settings, null, 2));
}
