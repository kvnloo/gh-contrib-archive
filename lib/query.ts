import { openDb } from "./db";

export type Contribution = {
  id: string;
  type: string;
  url: string;
  repo: string | null;
  number: number | null;
  title: string | null;
  excerpt: string | null;
  body_chars: number;
  state: string | null;
  visibility: string;
  created_at: string;
  flags: { code: string; severity: string; detail: string }[];
};

export function queryContributions(opts: {
  type?: string;
  flag?: string;
  repo?: string;
  q?: string;
  year?: string;
  visibility?: string;
  limit?: number;
  offset?: number;
}) {
  const db = openDb();
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (opts.type) {
    where.push("c.type = ?");
    params.push(opts.type);
  }
  if (opts.flag) {
    where.push("EXISTS (SELECT 1 FROM flags f WHERE f.contribution_id = c.id AND f.code = ?)");
    params.push(opts.flag);
  }
  if (opts.repo) {
    where.push("c.visibility = 'public' AND c.repo LIKE ?");
    params.push(`%${opts.repo}%`);
  }
  if (opts.year) {
    where.push("substr(c.created_at, 1, 4) = ?");
    params.push(opts.year);
  }
  if (opts.q) {
    where.push(
      "c.visibility = 'public' AND (c.title LIKE ? OR c.excerpt LIKE ? OR c.url LIKE ? OR IFNULL(c.repo,'') LIKE ?)",
    );
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  const limit = opts.limit ?? 80;
  const offset = opts.offset ?? 0;
  const whereSql = where.join(" AND ");
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM contributions c WHERE ${whereSql}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(
      `SELECT c.*, (
         SELECT json_group_array(json_object('code', f.code, 'severity', f.severity, 'detail', f.detail))
         FROM flags f WHERE f.contribution_id = c.id
       ) AS flags_json
       FROM contributions c
       WHERE ${whereSql}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as (Omit<Contribution, "flags"> & { flags_json: string })[];
  const stats = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM contributions) AS total,
         (SELECT COUNT(*) FROM contributions WHERE visibility = 'public') AS public_n,
         (SELECT COUNT(*) FROM contributions WHERE visibility = 'private') AS private_n,
         (SELECT COUNT(*) FROM flags WHERE severity = 'bad') AS bad,
         (SELECT COUNT(*) FROM flags WHERE severity = 'warn') AS warn,
         (SELECT COUNT(*) FROM flags WHERE code = 'agent_marker') AS agent_marker,
         (SELECT COUNT(*) FROM flags WHERE code = 'agent_template') AS agent_template,
         (SELECT COUNT(*) FROM flags WHERE code = 'generic_ai_slop') AS generic_ai_slop,
         (SELECT COUNT(*) FROM flags WHERE code = 'empty_body') AS empty_body,
         (SELECT COUNT(*) FROM flags WHERE code = 'unfilled_template') AS unfilled_template,
         (SELECT COUNT(*) FROM flags WHERE code = 'machine_title') AS machine_title,
         (SELECT IFNULL(SUM(commit_count),0) FROM commit_buckets WHERE visibility = 'public') AS public_commits,
         (SELECT IFNULL(SUM(commit_count),0) FROM commit_buckets WHERE visibility = 'private') AS private_commits
      `,
    )
    .get() as Record<string, number>;
  const byType = db
    .prepare("SELECT type, COUNT(*) AS n FROM contributions GROUP BY type ORDER BY n DESC")
    .all() as { type: string; n: number }[];
  const byYear = db
    .prepare(
      `SELECT substr(created_at, 1, 4) AS year, COUNT(*) AS n
       FROM contributions GROUP BY year ORDER BY year`,
    )
    .all() as { year: string; n: number }[];
  const byMonth = db
    .prepare(
      `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS n
       FROM contributions GROUP BY month ORDER BY month`,
    )
    .all() as { month: string; n: number }[];
  const byRepo = db
    .prepare(
      `SELECT repo, COUNT(*) AS n
       FROM contributions WHERE visibility = 'public' AND repo IS NOT NULL
       GROUP BY repo ORDER BY n DESC LIMIT 18`,
    )
    .all() as { repo: string; n: number }[];
  const byFlag = db
    .prepare(
      `SELECT code, severity, COUNT(*) AS n FROM flags GROUP BY code, severity ORDER BY n DESC`,
    )
    .all() as { code: string; severity: string; n: number }[];
  const commitBuckets = db
    .prepare(
      `SELECT year, repo, visibility, commit_count, html_url
       FROM commit_buckets ORDER BY year DESC, commit_count DESC`,
    )
    .all() as {
    year: number;
    repo: string | null;
    visibility: string;
    commit_count: number;
    html_url: string | null;
  }[];
  const repoCount = (
    db
      .prepare("SELECT COUNT(DISTINCT repo) AS n FROM contributions WHERE visibility = 'public'")
      .get() as { n: number }
  ).n;
  db.close();
  return {
    total,
    stats,
    byType,
    byYear,
    byMonth,
    byRepo,
    byFlag,
    commitBuckets,
    repoCount,
    items: rows.map((r) => ({
      ...r,
      flags: r.visibility === "public" ? (JSON.parse(r.flags_json || "[]") as Contribution["flags"]) : [],
    })),
  };
}
