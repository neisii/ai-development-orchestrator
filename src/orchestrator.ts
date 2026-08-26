import { ProcessManager } from "./process-manager.js";
import type { QaStore } from "./qa-store.js";
import type { AgentStore } from "./agent-store.js";
import type { EventLogStore } from "./event-log.js";
import type { InterventionStore } from "./intervention-store.js";
import type { DecisionRecordStore } from "./decision-record-store.js";
import type { DecisionInterventionStore } from "./decision-intervention-store.js";
import type { Answer, DecisionInterventionRequest, DecisionRecord, Question } from "./types.js";

// docs/architecture.md "다음 단계"에서 남긴 통합 작업: 승인된 Question/Answer를 실제로
// 대상 Agent에게 전달(resume)한다.
//
// Agent의 OS 프로세스는 자신이 ask_agent/answer_question을 호출해 보류 중인 동안에도
// 계속 "살아서 블록된" 상태이므로 ProcessManager 입장에서는 RUNNING으로 보인다. 즉
// data-model.md §2.2의 WAITING_APPROVAL/WAITING_AGENT는 지금 구현에서 RUNNING과 구분되지
// 않는다 (같은 근거로 "이 Agent에게 지금 새 프롬프트를 밀어넣어도 되는가"라는 판단에는
// RUNNING 여부만으로 충분하다).
//
// Q&A 자동 전달용 BUSY_STATES에는 PAUSED도 포함한다 — 사람이 일부러 멈춰둔 Agent를
// 자동 전달로 방해하지 않기 위해서다. 반면 개입 RESUME(§12)은 정확히 PAUSED 상태를
// "이제 재개해도 되는 상태"로 다뤄야 하므로 별도로 PROCESS_ACTIVE_STATES를 둔다.
const BUSY_STATES = new Set(["STARTING", "RUNNING", "WAITING_APPROVAL", "WAITING_AGENT", "PAUSED"]);
const PROCESS_ACTIVE_STATES = new Set(["STARTING", "RUNNING", "WAITING_APPROVAL", "WAITING_AGENT"]);

export class Orchestrator {
  private readonly agents = new Map<string, ProcessManager>();
  private scribe: ProcessManager | undefined;

  constructor(
    private readonly store: QaStore,
    private readonly agentStore: AgentStore,
    private readonly eventLog: EventLogStore,
    private readonly interventionStore: InterventionStore,
    private readonly decisionRecords: DecisionRecordStore,
    private readonly decisionInterventions: DecisionInterventionStore,
    private readonly pollIntervalMs = 2000
  ) {}

  /** 등록과 동시에, 이후 모든 lifecycle 변화를 agentStore(§2)에 기록하도록 구독한다. */
  registerAgent(pm: ProcessManager): void {
    this.agents.set(pm.id, pm);
    this.persistState(pm);
    pm.on("lifecycle-change", () => this.persistState(pm));
    pm.on("assistant-message", (text) => this.recordAssistantMessage(pm, text));
  }

