import { Database } from "bun:sqlite";

import { SESSION_SCHEMA_VERSION, type StoredSession } from "./contracts";

export interface SessionRepository {
  get(id: string): StoredSession | undefined;
  put(session: StoredSession): void;
  close(): void;
}

export function createSessionRepository(dataFile: string): SessionRepository {
  const database = new Database(dataFile, { create: true });
  database.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const read = database.query("SELECT payload FROM sessions WHERE id = ?");
  const write = database.query(
    "INSERT INTO sessions (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
  );
  return {
    get(id) {
      const row = read.get(id) as { payload: string } | null;
      if (!row) return undefined;
      const session = JSON.parse(row.payload) as StoredSession;
      if (session.schema_version !== SESSION_SCHEMA_VERSION) {
        throw new Error(`Unsupported session schema version: ${String(session.schema_version)}`);
      }
      return session;
    },
    put(session) {
      write.run(session.id, JSON.stringify(session));
    },
    close() {
      database.close();
    },
  };
}
