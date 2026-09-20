import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const PUBLIC_SNAPSHOT_SCHEMA = 1 as const;

type ContributionRow = {
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
  updated_at: string | null;
  ingested_at: string;
  extra_json: string | null;
};

type FlagRow = {
  contribution_id: string;
  code: string;
  severity: string;
  detail: string;
};

type CommitRow = {
  year: number;
  repo: string | null;
  visibility: string;
  commit_count: number;
  html_url: string | null;
};

export type PublicArchiveItem =
  | {
      id: string;
      type: string;
      visibility: "public";
      url: string;
      repo: string | null;
      number: number | null;
      title: string | null;
      excerpt: string | null;
      body_chars: number;
      state: string | null;
      created_at: string;
      updated_at: string | null;
      flags: { code: string; severity: string; detail: string }[];
    }
  | {
      id: string;
      type: string;
      visibility: "private";
      created_at: string;
    };

export type PublicWorldNode =
  | {
      id: string;
      type: string;
      created: string;
      visibility: "public";
      url: string;
      repo?: string;
      org?: string;
      number?: number;
      title?: string;
      flags: string[];
    }
  | {
      id: string;
      type: string;
      created: string;
      visibility: "private";
    };

export type PublicWorldGraph = {
  login: string;
  privacy: "public-safe";
  nodes: PublicWorldNode[];
  edges: { source: string; target: string; kind: "citation" | "comment-on" }[];
  lights: { month: string; visibility: "public" | "private"; n: number }[];
  commits: {
    year: number;
    repo: string | null;
    visibility: "public" | "private";
    count: number;
    url: string | null;
  }[];
  orgs: { org: string; n: number }[];
  repos: { repo: string; n: number }[];
};

export type PublicArchive = {
  schemaVersion: typeof PUBLIC_SNAPSHOT_SCHEMA;
  privacy: "public-safe";
  generatedAt: string;
  stats: Record<string, number>;
  byType: { type: string; n: number }[];
  byYear: { year: string; n: number }[];
  byMonth: { month: string; n: number }[];
  byRepo: { repo: string; n: number }[];
  byFlag: { code: string; severity: string; n: number }[];
  commitBuckets: {
    year: number;
    repo: string | null;
    visibility: "public" | "private";
    commit_count: number;
    html_url: string | null;
  }[];
  repoCount: number;
  items: PublicArchiveItem[];
};

export type PublicSnapshotManifest = {
  schemaVersion: typeof PUBLIC_SNAPSHOT_SCHEMA;
  privacy: "public-safe";
  lastCheckedAt: string;
  lastChangedAt: string;
  counts: {
    events: number;
    publicEvents: number;
    privateEvents: number;
    commits: number;
    repos: number;
    orgs: number;
  };
  hashes: {
    archiveSha256: string;
    worldGraphSha256: string;
  };
};

export type CompiledPublicSnapshot = {
  manifest: PublicSnapshotManifest;
  archive: PublicArchive;
  worldGraph: PublicWorldGraph;
};

function normalizeDate(value: string | null | undefined) {
  if (!value) return new Date(0).toISOString();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(" ", "T") + "Z";
  }
  return value;
}

function visibilityOf(value: string): "public" | "private" {
  return value === "public" ? "public" : "private";
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function metaValue(db: DatabaseSync, key: string) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function parseExtra(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function threadUrl(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(
    /^(https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull|discussions)\/\d+)/,
  );
  return match?.[1] ?? null;
}

function githubUrls(text: string) {
  const matches =
    text.match(
      /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull|discussions)\/\d+(?:#[^\s)\]}>,"']+)?/g,
    ) ?? [];
  return matches.map((value) => value.replace(/[.,;:!?]+$/, ""));
}

function buildEdges(
  rows: ContributionRow[],
): PublicWorldGraph["edges"] {
  const publicRows = rows.filter((row) => visibilityOf(row.visibility) === "public");
  const byUrl = new Map(publicRows.map((row) => [row.url, row.id]));

  const roots = new Map<string, ContributionRow>();
  for (const row of [...publicRows].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )) {
    const key = threadUrl(row.url);
    if (key && !roots.has(key)) roots.set(key, row);
  }

  const edges = new Map<string, PublicWorldGraph["edges"][number]>();
  const add = (source: string, target: string, kind: "citation" | "comment-on") => {
    if (source === target) return;
    const key = `${kind}:\0${source}:\0${target}`;
    edges.set(key, { source, target, kind });
  };

  const groups = new Map<string, ContributionRow[]>();
  for (const row of publicRows) {
    const extra = parseExtra(row.extra_json);
    const parent =
      (typeof extra.parentUrl === "string" && extra.parentUrl) ||
      (typeof extra.prUrl === "string" && extra.prUrl) ||
      (typeof extra.discussionUrl === "string" && extra.discussionUrl) ||
      null;
    if (!parent) continue;
    const list = groups.get(parent) ?? [];
    list.push(row);
    groups.set(parent, list);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const root = group[0];
    if (!root) continue;
    for (const row of group.slice(1)) add(row.id, root.id, "comment-on");
  }

  for (const row of publicRows) {
    const text = `${row.title ?? ""}\n${row.excerpt ?? ""}`;
    for (const url of githubUrls(text)) {
      const exact = byUrl.get(url);
      if (exact) {
        add(row.id, exact, "citation");
        continue;
      }
      const root = roots.get(threadUrl(url) ?? "");
      if (root) add(row.id, root.id, "citation");
    }
  }

  return [...edges.values()].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target),
  );
}

