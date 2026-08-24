import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
import { DecisionRecordStore } from "./decision-record-store.js";
import { ANSWER_CONTENT_STATUSES } from "./types.js";

// docs/architecture.md §3, §7, §12.4 / docs/data-model.md §3~5 참고.
//
// 이 서버가 "Agent 간 통신 강제"의 실체다: Agent에게 다른 Agent와 대화할 수 있는 방법은
// 이 두 도구(ask_agent/answer_question)뿐이고, 둘 다 이 서버(≈오케스트레이터)를 반드시 거친다.
//
// 각 Agent 프로세스가 이 스크립트를 --mcp-config로 각자 stdio 서버로 띄우되, 전부 같은
// SQLite 파일(qa-store.ts/event-log.ts)을 공유해서 서로의 질문/답변을 주고받고 Event Log도 함께 쌓는다.
//
// 실제 전달(승인된 질문/답변을 대상 Agent에게 resume()하는 것)은 이 프로세스가 아니라
// src/orchestrator.ts가 별도로 폴링하며 수행한다.

const db = openDb();
const eventLog = new EventLogStore(db);
const store = new QaStore(db, eventLog);
const decisionRecords = new DecisionRecordStore(db, eventLog);

const server = new McpServer({ name: "orchestrator", version: "0.1.0" });

