import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AttentionRecord, RepositoryVisibility } from "./attention.ts";

export const ATTENTION_DB_PATH = path.join(process.cwd(), "data", "attention.db");

export function openAttentionDb(dbPath = ATTENTION_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS attention_prs (
      repo TEXT NOT NULL,
      repo_visibility TEXT NOT NULL DEFAULT 'unknown',
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      priority TEXT NOT NULL,
      blocker TEXT NOT NULL,
      next_action TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_external_at TEXT,
      last_self_at TEXT,
      ci_state TEXT NOT NULL,
      review_decision TEXT,
      merge_state TEXT,
      PRIMARY KEY (repo, number)
    );
    CREATE TABLE IF NOT EXISTS attention_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const columns = db.prepare("PRAGMA table_info(attention_prs)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "repo_visibility")) {
    db.exec(
      "ALTER TABLE attention_prs ADD COLUMN repo_visibility TEXT NOT NULL DEFAULT 'unknown'",
    );
  }
  return db;
}

export function replaceAttentionRecords(
  db: DatabaseSync,
  records: AttentionRecord[],
  syncedAt: string,
) {
  const insert = db.prepare(`
    INSERT INTO attention_prs (
      repo, repo_visibility, number, title, url, priority, blocker, next_action, updated_at,
      last_external_at, last_self_at, ci_state, review_decision, merge_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM attention_prs");
    for (const record of records) {
      insert.run(
        record.repo,
        record.repoVisibility,
        record.number,
        record.title,
        record.url,
        record.priority,
        record.blocker,
        record.nextAction,
        record.updatedAt,
        record.lastExternalAt,
        record.lastSelfAt,
        record.ciState,
        record.reviewDecision,
        record.mergeState,
      );
    }
    db.prepare(
      "INSERT INTO attention_meta(key, value) VALUES('last_sync_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(syncedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function readAttentionRecords(db: DatabaseSync, limit = 20): AttentionRecord[] {
  const rows = db.prepare(`
    SELECT repo, repo_visibility, number, title, url, priority, blocker, next_action, updated_at,
           last_external_at, last_self_at, ci_state, review_decision, merge_state
    FROM attention_prs
    ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, updated_at DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    repo: String(row.repo),
    repoVisibility: String(row.repo_visibility ?? "unknown") as RepositoryVisibility,
    number: Number(row.number),
    title: String(row.title),
    url: String(row.url),
    priority: String(row.priority) as AttentionRecord["priority"],
    blocker: String(row.blocker),
    nextAction: String(row.next_action),
    updatedAt: String(row.updated_at),
    lastExternalAt: row.last_external_at === null ? null : String(row.last_external_at),
    lastSelfAt: row.last_self_at === null ? null : String(row.last_self_at),
    ciState: String(row.ci_state) as AttentionRecord["ciState"],
    reviewDecision: row.review_decision === null ? null : String(row.review_decision),
    mergeState: row.merge_state === null ? null : String(row.merge_state),
  }));
}

export function readAttentionSyncedAt(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT value FROM attention_meta WHERE key = 'last_sync_at'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
