import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DB_PATH = path.join(process.cwd(), "data", "github.db");

export function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}
