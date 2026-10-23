import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { queryRepo, validateRepo } from "../lib/repo-query.ts";

try {
  const { values } = parseArgs({ options: { repo: { type: "string" }, db: { type: "string" } }, allowPositionals: false });
  if (!values.repo) throw new Error("Usage: npm run query -- --repo owner/name [--db /path/to/github.db]");
  validateRepo(values.repo);
  const dbPath = path.resolve(values.db ?? path.join("data", "github.db"));
  if (!fs.existsSync(dbPath)) throw new Error(`Archive database not found: ${dbPath}. Supply --db or run the private ingest; no public fallback is used.`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    console.log(JSON.stringify(queryRepo(db, values.repo), null, 2));
  } finally { db.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
