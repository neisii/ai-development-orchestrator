// docs/data-model.md §2 참고

export type AgentLifecycleState =
  | "STARTING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "WAITING_AGENT"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "STOPPED";

export type AgentActivityLabel = "ANALYZING" | "IMPLEMENTING" | "TESTING" | null;

export interface AgentConfig {
  id: string;
  projectPath: string;
  /**
   * 비워두면 기본 CLAUDE_CONFIG_DIR(보통 ~/.claude)을 그대로 상속한다.
   * 새로 만든 빈 디렉터리를 지정하면 인증 정보가 없어 즉시 실패한다("Not logged in") —
   * 실측 확인됨. 세션/트랜스크립트 격리는 이미 session_id + cwd 조합으로 이루어지므로,
   * 이 값은 정말 별도의 인증·설정 프로필이 필요할 때만 (인증 정보까지 미리 준비된 디렉터리로) 지정한다.
   */
  claudeConfigDir?: string;
  /** headless 모드는 권한 프롬프트를 띄울 수 없으므로, 승인 없이 쓸 도구를 명시해야 한다. */
  allowedTools?: string[];
}
