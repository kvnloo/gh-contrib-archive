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
  created_at: string;
  flags: { code: string; severity: string; detail: string }[];
};

export function queryContributions(opts: {
  type?: string;
  flag?: string;
  repo?: string;
  q?: string;
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
    where.push("c.repo LIKE ?");
    params.push(`%${opts.repo}%`);
  }
  if (opts.q) {
    where.push("(c.title LIKE ? OR c.excerpt LIKE ? OR c.url LIKE ? OR IFNULL(c.repo,'') LIKE ?)");
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
         (SELECT COUNT(*) FROM flags WHERE severity = 'bad') AS bad,
         (SELECT COUNT(*) FROM flags WHERE severity = 'warn') AS warn,
         (SELECT COUNT(*) FROM flags WHERE code = 'agent_marker') AS agent_marker,
         (SELECT COUNT(*) FROM flags WHERE code = 'agent_template') AS agent_template,
         (SELECT COUNT(*) FROM flags WHERE code = 'generic_ai_slop') AS generic_ai_slop,
         (SELECT COUNT(*) FROM flags WHERE code = 'empty_body') AS empty_body,
         (SELECT COUNT(*) FROM flags WHERE code = 'unfilled_template') AS unfilled_template,
         (SELECT COUNT(*) FROM flags WHERE code = 'machine_title') AS machine_title
      `,
    )
    .get() as Record<string, number>;
  const byType = db
    .prepare("SELECT type, COUNT(*) AS n FROM contributions GROUP BY type ORDER BY n DESC")
    .all() as { type: string; n: number }[];
  db.close();
  return {
    total,
    stats,
    byType,
    items: rows.map((r) => ({
      ...r,
      flags: JSON.parse(r.flags_json || "[]") as Contribution["flags"],
    })),
  };
}
