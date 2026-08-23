import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { EventLogEntry, EventSource, EventType } from "./types.js";

// docs/data-model.md §5 참고.

export class EventLogStore {
  constructor(private readonly db: Database.Database) {}

  record(input: {
    agentId: string;
    sessionId?: string | null;
    type: EventType;
    source: EventSource;
    payload: unknown;
    relatedQuestionId?: string | null;
    relatedAnswerId?: string | null;
  }): EventLogEntry {
    const entry: EventLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      agentId: input.agentId,
      sessionId: input.sessionId ?? null,
      type: input.type,
      source: input.source,
      payload: input.payload,
      relatedQuestionId: input.relatedQuestionId ?? null,
      relatedAnswerId: input.relatedAnswerId ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO event_log (id, timestamp, agentId, sessionId, type, source, payload, relatedQuestionId, relatedAnswerId)
         VALUES (@id, @timestamp, @agentId, @sessionId, @type, @source, @payload, @relatedQuestionId, @relatedAnswerId)`
      )
      .run({ ...entry, payload: JSON.stringify(entry.payload) });
    return entry;
  }

  list(filter: { agentId?: string; limit?: number } = {}): EventLogEntry[] {
    const limit = filter.limit ?? 100;
    const rows = (
      filter.agentId
        ? this.db
            .prepare("SELECT * FROM event_log WHERE agentId = ? ORDER BY timestamp DESC LIMIT ?")
            .all(filter.agentId, limit)
        : this.db.prepare("SELECT * FROM event_log ORDER BY timestamp DESC LIMIT ?").all(limit)
    ) as (Omit<EventLogEntry, "payload"> & { payload: string })[];
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }
}
