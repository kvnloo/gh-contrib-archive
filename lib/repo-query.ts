import type { DatabaseSync } from "node:sqlite";

export type ContributionCaveat = { code: string; detail: string };
export type RepoContributionCounts = {
  pull_requests: {
    total: number; merged: number; open: number; closed_unmerged: number;
    state_unknown: number; landed_elsewhere: number | null; closed_unmerged_landing_unknown: number;
  };
  issues: number;
  issue_comments: number;
  pull_request_comments: number;
  comments_parent_unknown: number;
  review_bodies: number;
  review_comments: number;
  discussions: number;
  discussion_comments: number;
  other_activity: number;
  github_commit_contributions: number | null;
};

export function validateRepo(repo: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || [".", ".."].includes(repo.split("/")[1])) {
    throw new Error("Repository must have the form owner/name (not a URL).");
  }
  return repo;
}

export function queryRepo(db: DatabaseSync, repo: string, publicOnly = false) {
  validateRepo(repo);
  const publicFilter = publicOnly ? " AND visibility = 'public'" : "";
  const rows = db.prepare(`SELECT type, state, url FROM contributions WHERE repo = ? COLLATE NOCASE${publicFilter}`)
    .all(repo) as { type: string; state: string | null; url: string }[];
  const count = (type: string) => rows.filter((row) => row.type === type).length;
  const prs = rows.filter((row) => row.type === "pull_request");
  const stateCount = (state: string) => prs.filter((row) => row.state?.toUpperCase() === state).length;
  const comments = rows.filter((row) => row.type === "comment");
  const parentCount = (kind: "issues" | "pull") => comments.filter((row) => {
    try {
      const url = new URL(row.url);
      return url.hostname === "github.com" && new RegExp(`^/[^/]+/[^/]+/${kind}/[0-9]+/?$`).test(url.pathname);
    } catch { return false; }
  }).length;
  const buckets = db.prepare(`SELECT year, commit_count FROM commit_buckets WHERE repo = ? COLLATE NOCASE${publicFilter} ORDER BY year`)
    .all(repo) as { year: number; commit_count: number }[];
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[])
    .map(({ key, value }) => [key, value]));
  const archiveFlags = db.prepare(`SELECT f.code, f.severity, COUNT(*) AS count
    FROM flags f JOIN contributions c ON c.id = f.contribution_id
    WHERE c.repo = ? COLLATE NOCASE${publicOnly ? " AND c.visibility = 'public'" : ""} GROUP BY f.code, f.severity ORDER BY f.code, f.severity`)
    .all(repo) as { code: string; severity: string; count: number }[];
  const updated = db.prepare(`SELECT MAX(COALESCE(updated_at, created_at)) AS source_updated_at,
    MAX(ingested_at) AS collected_at FROM contributions WHERE repo = ? COLLATE NOCASE${publicFilter}`).get(repo) as {
    source_updated_at: string | null; collected_at: string | null;
  };
  const redacted = db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE repo IS NULL").get() as { n: number };
  const redactedBuckets = db.prepare("SELECT COUNT(*) AS n FROM commit_buckets WHERE repo IS NULL").get() as { n: number };
  const closed = stateCount("CLOSED");
  const knownTypes = new Set(["pull_request", "issue", "comment", "review", "review_comment", "discussion", "discussion_comment"]);
  const caveats: ContributionCaveat[] = [
    { code: "SNAPSHOT_NOT_LIFETIME_TOTAL", detail: "Counts describe stored rows, not verified complete or current GitHub history; zero does not prove no work." },
    { code: "CATEGORIES_OVERLAP", detail: "Do not sum activity and commit counts: a PR, its comments and its commits may describe the same work." },
    { code: "COMMIT_BUCKETS_NOT_COMMITS", detail: "Commit counts are GitHub contribution-graph yearly aggregates, not unique SHAs; squash, coauthors, forks, branches and email attribution can change credit. Initial ingest covers 2016-2026 and at most 100 repos per year; incremental refresh updates recent years only." },
    { code: "COMMENT_COVERAGE_PARTIAL", detail: "Issue/PR conversation comments, inline review comments and nonempty review bodies are distinct. Empty reviews are absent. Review search has a 1000-result cap and unpaginated nested limits (20/40 reviews, 50 comments)." },
    { code: "EDITS_AND_DELETIONS", detail: "Upserts retain latest observed excerpts, not edit histories; deleted or inaccessible items can remain, and deleted-before-ingest items cannot be recovered." },
    { code: "IDENTITY_NOT_HUMAN_EFFORT", detail: "Rows attributed to the account may be bot/agent-authored; existing machine-title or duplicate flags are heuristics, not proof. No effort weighting or automatic exclusions are applied." },
    { code: "ACCOUNT_SCOPE_ASSUMED", detail: "Contribution rows have no per-row subject identity. A database reused with different GH_LOGIN values may mix accounts; login metadata alone cannot prove attribution." },
    { code: "REPO_IDENTITY_NOT_NORMALIZED", detail: "Exact owner/name scope (case-insensitive); fork/upstream, renames, transfers and salvaged patches are not combined or deduplicated." },
    { code: "DISCUSSION_REFRESH_PARTIAL", detail: "Full ingest collects discussions; incremental sync does not refresh discussions or discussion comments." },
  ];
  if (closed) caveats.push({ code: "SALVAGE_UNKNOWN", detail: "Closed-unmerged PR landing is unknown: current ingest stores no PR commit SHAs, diffs or stable patch-ids and no exhaustive merged-PR index. No title/body match is treated as landing evidence." });
  if (redacted.n || redactedBuckets.n) caveats.push({ code: "REDACTED_REPOS_UNATTRIBUTABLE", detail: "Anonymous private/unknown rows and private yearly commit totals cannot be assigned to a named repository." });
  if (!buckets.length) caveats.push({ code: "COMMIT_COVERAGE_UNKNOWN", detail: "No per-repo commit buckets are stored; null means unknown, not zero." });
  if (!rows.length && !buckets.length) caveats.push({ code: "NO_MATCHING_DATA", detail: "No stored rows or commit buckets match this repository; absence is not a verified zero." });
  return {
    schema_version: 1,
    repo,
    login: meta.login ?? null,
    freshness: { ...updated, archive_finished_at: meta.finished_at ?? null },
    activity_rows: rows.length,
    counts: {
      pull_requests: {
        total: prs.length,
        merged: stateCount("MERGED"),
        open: stateCount("OPEN"),
        closed_unmerged: closed,
        state_unknown: prs.length - stateCount("MERGED") - stateCount("OPEN") - closed,
        landed_elsewhere: closed ? null : 0,
        closed_unmerged_landing_unknown: closed,
      },
      issues: count("issue"),
      issue_comments: parentCount("issues"),
      pull_request_comments: parentCount("pull"),
      comments_parent_unknown: comments.length - parentCount("issues") - parentCount("pull"),
      review_bodies: count("review"),
      review_comments: count("review_comment"),
      discussions: count("discussion"),
      discussion_comments: count("discussion_comment"),
      other_activity: rows.filter((row) => !knownTypes.has(row.type)).length,
      github_commit_contributions: buckets.length ? buckets.reduce((sum, row) => sum + row.commit_count, 0) : null,
    },
    commit_years: [...new Set(buckets.map((row) => row.year))],
    archive_flags: archiveFlags.map((row) => ({ ...row })),
    caveats,
  };
}