export function compilePublicSnapshot(dbPath: string): CompiledPublicSnapshot {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT id, type, url, repo, number, title, excerpt, body_chars, state,
                visibility, created_at, updated_at, ingested_at, extra_json
         FROM contributions
         ORDER BY created_at DESC, id ASC`,
      )
      .all() as ContributionRow[];

    const flagRows = db
      .prepare(
        `SELECT contribution_id, code, severity, detail
         FROM flags
         ORDER BY contribution_id, code`,
      )
      .all() as FlagRow[];

    const flagsById = new Map<string, FlagRow[]>();
    for (const flag of flagRows) {
      const list = flagsById.get(flag.contribution_id) ?? [];
      list.push(flag);
      flagsById.set(flag.contribution_id, list);
    }

    const items: PublicArchiveItem[] = rows.map((row) => {
      const visibility = visibilityOf(row.visibility);
      if (visibility === "private") {
        return {
          id: row.id,
          type: row.type,
          visibility,
          created_at: row.created_at,
        };
      }
      return {
        id: row.id,
        type: row.type,
        visibility,
        url: row.url,
        repo: row.repo,
        number: row.number,
        title: row.title,
        excerpt: row.excerpt,
        body_chars: row.body_chars,
        state: row.state,
        created_at: row.created_at,
        updated_at: row.updated_at,
        flags: (flagsById.get(row.id) ?? []).map(({ code, severity, detail }) => ({
          code,
          severity,
          detail,
        })),
      };
    });

    const stats = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM contributions) AS total,
           (SELECT COUNT(*) FROM contributions WHERE visibility = 'public') AS public_n,
           (SELECT COUNT(*) FROM contributions WHERE visibility != 'public') AS private_n,
           (SELECT COUNT(*) FROM flags WHERE severity = 'bad') AS bad,
           (SELECT COUNT(*) FROM flags WHERE severity = 'warn') AS warn,
           (SELECT COUNT(*) FROM flags WHERE code = 'agent_marker') AS agent_marker,
           (SELECT COUNT(*) FROM flags WHERE code = 'agent_template') AS agent_template,
           (SELECT COUNT(*) FROM flags WHERE code = 'generic_ai_slop') AS generic_ai_slop,
           (SELECT COUNT(*) FROM flags WHERE code = 'empty_body') AS empty_body,
           (SELECT COUNT(*) FROM flags WHERE code = 'unfilled_template') AS unfilled_template,
           (SELECT COUNT(*) FROM flags WHERE code = 'machine_title') AS machine_title,
           (SELECT IFNULL(SUM(commit_count),0) FROM commit_buckets WHERE visibility = 'public') AS public_commits,
           (SELECT IFNULL(SUM(commit_count),0) FROM commit_buckets WHERE visibility != 'public') AS private_commits`,
      )
      .get() as Record<string, number>;

    const byType = db
      .prepare("SELECT type, COUNT(*) AS n FROM contributions GROUP BY type ORDER BY n DESC, type")
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
         FROM contributions
         WHERE visibility = 'public' AND repo IS NOT NULL
         GROUP BY repo ORDER BY n DESC, repo`,
      )
      .all() as { repo: string; n: number }[];
    const byFlag = db
      .prepare(
        `SELECT code, severity, COUNT(*) AS n
         FROM flags GROUP BY code, severity ORDER BY n DESC, code`,
      )
      .all() as { code: string; severity: string; n: number }[];
    const rawCommits = db
      .prepare(
        `SELECT year, repo, visibility, commit_count, html_url
         FROM commit_buckets ORDER BY year ASC, commit_count DESC, IFNULL(repo, '') ASC`,
      )
      .all() as CommitRow[];

    const commitBuckets = rawCommits.map((row) => {
      const visibility = visibilityOf(row.visibility);
      return {
        year: row.year,
        repo: visibility === "public" ? row.repo : null,
        visibility,
        commit_count: row.commit_count,
        html_url: visibility === "public" ? row.html_url : null,
      };
    });

    const repoCount = (
      db
        .prepare(
          "SELECT COUNT(DISTINCT repo) AS n FROM contributions WHERE visibility = 'public' AND repo IS NOT NULL",
        )
        .get() as { n: number }
    ).n;

    const lastCheckedAt = normalizeDate(
      (
        db.prepare("SELECT MAX(ingested_at) AS value FROM contributions").get() as {
          value: string | null;
        }
      ).value,
    );
    const lastChangedAt = normalizeDate(
      (
        db
          .prepare(
            "SELECT MAX(COALESCE(NULLIF(updated_at, ''), created_at)) AS value FROM contributions",
          )
          .get() as { value: string | null }
      ).value,
    );

    const archive: PublicArchive = {
      schemaVersion: PUBLIC_SNAPSHOT_SCHEMA,
      privacy: "public-safe",
      generatedAt: lastCheckedAt,
      stats,
      byType,
      byYear,
      byMonth,
      byRepo,
      byFlag,
      commitBuckets,
      repoCount,
      items,
    };

    const nodes: PublicWorldNode[] = rows.map((row) => {
      const visibility = visibilityOf(row.visibility);
      if (visibility === "private") {
        return {
          id: row.id,
          type: row.type,
          created: row.created_at,
          visibility,
        };
      }

      const node: PublicWorldNode = {
        id: row.id,
        type: row.type,
        created: row.created_at,
        visibility,
        url: row.url,
        flags: (flagsById.get(row.id) ?? []).map((flag) => flag.code),
      };
      if (row.repo) {
        node.repo = row.repo;
        node.org = row.repo.split("/", 1)[0];
      }
      if (row.number != null) node.number = row.number;
      if (row.title) node.title = row.title;
      return node;
    });

    const lights = db
      .prepare(
        `SELECT substr(created_at, 1, 7) AS month, visibility, COUNT(*) AS n
         FROM contributions
         GROUP BY month, visibility
         ORDER BY month, visibility`,
      )
      .all() as { month: string; visibility: string; n: number }[];

    const orgCounts = new Map<string, number>();
    for (const row of byRepo) {
      const org = row.repo.split("/", 1)[0];
      orgCounts.set(org, (orgCounts.get(org) ?? 0) + row.n);
    }
    const orgs = [...orgCounts]
      .map(([org, n]) => ({ org, n }))
      .sort((a, b) => b.n - a.n || a.org.localeCompare(b.org));

    const worldGraph: PublicWorldGraph = {
      login: metaValue(db, "login") ?? "kvnloo",
      privacy: "public-safe",
      nodes,
      edges: buildEdges(rows),
      lights: lights.map((row) => ({
        month: row.month,
        visibility: visibilityOf(row.visibility),
        n: row.n,
      })),
      commits: commitBuckets.map((row) => ({
        year: row.year,
        repo: row.repo,
        visibility: row.visibility,
        count: row.commit_count,
        url: row.html_url,
      })),
      orgs,
      repos: byRepo,
    };

    const manifest: PublicSnapshotManifest = {
      schemaVersion: PUBLIC_SNAPSHOT_SCHEMA,
      privacy: "public-safe",
      lastCheckedAt,
      lastChangedAt,
      counts: {
        events: stats.total ?? rows.length,
        publicEvents: stats.public_n ?? 0,
        privateEvents: stats.private_n ?? 0,
        commits: commitBuckets.reduce((sum, row) => sum + row.commit_count, 0),
        repos: repoCount,
        orgs: orgs.length,
      },
      hashes: {
        archiveSha256: hashJson(archive),
        worldGraphSha256: hashJson(worldGraph),
      },
    };

    return { manifest, archive, worldGraph };
  } finally {
    db.close();
  }
}

export function writePublicSnapshot(dbPath: string, outputRoot: string) {
  const snapshot = compilePublicSnapshot(dbPath);
  const dataDir = path.join(outputRoot, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const writeJson = (file: string, value: unknown) => {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  };

  writeJson(path.join(dataDir, "manifest.json"), snapshot.manifest);
  writeJson(path.join(dataDir, "archive.json"), snapshot.archive);
  writeJson(path.join(outputRoot, "world-graph.json"), snapshot.worldGraph);
  return snapshot;
}
