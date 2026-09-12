import { openDb } from "../lib/db";

const db = openDb();
const totals = db.prepare("SELECT type, COUNT(*) n FROM contributions GROUP BY type").all();
const flags = db
  .prepare(
    `SELECT f.severity, f.code, COUNT(*) n
     FROM flags f GROUP BY f.severity, f.code ORDER BY f.severity, n DESC`,
  )
  .all();
const samples = db
  .prepare(
    `SELECT c.created_at, c.type, c.url, c.repo, c.title, c.excerpt, f.code, f.severity
     FROM flags f JOIN contributions c ON c.id = c.id AND c.id = f.contribution_id
     WHERE f.severity IN ('bad','warn')
     ORDER BY c.created_at DESC LIMIT 40`,
  )
  .all();
console.log(JSON.stringify({ totals, flags, samples }, null, 2));
db.close();
