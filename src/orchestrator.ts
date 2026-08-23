import { ProcessManager } from "./process-manager.js";
import type { QaStore } from "./qa-store.js";
import type { AgentStore } from "./agent-store.js";

// docs/architecture.md "다음 단계"에서 남긴 통합 작업: 승인된 Question/Answer를 실제로
// 대상 Agent에게 전달(resume)한다.
//
// Agent의 OS 프로세스는 자신이 ask_agent/answer_question을 호출해 보류 중인 동안에도
// 계속 "살아서 블록된" 상태이므로 ProcessManager 입장에서는 RUNNING으로 보인다. 즉
// data-model.md §2.2의 WAITING_APPROVAL/WAITING_AGENT는 지금 구현에서 RUNNING과 구분되지
// 않는다 (같은 근거로 "이 Agent에게 지금 새 프롬프트를 밀어넣어도 되는가"라는 판단에는
// RUNNING 여부만으로 충분하다).
const BUSY_STATES = new Set(["STARTING", "RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "PAUSED"]);

export class Orchestrator {
  private readonly agents = new Map<string, ProcessManager>();

  constructor(
    private readonly store: QaStore,
    private readonly agentStore: AgentStore,
    private readonly pollIntervalMs = 2000
  ) {}

  /** 등록과 동시에, 이후 모든 lifecycle 변화를 agentStore(§2)에 기록하도록 구독한다. */
  registerAgent(pm: ProcessManager): void {
    this.agents.set(pm.id, pm);
    this.persistState(pm);
    pm.on("lifecycle-change", () => this.persistState(pm));
  }

  private persistState(pm: ProcessManager): void {
    const state = pm.getState();
    this.agentStore.upsert({
      id: pm.id,
      projectPath: pm.projectPath,
      sessionId: state.sessionId,
      pid: state.pid,
      lifecycleState: state.lifecycleState,
    });
  }

  getAgent(id: string): ProcessManager | undefined {
    return this.agents.get(id);
  }

  /** 승인됐지만 아직 전달되지 않은 질문/답변을, 대상 Agent가 한가할 때 전달한다. */
  tick(): void {
    this.deliverApprovedQuestions();
    this.deliverApprovedAnswers();
  }

  startPolling(): NodeJS.Timeout {
    return setInterval(() => this.tick(), this.pollIntervalMs);
  }

  private isDeliverable(pm: ProcessManager): boolean {
    const state = pm.getState();
    if (state.sessionId === null) return true; // 아직 한 번도 시작 안 함 -> start()로 전달
    return !BUSY_STATES.has(state.lifecycleState); // 세션은 있지만 지금 바쁘지 않음 -> resume()으로 전달
  }

  private deliverApprovedQuestions(): void {
    for (const q of this.store.listUndeliveredApprovedQuestions()) {
      const target = this.agents.get(q.toAgentId);
      if (!target || !this.isDeliverable(target)) continue;

      const prompt =
        `다른 Agent(${q.fromAgentId})로부터 질문이 도착했습니다.\n` +
        `질문: ${q.text}\n` +
        `(질문자가 밝힌 근거: ${q.selfJustification})\n\n` +
        `이 정보를 바탕으로 판단해서, answer_question 도구로 답변하세요. ` +
        `question_id는 "${q.id}", from_agent_id는 "${q.toAgentId}"로 지정하세요.`;

      if (target.getState().sessionId === null) {
        target.start(prompt);
      } else {
        target.resume(prompt);
      }
      this.store.markQuestionDelivered(q.id);
    }
  }

  private deliverApprovedAnswers(): void {
    for (const a of this.store.listUndeliveredApprovedAnswers()) {
      const question = this.store.getQuestion(a.questionId);
      if (!question) continue;
      const asker = this.agents.get(question.fromAgentId);
      if (!asker || !this.isDeliverable(asker)) continue;

      const prompt =
        `질문(question_id: ${a.questionId})에 대한 답변이 도착했습니다.\n` +
        `답변 상태: ${a.contentStatus}\n` +
        `답변 내용: ${a.text}\n\n` +
        `이 정보를 참고해서 원래 하던 작업을 이어서 진행하세요.`;

      asker.resume(prompt);
      this.store.markAnswerDelivered(a.id);
    }
  }
}
