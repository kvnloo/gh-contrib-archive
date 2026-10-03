import { openAttentionDb, readAttentionRecords } from "../lib/attention-db.ts";

const json = process.argv.includes("--json");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(1, Math.min(200, Number(limitArg?.split("=")[1] ?? 20) || 20));

const db = openAttentionDb();
let records;
try {
  records = readAttentionRecords(db, limit);
} finally {
  db.close();
}

if (json) {
  console.log(JSON.stringify(records, null, 2));
} else if (records.length === 0) {
  console.log("No authored open PRs are in the local attention queue. Run `npm run inbox:sync` first.");
} else {
  for (const record of records) {
    console.log(`${record.priority} ${record.repo}#${record.number} ${record.blocker} — ${record.title}`);
    console.log(`   next: ${record.nextAction}`);
    console.log(`   ${record.url}`);
  }
}
