import { createHash } from "node:crypto";
import fs from "node:fs";
import { PRIVATE_DB_PATH, PUBLIC_DB_PATH, openDb } from "../lib/db";

const LOGIN = process.env.GH_LOGIN ?? "kvnloo";
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GH_TOKEN is required");
  process.exit(1);
}

type Gql = { data?: Record<string, unknown>; errors?: { message: string }[] };

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "kvnloo-contrib-archive",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as Gql & T;
  if (!res.ok || json.errors) {
    throw new Error(json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`);
  }
  return json;
}

async function classifyRepos() {
  const db = openDb(PRIVATE_DB_PATH);
  const repos = db
    .prepare("SELECT DISTINCT repo FROM contributions WHERE repo IS NOT NULL")
    .all() as { repo: string }[];
  console.log(`classifying ${repos.length} repos`);
  for (const { repo } of repos) {
    const [owner, name] = repo.split("/");
    if (!owner || !name) continue;
    let visibility = "private";
    try {
      const json = await graphql<{
        data: { repository: { isPrivate: boolean } | null };
      }>(
        `query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) { isPrivate }
        }`,
        { owner, name },
      );
      visibility = json.data.repository?.isPrivate ? "private" : "public";
    } catch {
      visibility = "private";
    }
    db.prepare("UPDATE contributions SET visibility = ? WHERE repo = ?").run(visibility, repo);
  }
  db.prepare("UPDATE contributions SET visibility = 'private' WHERE repo IS NULL OR visibility = 'unknown'").run();
  const counts = db
    .prepare("SELECT visibility, COUNT(*) n FROM contributions GROUP BY visibility")
    .all();
  console.log("visibility", counts);
  db.close();
}

async function ingestCommitBuckets() {
  const db = openDb(PRIVATE_DB_PATH);
  db.exec("DELETE FROM commit_buckets");
  const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  for (const year of years) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    const json = await graphql<{
      data: {
        user: {
          contributionsCollection: {
            totalCommitContributions: number;
            commitContributionsByRepository: {
              repository: { nameWithOwner: string; isPrivate: boolean } | null;
              contributions: { totalCount: number };
            }[];
          };
        };
      };
    }>(
      `query ($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            restrictedContributionsCount
            commitContributionsByRepository(maxRepositories: 100) {
              repository { nameWithOwner isPrivate }
              contributions { totalCount }
            }
          }
        }
      }`,
      { login: LOGIN, from, to },
    );
    const col = json.data.user.contributionsCollection;
    let privateCommits = 0;
    for (const row of col.commitContributionsByRepository) {
      const repo = row.repository;
      const count = row.contributions.totalCount;
      if (!repo || repo.isPrivate) {
        privateCommits += count;
        continue;
      }
      const id = `${year}:${repo.nameWithOwner}`;
      db.prepare(
        `INSERT INTO commit_buckets (id, year, repo, visibility, commit_count, html_url)
         VALUES (?, ?, ?, 'public', ?, ?)`,
      ).run(
        id,
        year,
        repo.nameWithOwner,
        count,
        `https://github.com/${repo.nameWithOwner}/commits?author=${LOGIN}`,
      );
    }
    if (privateCommits > 0) {
      db.prepare(
        `INSERT INTO commit_buckets (id, year, repo, visibility, commit_count, html_url)
         VALUES (?, ?, NULL, 'private', ?, NULL)`,
      ).run(`private:${year}`, year, privateCommits);
    }
    console.log(
      `commits ${year}: public repos ${col.commitContributionsByRepository.filter((r) => r.repository && !r.repository.isPrivate).length}, private count ${privateCommits}, totalCommitContributions ${col.totalCommitContributions}`,
    );
  }
  db.close();
}

function publishPublicDb() {
  if (fs.existsSync(PUBLIC_DB_PATH)) fs.unlinkSync(PUBLIC_DB_PATH);
  const src = openDb(PRIVATE_DB_PATH);
  const dst = openDb(PUBLIC_DB_PATH);

  const insert = dst.prepare(
    `INSERT INTO contributions (
      id, github_node_id, type, url, html_url, repo, number, title, excerpt,
      body_chars, state, visibility, created_at, updated_at, ingested_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  );

  const rows = src.prepare("SELECT * FROM contributions").all() as Record<string, unknown>[];
  for (const row of rows) {
    const vis = String(row.visibility ?? "private");
    if (vis === "public") {
      insert.run(
        row.id,
        row.github_node_id,
        row.type,
        row.url,
        row.html_url ?? row.url,
        row.repo,
        row.number,
        row.title,
        row.excerpt,
        row.body_chars,
        row.state,
        "public",
        row.created_at,
        row.updated_at,
        row.extra_json,
      );
      continue;
    }
    const opaque = createHash("sha256").update(String(row.id)).digest("hex").slice(0, 20);
    insert.run(
      `private:${opaque}`,
      null,
      row.type,
      `redacted://private/${opaque}`,
      `redacted://private/${opaque}`,
      null,
      null,
      null,
      null,
      0,
      null,
      "private",
      row.created_at,
      null,
      null,
    );
  }

  const flags = src
    .prepare(
      `SELECT f.code, f.severity, f.detail, c.id
       FROM flags f JOIN contributions c ON c.id = f.contribution_id
       WHERE c.visibility = 'public'`,
    )
    .all() as { code: string; severity: string; detail: string; id: string }[];
  const insFlag = dst.prepare(
    "INSERT OR IGNORE INTO flags (contribution_id, code, severity, detail) VALUES (?, ?, ?, ?)",
  );
  for (const f of flags) insFlag.run(f.id, f.code, f.severity, f.detail);

  const buckets = src.prepare("SELECT * FROM commit_buckets").all() as {
    id: string;
    year: number;
    repo: string | null;
    visibility: string;
    commit_count: number;
    html_url: string | null;
  }[];
  const insB = dst.prepare(
    `INSERT INTO commit_buckets (id, year, repo, visibility, commit_count, html_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const b of buckets) {
    if (b.visibility === "public") {
      insB.run(b.id, b.year, b.repo, "public", b.commit_count, b.html_url);
    } else {
      insB.run(`private:${b.year}`, b.year, null, "private", b.commit_count, null);
    }
  }

  dst.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run("privacy", "public-safe");
  console.log(
    "public.db",
    dst.prepare("SELECT visibility, COUNT(*) n FROM contributions GROUP BY visibility").all(),
  );
  src.close();
  dst.close();
}

async function main() {
  await classifyRepos();
  await ingestCommitBuckets();
  publishPublicDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
