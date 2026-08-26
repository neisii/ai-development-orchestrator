import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type { AgentConfig, AgentLifecycleState } from "./types.js";

// docs/architecture.md §5, §5.1 참고: pause/resume/stop은 전부 SIGTERM + (필요시) --resume 프롬프트로 구현한다.
// 프롬프트 없는 --resume은 지원되지 않는다는 게 실측으로 확인되어 있다.
const DEFAULT_RESUME_PROMPT = "계속 진행해줘.";

export interface StreamEvent {
  raw: unknown;
}

export declare interface ProcessManager {
  on(event: "event", listener: (e: StreamEvent) => void): this;
  on(event: "lifecycle-change", listener: (state: AgentLifecycleState) => void): this;
  /**
   * docs/data-model.md §5.3(예전 "다루지 않는 것"): 도구 호출 없는 일반 텍스트 응답은
   * hook도 안 걸리고 여기서도 무시됐었다. stream-json의 assistant 메시지에서 text
   * 콘텐츠 블록만 뽑아 알려준다 — Event Log 기록은 Orchestrator가 구독해서 한다.
   */
  on(event: "assistant-message", listener: (text: string) => void): this;
}

export class ProcessManager extends EventEmitter {
  readonly id: string;
  readonly projectPath: string;
  private readonly claudeConfigDir: string | undefined;
  private readonly allowedTools: string[];
  private readonly mcpConfigPath: string | undefined;
  private readonly settingsPath: string | undefined;
  private readonly systemPromptAppend: string | undefined;

  private child: ChildProcessWithoutNullStreams | null = null;
  private sessionId: string | null = null;
  private lifecycleState: AgentLifecycleState = "STOPPED";
  private stopRequested = false;

  constructor(config: AgentConfig) {
    super();
    this.id = config.id;
    this.projectPath = config.projectPath;
    this.claudeConfigDir = config.claudeConfigDir;
    this.allowedTools = config.allowedTools ?? [];
    this.mcpConfigPath = config.mcpConfigPath;
    this.settingsPath = config.settingsPath;
    this.systemPromptAppend = config.systemPromptAppend;
  }

  private baseArgs(): string[] {
    const args: string[] = [];
    if (this.allowedTools.length > 0) {
      args.push("--allowedTools", this.allowedTools.join(","));
    }
    if (this.mcpConfigPath) {
      args.push("--mcp-config", this.mcpConfigPath, "--strict-mcp-config");
    }
    if (this.settingsPath) {
      args.push("--settings", this.settingsPath);
    }
    if (this.systemPromptAppend) {
      args.push("--append-system-prompt", this.systemPromptAppend);
    }
    return args;
  }

  getState(): { lifecycleState: AgentLifecycleState; sessionId: string | null; pid: number | null } {
    return {
      lifecycleState: this.lifecycleState,
      sessionId: this.sessionId,
      pid: this.child?.pid ?? null,
    };
  }

  /** 새 세션을 시작한다. 이미 세션이 있다면 resume()을 사용해야 한다. */
  start(prompt: string): void {
    if (this.child) {
      throw new Error(`Agent ${this.id} already has a running process`);
    }
    this.sessionId = null;
    this.spawnProcess([
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      ...this.baseArgs(),
    ]);
  }

  /** PAUSED 상태에서 재개한다. 프롬프트는 필수(§5.1 실측 검증). */
  resume(prompt: string = DEFAULT_RESUME_PROMPT): void {
    if (this.child) {
      throw new Error(`Agent ${this.id} already has a running process`);
    }
    if (!this.sessionId) {
      throw new Error(`Agent ${this.id} has no session to resume`);
    }
    this.spawnProcess([
      "-p",
      prompt,
      "--resume",
      this.sessionId,
      "--output-format",
      "stream-json",
      "--verbose",
      ...this.baseArgs(),
    ]);
  }

  /** 도구 실행 도중이라도 즉시 중단시킨다. 이후 자동으로 재개하지 않는다(resume()으로 직접 재개해야 함). */
  pause(): void {
    this.stopRequested = false;
    this.child?.kill("SIGTERM");
  }

  /** pause()와 동일한 신호를 보내되, 이후 재개를 허용하지 않는 상태로 표시한다. */
  stop(): void {
    this.stopRequested = true;
    if (this.child) {
      this.child.kill("SIGTERM");
    } else {
      this.setLifecycleState("STOPPED");
    }
  }

  private spawnProcess(args: string[]): void {
    this.setLifecycleState("STARTING");

    const env = { ...process.env };
    if (this.claudeConfigDir) {
      // 실측 확인: 인증 정보가 없는 새 디렉터리를 지정하면 "Not logged in"으로 즉시 실패한다.
      // 호출자가 이미 인증된 디렉터리를 준비했다고 가정한다.
      env.CLAUDE_CONFIG_DIR = this.claudeConfigDir;
    }

    const child = spawn("claude", args, {
      cwd: this.projectPath,
      env,
    });
    this.child = child;
    // `-p` 모드는 stdin으로 파이프 입력이 오는지 최대 3초 기다렸다가 없으면 진행한다
    // (stderr에 "no stdin data received in 3s..." 경고로 확인됨). 우리는 프롬프트를 인자로
    // 이미 넘기고 있어서 stdin으로 줄 게 없으므로, 곧바로 닫아서 이 대기를 없앤다 —
    // 매 턴마다 쌓이는 3초 지연이라 실사용에 누적 영향이 크다(investigation-clearinterval-hang.md).
    child.stdin.end();

    // 지금까지는 stderr를 아무도 안 읽어서, claude CLI 자체가 실패해도(잘못된 인자, 인증 문제 등)
    // 원인이 전혀 안 보이고 FAILED만 찍혔다. Agent id를 붙여서 그대로 흘려보낸다.
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[${this.id}] ${chunk}`);
    });

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // stream-json이 아닌 잡음 라인은 무시
      }
      this.handleStreamEvent(parsed);
      this.emit("event", { raw: parsed } satisfies StreamEvent);
    });

    child.on("close", (code, signal) => {
      this.child = null;
      this.handleExit(code, signal);
    });
  }

  private handleStreamEvent(parsed: unknown): void {
    if (typeof parsed !== "object" || parsed === null) return;
    const obj = parsed as Record<string, unknown>;

    if (!this.sessionId && typeof obj.session_id === "string") {
      this.sessionId = obj.session_id;
    }

    if (obj.type === "system" && obj.subtype === "init") {
      this.setLifecycleState("RUNNING");
    }

    if (obj.type === "assistant") {
      const message = obj.message as { content?: unknown[] } | undefined;
      for (const block of message?.content ?? []) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
          this.emit("assistant-message", b.text);
        }
      }
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (signal === "SIGTERM" || code === 143) {
      this.setLifecycleState(this.stopRequested ? "STOPPED" : "PAUSED");
      return;
    }
    if (code === 0) {
      this.setLifecycleState("COMPLETED");
      return;
    }
    this.setLifecycleState("FAILED");
  }

  private setLifecycleState(state: AgentLifecycleState): void {
    this.lifecycleState = state;
    this.emit("lifecycle-change", state);
  }
}
