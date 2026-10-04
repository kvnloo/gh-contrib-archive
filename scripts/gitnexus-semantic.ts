import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  compileSemanticGraph,
  type SemanticConceptConfig,
  type SemanticHotsetRepo,
} from "../lib/semantic-graph.ts";

type Json = Record<string, any>;

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const limit = Math.max(1, Math.min(8, Number(argValue("limit") ?? "5") || 5));
const embeddings = process.argv.includes("--embeddings");
const outPath = path.resolve(argValue("out") ?? path.join("data", "semantic-graph.json"));
const dbPath = path.resolve(argValue("db") ?? path.join("data", "public.db"));
const conceptsPath = path.resolve(
  argValue("concepts") ?? path.join("data", "semantic-concepts.json"),
);
const gitnexus = process.env.GITNEXUS_BIN ?? "gitnexus";
const gitnexusVersion = process.env.GITNEXUS_VERSION ?? "1.6.12";
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gh-semantic-"));

function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {},
) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 600_000,
    env: {
      ...process.env,
      CI: "true",
      GITNEXUS_NO_UPDATE_NOTIFIER: "1",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false as const,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? String(result.error ?? ""),
    };
  }
  return {
    ok: true as const,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJsonOutput(raw: string): Json | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as Json;
    } catch {
      return null;
    }
  }
}

function aliasFor(repo: string) {
  return repo.replace("/", "__").replace(/[^A-Za-z0-9_.-]/g, "_");
}

const conceptsRaw = JSON.parse(fs.readFileSync(conceptsPath, "utf8")) as {
  concepts?: SemanticConceptConfig[];
};
const concepts = Array.isArray(conceptsRaw.concepts) ? conceptsRaw.concepts : [];
if (concepts.length === 0) throw new Error("semantic concept catalog is empty");

const db = new DatabaseSync(dbPath);
let hotRows: { repo: string; activity_count: number; last_activity_at: string | null }[];
try {
  hotRows = db
    .prepare(
      `SELECT repo,
              COUNT(*) AS activity_count,
              MAX(COALESCE(updated_at, created_at)) AS last_activity_at
       FROM contributions
       WHERE visibility = 'public' AND repo IS NOT NULL
       GROUP BY repo
       ORDER BY last_activity_at DESC, activity_count DESC, repo ASC
       LIMIT ?`,
    )
    .all(limit) as typeof hotRows;
} finally {
  db.close();
}

const hotset: SemanticHotsetRepo[] = [];
const results = new Map<string, Map<string, Json>>();

for (const row of hotRows) {
  const alias = aliasFor(row.repo);
  const clonePath = path.join(workRoot, alias);
  const clone = run("git", [
    "clone",
    "--depth=1",
    "--quiet",
    `https://github.com/${row.repo}.git`,
    clonePath,
  ]);
  if (!clone.ok) {
    console.warn(`semantic clone failed: ${row.repo}`);
    hotset.push({
      repo: row.repo,
      alias,
      sha: null,
      lastActivityAt: row.last_activity_at,
      activityCount: Number(row.activity_count),
      status: "clone_failed",
    });
    continue;
  }

  const shaResult = run("git", ["-C", clonePath, "rev-parse", "HEAD"]);
  const sha = shaResult.ok ? shaResult.stdout.trim() : null;
  const analyzeArgs = ["analyze", clonePath, "--index-only", "--name", alias];
  if (embeddings) analyzeArgs.push("--embeddings");
  const analyzed = run(gitnexus, analyzeArgs, { timeout: 900_000 });
  if (!analyzed.ok) {
    console.warn(`semantic analyze failed: ${row.repo}`);
    hotset.push({
      repo: row.repo,
      alias,
      sha,
      lastActivityAt: row.last_activity_at,
      activityCount: Number(row.activity_count),
      status: "analyze_failed",
    });
    continue;
  }

  hotset.push({
    repo: row.repo,
    alias,
    sha,
    lastActivityAt: row.last_activity_at,
    activityCount: Number(row.activity_count),
    status: "indexed",
  });

  const repoResults = new Map<string, Json>();
  for (const concept of concepts) {
    const queried = run(gitnexus, [
      "query",
      concept.query,
      "--repo",
      alias,
      "--limit",
      "5",
    ]);
    if (!queried.ok) {
      console.warn(`semantic query failed: ${row.repo} / ${concept.id}`);
      continue;
    }
    const parsed = parseJsonOutput(queried.stdout);
    if (parsed) repoResults.set(concept.id, parsed);
  }
  results.set(row.repo, repoResults);
}

const graph = compileSemanticGraph({
  gitnexusVersion,
  embeddings,
  hotset,
  concepts,
  results,
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

const indexed = hotset.filter((repo) => repo.status === "indexed").length;
const links = graph.repoLinks.length;
console.log(
  `semantic graph: ${indexed}/${hotset.length} repos indexed, ${graph.concepts.length} concepts, ${links} repo links, revision ${graph.revision}`,
);
