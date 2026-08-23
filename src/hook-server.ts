import { createServer } from "node:http";
import { openDb } from "./db.js";
import { EventLogStore } from "./event-log.js";
import type { EventType } from "./types.js";

// docs/architecture.md §6 / docs/data-model.md §5 참고.
//
// 각 Agent 프로세스에 심어둔 hook(PreToolUse/PostToolUse/SessionStart/SessionEnd)이
// curl로 이 서버에 POST /events?agentId=<id> 를 호출한다. hook은 이벤트 JSON을 stdin으로
// 받아 그대로 body에 담아 보낸다 (src/agent-settings.ts가 그 curl 커맨드를 생성한다).
//
// hook 호출은 Agent의 도구 실행을 막고(synchronous) 기다리므로, 이 서버는 빠르게
// 응답해야 한다 — DB insert 하나뿐이라 충분히 빠르다.

const HOOK_EVENT_TO_TYPE: Record<string, EventType> = {
  SessionStart: "SESSION_START",
  SessionEnd: "SESSION_END",
  PreToolUse: "TOOL_PRE",
  PostToolUse: "TOOL_POST",
};

export function startHookServer(port: number, dbPath?: string) {
  const db = openDb(dbPath);
  const eventLog = new EventLogStore(db);

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/events")) {
      res.writeHead(404).end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const agentId = url.searchParams.get("agentId");

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!agentId) {
        res.writeHead(400).end();
        return;
      }
      let payload: Record<string, unknown> = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        // hook이 보낸 게 JSON이 아니면 원문 그대로 저장한다.
        payload = { raw: body };
      }

      const hookEventName = typeof payload.hook_event_name === "string" ? payload.hook_event_name : undefined;
      const type: EventType = (hookEventName ? HOOK_EVENT_TO_TYPE[hookEventName] : undefined) ?? "TOOL_PRE";
      const sessionId = typeof payload.session_id === "string" ? payload.session_id : null;

      eventLog.record({ agentId, sessionId, type, source: "hook", payload });

      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });

  server.listen(port, "127.0.0.1");
  return server;
}

// 직접 실행될 때만 서버를 띄운다 (다른 스크립트에서 startHookServer를 재사용할 수도 있게).
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.HOOK_SERVER_PORT ?? 8787);
  startHookServer(port);
  console.log(`Hook 수신 서버: http://127.0.0.1:${port}/events`);
}