  /** data-model.md §7: Scribe는 Project Agent 목록(agents)과 분리해서, Q&A 전달 대상으로 잡히지 않게 한다. */
  registerScribe(pm: ProcessManager): void {
    this.scribe = pm;
    this.persistState(pm);
    pm.on("lifecycle-change", () => this.persistState(pm));
    pm.on("assistant-message", (text) => this.recordAssistantMessage(pm, text));
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

  /** data-model.md §5.3: 도구 호출 없는 일반 텍스트 응답도 Event Log에 남긴다. */
  private recordAssistantMessage(pm: ProcessManager, text: string): void {
    this.eventLog.record({
      agentId: pm.id,
      sessionId: pm.getState().sessionId,
      type: "ASSISTANT_MESSAGE",
      source: "orchestrator",
      payload: { text },
    });
  }

  getAgent(id: string): ProcessManager | undefined {
    return this.agents.get(id);
  }

  /** 승인됐지만 아직 전달되지 않은 질문/답변을, 대상 Agent가 한가할 때 전달한다. */
  tick(): void {
    this.deliverApprovedQuestions();
    this.deliverApprovedAnswers();
    this.processInterventions();
    this.triggerDecisionRecords();
  }

  startPolling(): NodeJS.Timeout {
    return setInterval(() => this.tick(), this.pollIntervalMs);
  }

  private isDeliverable(pm: ProcessManager): boolean {
    // ProcessManager의 초기값이 이미 "STOPPED"(BUSY_STATES에 없음)이라, 한 번도 시작 안 한
    // Agent도 lifecycleState만으로 정확히 판별된다. 예전에는 `sessionId === null`이면 무조건
    // deliverable로 보는 지름길이 있었는데, start() 직후 STARTING 상태에서 session_id가 아직
    // 안 왔을 때도 이 지름길이 true를 반환해버려서 "이미 실행 중인데 또 start()를 호출"하는
    // 버그가 났다(§7.2 Scribe 트리거로 실행해서 실제로 재현/발견됨). lifecycleState 하나만 본다.
    return !BUSY_STATES.has(pm.getState().lifecycleState);
  }

  /** RESUME 개입 전용: PAUSED는 "재개해야 할 상태"이지 "바쁜 상태"가 아니다. */
  private canApplyResume(pm: ProcessManager): boolean {
    return !PROCESS_ACTIVE_STATES.has(pm.getState().lifecycleState);
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

  /**
   * §12: Pause/Resume/Stop과, 프롬프트가 있는 RESUME으로 표현되는 Direct Instruction을 처리한다.
   * RESUME은 대상 Agent가 아직 바쁘면(예: 방금 보낸 PAUSE가 아직 반영되기 전) 이번 tick에서는
   * 넘기고 다음 tick에 재시도한다 — Question/Answer 전달과 같은 재시도 방식.
   *
   * Scribe는 PAUSE/STOP/프롬프트 없는 RESUME까지는 그대로 적용하지만, 프롬프트가 있는
   * RESUME(Direct Instruction)만은 거부한다 — Scribe의 유일한 도구(`submit_decision_record`)는
   * 트리거 참조가 실제인지 검증하지 않으므로, 임의 프롬프트를 허용하면 근거 없는 Decision
   * Record를 지어내 제출할 길이 열린다(§18 자가신고 문제와 같은 종류). PAUSE/STOP과
   * 프롬프트 없는 RESUME은 새 작업을 주입하지 않아 이 위험이 없고, 오히려 프롬프트 없는
   * RESUME까지 막으면 한 번 PAUSED된 Scribe가 영원히 못 깨어난다(PAUSED가 BUSY_STATES에
   * 있어 `triggerDecisionRecords()`가 계속 스스로를 건너뜀) — 그래서 반드시 남겨둬야 한다.
   */
  private processInterventions(): void {
    for (const iv of this.interventionStore.listPending()) {
      const isScribe = this.scribe?.id === iv.agentId;
      const pm = this.agents.get(iv.agentId) ?? (isScribe ? this.scribe : undefined);
      if (!pm) {
        this.interventionStore.markApplied(iv.id); // 모르는 Agent면 버린다
        continue;
      }

      if (isScribe && iv.kind === "RESUME" && iv.prompt) {
        this.eventLog.record({
          agentId: iv.agentId,
          sessionId: pm.getState().sessionId,
          type: "INTERVENTION",
          source: "orchestrator",
          payload: {
            kind: iv.kind,
            prompt: iv.prompt,
            requestedBy: iv.requestedBy,
            rejected: true,
            reason:
              "scribe-agent는 정해진 트리거(Question/Answer 거절 사유, Decision Intervention, 초안 재작성)로만 " +
              "자동 실행됩니다. 임의 프롬프트로 개입할 수 없습니다 — 진행 중이던 턴을 재개하려면 프롬프트 없이 " +
              "resume-agent scribe-agent를 실행하세요.",
          },
        });
        this.interventionStore.markApplied(iv.id);
        continue;
      }

      if (iv.kind === "PAUSE") {
        pm.pause();
      } else if (iv.kind === "STOP") {
        pm.stop();
      } else {
        // RESUME
        if (!this.canApplyResume(pm)) continue; // 아직 살아있는 프로세스가 있음 -> 다음 tick에 재시도
        if (pm.getState().sessionId === null) {
          pm.start(iv.prompt ?? "작업을 시작하세요.");
        } else if (iv.prompt) {
          pm.resume(iv.prompt);
        } else {
          pm.resume();
        }
      }

      this.eventLog.record({
        agentId: iv.agentId,
        sessionId: pm.getState().sessionId,
        type: "INTERVENTION",
        source: "orchestrator",
        payload: { kind: iv.kind, prompt: iv.prompt, requestedBy: iv.requestedBy },
      });
      this.interventionStore.markApplied(iv.id);
    }
  }

  /**
   * data-model.md §7.2 / phase3-scope.md §1~2: 다음 우선순위로 Scribe에게 Decision Context를
   * 프롬프트로 넘겨 초안 작성(또는 재작성)을 시킨다. Scribe는 한 번에 하나만 처리할 수 있으므로,
   * deliverable할 때 딱 하나만 보내고 나머지는 다음 tick으로 미룬다.
   *   1. REVISING 상태 레코드(거절 후 재작성 대기) — 가장 먼저 처리해서 Human이 준 사유가
   *      최신 상태로 반영되게 한다.
   *   2. Decision Intervention(§1.2, requirements.md §12.4)
   *   3. 사유가 있는 질문 거절
   *   4. 사유가 있는 답변 거절
   */
  private triggerDecisionRecords(): void {
    if (!this.scribe || !this.isDeliverable(this.scribe)) return;

    const revising = this.decisionRecords.listPendingRevisions()[0];
    if (revising) {
      this.dispatchScribe(this.buildDecisionRevisionPrompt(revising));
      return;
    }

    const intervention = this.decisionInterventions
      .list()
      .find((iv) => !this.decisionRecords.hasRecordForDecisionIntervention(iv.id));
    if (intervention) {
      this.dispatchScribe(this.buildDecisionInterventionPrompt(intervention));
      this.decisionInterventions.markDispatched(intervention.id);
      return;
    }

    const question = this.store
      .listRejectedQuestionsWithReason()
      .find((q) => !this.decisionRecords.hasRecordForQuestion(q.id));
    if (question) {
      this.dispatchScribe(this.buildQuestionDecisionPrompt(question));
      return;
    }

    const answer = this.store
      .listRejectedAnswersWithReason()
      .find((a) => !this.decisionRecords.hasRecordForAnswer(a.id));
    if (answer) {
      const relatedQuestion = this.store.getQuestion(answer.questionId);
      this.dispatchScribe(this.buildAnswerDecisionPrompt(answer, relatedQuestion));
    }
  }

  private dispatchScribe(prompt: string): void {
    if (this.scribe!.getState().sessionId === null) {
      this.scribe!.start(prompt);
    } else {
      this.scribe!.resume(prompt);
    }
  }

  /**
   * phase3-scope.md §4.1: 트리거가 된 Agent가 최근에 다룬 Read/Edit/Write 파일 목록을 뽑아서
   * Scribe에게 참고용으로 넘긴다. "관련 있어 보이는" 판단은 자동화하지 않는다 — Scribe가
   * 이 목록 중 실제로 관련 있는 것만 골라 related_file_paths로 제출한다.
   */
  private recentFilePaths(agentId: string, limit = 20): string[] {
    const paths = new Set<string>();
    for (const e of this.eventLog.list({ agentId, limit })) {
      if (e.type !== "TOOL_PRE") continue;
      const payload = e.payload as { tool_name?: string; tool_input?: { file_path?: string } };
      if (!payload.tool_name || !["Read", "Edit", "Write"].includes(payload.tool_name)) continue;
      const filePath = payload.tool_input?.file_path;
      if (filePath) paths.add(filePath);
    }
    return [...paths];
  }

  private filePathsInstruction(filePaths: string[]): string {
    if (filePaths.length === 0) {
      return `참고할 최근 파일 목록이 없습니다. related_file_paths는 빈 배열로 지정하세요.\n`;
    }
    return (
      `해당 Agent가 최근 다룬 파일 목록: ${filePaths.join(", ")}\n` +
      `이 중 이 결정과 실제로 관련 있는 파일만 골라 related_file_paths로 제출하세요(관련 없으면 빈 배열).\n`
    );
  }

  private buildQuestionDecisionPrompt(q: Question): string {
    return (
      `당신은 Scribe Agent입니다(requirements.md §15~19). 아래는 Human이 거절한 질문의 Decision Context입니다.\n\n` +
      `[질문 거절 기록]\n` +
      `질문자: ${q.fromAgentId} -> 질문 대상: ${q.toAgentId}\n` +
      `질문 내용: ${q.text}\n` +
      `질문자가 밝힌 근거: ${q.selfJustification}\n` +
      `Human 거절 사유: ${q.reviewReason}\n` +
      `거절한 Human: ${q.humanReviewer}\n\n` +
      `이 내용을 바탕으로 submit_decision_record 도구를 정확히 한 번 호출해서 Decision Record를 작성하세요.\n` +
      `trigger_type은 "QUESTION_REJECTED", trigger_question_id는 "${q.id}", trigger_answer_id와 ` +
      `trigger_decision_intervention_id는 null, revising_decision_record_id는 null로 지정하세요.\n` +
      this.filePathsInstruction(this.recentFilePaths(q.fromAgentId)) +
      `당신의 역할은 기록자입니다 — 새로운 기술적·설계적 판단을 내리지 말고, 위에 주어진 사실만으로 ` +
      `배경/문제/제약사항/선택지/선택지 비교/판단 근거/결론/결정 주체를 사람이 이해하기 쉬운 글로 정리하세요.`
    );
  }

  private buildAnswerDecisionPrompt(a: Answer, relatedQuestion: Question | undefined): string {
    return (
      `당신은 Scribe Agent입니다(requirements.md §15~19). 아래는 Human이 거절한 답변의 Decision Context입니다.\n\n` +
      `[답변 거절 기록]\n` +
      `원래 질문: ${relatedQuestion?.text ?? "(질문 정보 없음)"}\n` +
      `답변자: ${a.fromAgentId}\n` +
      `답변 내용: ${a.text}\n` +
      `답변자가 표시한 확신 수준: ${a.contentStatus}\n` +
      `Human 거절 사유: ${a.reviewReason}\n` +
      `거절한 Human: ${a.humanReviewer}\n\n` +
      `이 내용을 바탕으로 submit_decision_record 도구를 정확히 한 번 호출해서 Decision Record를 작성하세요.\n` +
      `trigger_type은 "ANSWER_REJECTED", trigger_question_id는 ${relatedQuestion ? `"${relatedQuestion.id}"` : "null"}, ` +
      `trigger_answer_id는 "${a.id}", trigger_decision_intervention_id는 null, revising_decision_record_id는 null로 지정하세요.\n` +
      this.filePathsInstruction(this.recentFilePaths(a.fromAgentId)) +
      `당신의 역할은 기록자입니다 — 새로운 기술적·설계적 판단을 내리지 말고, 위에 주어진 사실만으로 ` +
      `배경/문제/제약사항/선택지/선택지 비교/판단 근거/결론/결정 주체를 사람이 이해하기 쉬운 글로 정리하세요.`
    );
  }

  /** phase3-scope.md §1.2: Decision Intervention(A안/B안 선택)을 새 트리거로 다룬다. */
  private buildDecisionInterventionPrompt(iv: DecisionInterventionRequest): string {
    return (
      `당신은 Scribe Agent입니다(requirements.md §15~19, §12.4). 아래는 Human이 직접 개입해 ` +
      `선택지를 결정한 Decision Context입니다.\n\n` +
      `[Decision Intervention 기록]\n` +
      `대상 Agent: ${iv.agentId}\n` +
      `Human이 선택한 안: ${iv.chosenOption}\n` +
      `기각된 안: ${iv.rejectedOptions}\n` +
      `Human이 밝힌 근거: ${iv.reasoning}\n` +
      `개입한 Human: ${iv.requestedBy}\n\n` +
      `이 내용을 바탕으로 submit_decision_record 도구를 정확히 한 번 호출해서 Decision Record를 작성하세요.\n` +
      `trigger_type은 "DECISION_INTERVENTION", trigger_decision_intervention_id는 "${iv.id}", ` +
      `trigger_question_id와 trigger_answer_id는 null, revising_decision_record_id는 null로 지정하세요.\n` +
      this.filePathsInstruction(this.recentFilePaths(iv.agentId)) +
      `당신의 역할은 기록자입니다 — 새로운 기술적·설계적 판단을 내리지 말고, 위에 주어진 사실만으로 ` +
      `배경/문제/제약사항/선택지/선택지 비교/판단 근거/결론/결정 주체를 사람이 이해하기 쉬운 글로 정리하세요.`
    );
  }

  /** phase3-scope.md §2: Human이 거절한 초안을 사유와 함께 돌려주고, 같은 레코드로 재제출하게 한다. */
  private buildDecisionRevisionPrompt(record: DecisionRecord): string {
    return (
      `당신은 Scribe Agent입니다(requirements.md §15~19). Human이 아래 Decision Record 초안을 거절했습니다. ` +
      `사유를 반영해서 고친 뒤 같은 기록으로 다시 제출하세요.\n\n` +
      `[기존 초안]\n` +
      `배경: ${record.background}\n` +
      `문제: ${record.problem}\n` +
      `제약사항: ${record.constraints}\n` +
      `선택지: ${record.options}\n` +
      `선택지 비교: ${record.optionsComparison}\n` +
      `판단 근거: ${record.rationale}\n` +
      `결론: ${record.conclusion}\n` +
      `결정 주체: ${record.decisionMaker}\n` +
      `관련 파일: ${record.relatedFilePaths.join(", ") || "(없음)"}\n\n` +
      `Human 거절 사유: ${record.reviewReason}\n` +
      `거절한 Human: ${record.humanReviewer}\n\n` +
      `이 사유를 반영해서 위 초안을 고친 다음, submit_decision_record 도구를 정확히 한 번 호출해서 다시 제출하세요.\n` +
      `revising_decision_record_id는 "${record.id}"로 지정하세요. trigger_type/trigger_question_id/trigger_answer_id/` +
      `trigger_decision_intervention_id는 값을 넣긴 해야 하지만 재작성 시에는 사용되지 않으니 기존 값을 그대로 쓰면 됩니다 ` +
      `(trigger_type: "${record.triggerType}", trigger_question_id: ${record.triggerQuestionId ? `"${record.triggerQuestionId}"` : "null"}, ` +
      `trigger_answer_id: ${record.triggerAnswerId ? `"${record.triggerAnswerId}"` : "null"}, ` +
      `trigger_decision_intervention_id: ${record.triggerDecisionInterventionId ? `"${record.triggerDecisionInterventionId}"` : "null"}).\n` +
      `당신의 역할은 기록자입니다 — 새로운 기술적·설계적 판단을 내리지 말고, 거절 사유를 반영해 사실 정리만 고치세요.`
    );
  }
}
