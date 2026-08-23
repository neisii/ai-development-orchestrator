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

/** §2.1의 신뢰 가능한 부분만 담는다. activityLabel은 조회 시점에 Event Log에서 계산한다(§2.3). */
export interface AgentRecord {
  id: string;
  projectPath: string;
  sessionId: string | null;
  pid: number | null;
  lifecycleState: AgentLifecycleState;
  updatedAt: string;
}

// docs/requirements.md §12 참고. Direct Instruction은 별도 kind가 아니라 프롬프트가 있는
// RESUME이다 — architecture.md §5: "SIGTERM으로 턴 중단 후 --resume 시 새 지시를 프롬프트로
// 얹어서 전달"이 그대로 PAUSE(필요시) + RESUME(prompt) 조합과 같다.
export type InterventionKind = "PAUSE" | "RESUME" | "STOP";

export interface Intervention {
  id: string;
  agentId: string;
  kind: InterventionKind;
  prompt: string | null;
  requestedBy: string;
  requestedAt: string;
  appliedAt: string | null;
}

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
  /** ask_agent/answer_question 등을 쓰려면 이 Agent가 로드할 MCP 설정 파일 경로. */
  mcpConfigPath?: string;
  /** Event Log를 Hook 수신 서버로 보내려면 이 Agent가 로드할 settings 파일 경로. */
  settingsPath?: string;
}

// docs/data-model.md §3 참고

export type QuestionStatus =
  | "PENDING_HUMAN_REVIEW"
  | "REJECTED"
  | "APPROVED"
  | "DELIVERED"
  | "ANSWERED"
  | "CLOSED";

export interface Question {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  text: string;
  selfJustification: string;
  status: QuestionStatus;
  humanReviewer: string | null;
  reviewReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  deliveredAt: string | null;
}

// docs/data-model.md §4 참고

export const ANSWER_CONTENT_STATUSES = [
  "ANSWERABLE",
  "PARTIALLY_ANSWERABLE",
  "INSUFFICIENT_CONTEXT",
  "OUT_OF_SCOPE",
  "AMBIGUOUS",
  "CONFLICTING_INFORMATION",
  "UNKNOWN",
] as const;

export type AnswerContentStatus = (typeof ANSWER_CONTENT_STATUSES)[number];

export type AnswerReviewStatus = "PENDING_HUMAN_REVIEW" | "APPROVED" | "REJECTED" | "DELIVERED";

export interface Answer {
  id: string;
  questionId: string;
  fromAgentId: string;
  text: string;
  contentStatus: AnswerContentStatus;
  reviewStatus: AnswerReviewStatus;
  humanReviewer: string | null;
  reviewReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  deliveredAt: string | null;
}

// docs/data-model.md §5 참고

export type EventType =
  | "SESSION_START"
  | "SESSION_END"
  | "TOOL_PRE"
  | "TOOL_POST"
  | "QUESTION_CREATED"
  | "QUESTION_REVIEWED"
  | "ANSWER_CREATED"
  | "ANSWER_REVIEWED"
  | "INTERVENTION";

export type EventSource = "hook" | "mcp" | "orchestrator";

export interface EventLogEntry {
  id: string;
  timestamp: string;
  agentId: string;
  sessionId: string | null;
  type: EventType;
  source: EventSource;
  payload: unknown;
  relatedQuestionId: string | null;
  relatedAnswerId: string | null;
}