server.registerTool(
  "ask_agent",
  {
    title: "Ask another Project Agent",
    description:
      "다른 프로젝트를 담당하는 Agent에게 질문을 보낸다. 반드시 자신의 컨텍스트만으로 해결 불가능한 정보를 " +
      "다른 프로젝트 담당자에게 확인해야 할 때만 사용한다(Question Eligibility Check, requirements.md §8). " +
      "Human이 승인해야 실제로 전달되며, 승인/거절 여부를 이 도구의 응답으로 즉시 알 수 있다.",
    inputSchema: {
      from_agent_id: z.string().describe("질문하는 자기 자신의 Agent id"),
      target_agent_id: z.string().describe("질문을 받을 대상 Agent id"),
      question: z.string().describe("질문 내용"),
      why_needed: z
        .string()
        .describe("왜 이 정보가 필요한지, 왜 자신의 컨텍스트만으로는 해결할 수 없는지에 대한 근거"),
    },
  },
  async ({ from_agent_id, target_agent_id, question, why_needed }) => {
    const q = store.createQuestion({
      fromAgentId: from_agent_id,
      toAgentId: target_agent_id,
      text: question,
      selfJustification: why_needed,
    });

    const decided = await store.waitForQuestionDecision(q.id);

    if (decided.status === "REJECTED") {
      return {
        content: [
          {
            type: "text" as const,
            text: `질문이 거절되었습니다. 사유: ${decided.reviewReason ?? "(사유 없음)"}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text:
            `질문이 승인되었습니다 (question_id: ${decided.id}). ` +
            `대상 Agent(${target_agent_id})에게 전달 및 답변 수신은 별도로 안내될 예정입니다.`,
        },
      ],
    };
  }
);

server.registerTool(
  "answer_question",
  {
    title: "Answer a pending question",
    description:
      "다른 Agent로부터 전달받은 질문에 답변한다. content_status로 자신이 이 답변에 대해 " +
      "얼마나 확신하는지를 반드시 함께 표시한다(requirements.md §11). Human이 승인해야 실제로 " +
      "질문한 Agent에게 전달되며, 거절되면 사유와 함께 재답변할 수 있다.",
    inputSchema: {
      question_id: z.string().describe("답변할 질문의 id"),
      from_agent_id: z.string().describe("답변하는 자기 자신의 Agent id"),
      answer: z.string().describe("답변 내용"),
      content_status: z.enum(ANSWER_CONTENT_STATUSES).describe("이 답변의 확신 수준/상태"),
    },
  },
  async ({ question_id, from_agent_id, answer, content_status }) => {
    const question = store.getQuestion(question_id);
    if (!question) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `question_id ${question_id}를 찾을 수 없습니다.` }],
      };
    }

    const a = store.createAnswer({ questionId: question_id, fromAgentId: from_agent_id, text: answer, contentStatus: content_status });
    const decided = await store.waitForAnswerDecision(a.id);

    if (decided.reviewStatus === "REJECTED") {
      return {
        content: [
          {
            type: "text" as const,
            text: `답변이 거절되었습니다. 사유: ${decided.reviewReason ?? "(사유 없음)"}. 보완해서 다시 answer_question을 호출하세요.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `답변이 승인되었습니다 (answer_id: ${decided.id}). 질문한 Agent에게 전달될 예정입니다.`,
        },
      ],
    };
  }
);

server.registerTool(
  "submit_decision_record",
  {
    title: "Submit a Decision Record",
    description:
      "의사결정 기록을 하나 제출한다(requirements.md §15~17, §19). 오직 Orchestrator가 이미 전달한 " +
      "Decision Context(질문/답변 원문, 거절 사유 등)를 사람이 이해할 수 있는 글로 정리하는 용도이며, " +
      "기술적·설계적 판단을 새로 내리거나 Agent에게 구현을 지시하는 데 쓰지 않는다. " +
      "제출한 기록은 DRAFT 상태로 저장되고 Human이 별도로 승인/거절한다 — 이 도구는 응답을 기다리지 않고 바로 끝난다.",
    inputSchema: {
      trigger_type: z
        .enum(["QUESTION_REJECTED", "ANSWER_REJECTED", "DECISION_INTERVENTION"])
        .describe("이 기록을 촉발한 이벤트 종류"),
      trigger_question_id: z.string().nullable().describe("트리거가 질문 거절이면 그 question_id, 아니면 null"),
      trigger_answer_id: z.string().nullable().describe("트리거가 답변 거절이면 그 answer_id, 아니면 null"),
      trigger_decision_intervention_id: z
        .string()
        .nullable()
        .describe("트리거가 Decision Intervention이면 그 id, 아니면 null"),
      background: z.string().describe("왜 이 결정이 필요하게 되었는가"),
      problem: z.string().describe("무엇을 해결해야 했는가"),
      constraints: z.string().describe("결정에 영향을 미치는 기존 구조나 요구사항"),
      options: z.string().describe("검토된 대안들"),
      options_comparison: z.string().describe("각 대안의 장단점/영향/비용/위험 비교"),
      rationale: z.string().describe("왜 특정 선택지를 선택하거나 제외했는가"),
      conclusion: z.string().describe("무엇을 결정했는가"),
      decision_maker: z.string().describe("누가 최종 결정했는가 (거절한 Human)"),
      related_info: z.string().nullable().describe("관련 요구사항/프로젝트/코드 등의 참고 정보, 없으면 null"),
      related_file_paths: z
        .array(z.string())
        .describe("이 결정과 관련된 파일 경로들. 오케스트레이터가 제공한 최근 파일 목록 중 실제로 관련 있는 것만 고른다. 없으면 빈 배열"),
      revising_decision_record_id: z
        .string()
        .nullable()
        .describe(
          "Human이 거절해서 다시 쓰는 재작성이면 그 decision_record_id(같은 레코드를 갱신한다), 새로 작성하는 기록이면 null"
        ),
    },
  },
  async (input) => {
    if (input.revising_decision_record_id) {
      const updated = decisionRecords.update(input.revising_decision_record_id, {
        background: input.background,
        problem: input.problem,
        constraints: input.constraints,
        options: input.options,
        optionsComparison: input.options_comparison,
        rationale: input.rationale,
        conclusion: input.conclusion,
        decisionMaker: input.decision_maker,
        relatedInfo: input.related_info,
        relatedFilePaths: input.related_file_paths,
      });
      if (!updated) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `decision_record_id ${input.revising_decision_record_id}를 찾을 수 없거나 재작성 대기 상태가 아닙니다.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Decision Record가 갱신된 초안으로 저장되었습니다 (decision_record_id: ${updated.id}). Human 승인을 기다립니다.`,
          },
        ],
      };
    }

    const record = decisionRecords.create({
      triggerType: input.trigger_type,
      triggerQuestionId: input.trigger_question_id,
      triggerAnswerId: input.trigger_answer_id,
      triggerDecisionInterventionId: input.trigger_decision_intervention_id,
      background: input.background,
      problem: input.problem,
      constraints: input.constraints,
      options: input.options,
      optionsComparison: input.options_comparison,
      rationale: input.rationale,
      conclusion: input.conclusion,
      decisionMaker: input.decision_maker,
      relatedInfo: input.related_info,
      relatedFilePaths: input.related_file_paths,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `Decision Record가 초안으로 저장되었습니다 (decision_record_id: ${record.id}). Human 승인을 기다립니다.`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
