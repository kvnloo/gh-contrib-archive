import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const PRIVATE_DB_PATH = path.join(process.cwd(), "data", "github.db");
export const PUBLIC_DB_PATH = path.join(process.cwd(), "data", "public.db");

export const DB_PATH =
  process.env.USE_PRIVATE_DB === "1" ? PRIVATE_DB_PATH : PUBLIC_DB_PATH;

export function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
  db.exec(schema);
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  const cols = db.prepare("PRAGMA table_info(contributions)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("visibility")) {
    db.exec("ALTER TABLE contributions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'unknown'");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_contrib_visibility ON contributions(visibility)");
}
