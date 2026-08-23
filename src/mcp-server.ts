import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";
import { QaStore } from "./qa-store.js";
import { EventLogStore } from "./event-log.js";
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
const store = new QaStore(db, new EventLogStore(db));

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

const transport = new StdioServerTransport();
await server.connect(transport);
