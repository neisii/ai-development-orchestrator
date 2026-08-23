import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// 여러 Agent의 MCP 서버 프로세스가 이 파일 하나를 공유해서 Question/Answer를 주고받는다.
// (docs/data-model.md §7: "오케스트레이터가 유일한 writer" 가정과 달리, 여기서는 MCP 서버
// 여러 인스턴스가 각자 writer다. SQLite의 파일 잠금으로 동시 쓰기를 처리한다.)
const DEFAULT_DB_PATH = ".orchestrator/data.db";

export function openDb(path: string = process.env.ORCHESTRATOR_DB_PATH ?? DEFAULT_DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      fromAgentId TEXT NOT NULL,
      toAgentId TEXT NOT NULL,
      text TEXT NOT NULL,
      selfJustification TEXT NOT NULL,
      status TEXT NOT NULL,
      humanReviewer TEXT,
      reviewReason TEXT,
      createdAt TEXT NOT NULL,
      reviewedAt TEXT,
      deliveredAt TEXT
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      questionId TEXT NOT NULL,
      fromAgentId TEXT NOT NULL,
      text TEXT NOT NULL,
      contentStatus TEXT NOT NULL,
      reviewStatus TEXT NOT NULL,
      humanReviewer TEXT,
      reviewReason TEXT,
      createdAt TEXT NOT NULL,
      reviewedAt TEXT,
      deliveredAt TEXT
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      agentId TEXT NOT NULL,
      sessionId TEXT,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      relatedQuestionId TEXT,
      relatedAnswerId TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_event_log_agent ON event_log (agentId, timestamp);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      projectPath TEXT NOT NULL,
      sessionId TEXT,
      pid INTEGER,
      lifecycleState TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interventions (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL,
      kind TEXT NOT NULL,
      prompt TEXT,
      requestedBy TEXT NOT NULL,
      requestedAt TEXT NOT NULL,
      appliedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_interventions_pending ON interventions (appliedAt, requestedAt);
  `);
  return db;
}
