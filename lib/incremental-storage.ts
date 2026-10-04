import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { excerptOf, flagContribution } from "./sanity.ts";

export type IncrementalItem = {
  id: string;
  type: string;
  url: string;
  repo?: string | null;
  number?: number | null;
  title?: string | null;
  body?: string | null;
  state?: string | null;
  created_at: string;
  updated_at?: string | null;
  extra?: unknown;
  isPrivate: boolean;
};

export type PublicCommitRow = {
  repo: string;
  count: number;
};

function changed(result: { changes: number | bigint }) {
  return Number(result.changes) > 0;
}

function opaquePrivateId(githubId: string) {
  const opaque = createHash("sha256").update(githubId).digest("hex").slice(0, 20);
  return { id: `private:${opaque}`, url: `redacted://private/${opaque}` };
}

/**
 * Upsert one contribution without touching SQLite pages when the projected
 * public-safe payload is unchanged. `ingested_at` advances only with a
 * semantic row change; successful collector freshness is tracked separately
 * through `meta.finished_at`.
 */
export function upsertContribution(db: DatabaseSync, row: IncrementalItem) {
  if (row.isPrivate) {
    const opaque = opaquePrivateId(row.id);
    return changed(
      db.prepare(
        `INSERT INTO contributions (
          id, github_node_id, type, url, html_url, repo, number, title, excerpt,
          body_chars, state, visibility, created_at, updated_at, ingested_at, extra_json
        ) VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, 'private', ?, NULL, datetime('now'), NULL)
        ON CONFLICT(id) DO UPDATE SET
          type=excluded.type,
          url=excluded.url,
          html_url=excluded.html_url,
          created_at=excluded.created_at,
          ingested_at=datetime('now')
        WHERE contributions.type IS NOT excluded.type
           OR contributions.url IS NOT excluded.url
           OR contributions.html_url IS NOT excluded.html_url
           OR contributions.created_at IS NOT excluded.created_at`,
      ).run(opaque.id, row.type, opaque.url, opaque.url, row.created_at),
    );
  }

  const excerpt = excerptOf(row.body);
  const extraJson = row.extra ? JSON.stringify(row.extra) : null;
  const didChange = changed(
    db.prepare(
      `INSERT INTO contributions (
        id, github_node_id, type, url, html_url, repo, number, title, excerpt,
        body_chars, state, visibility, created_at, updated_at, ingested_at, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, datetime('now'), ?)
      ON CONFLICT(id) DO UPDATE SET
        github_node_id=excluded.github_node_id,
        type=excluded.type,
        url=excluded.url,
        html_url=excluded.html_url,
        repo=excluded.repo,
        number=excluded.number,
        title=excluded.title,
        excerpt=excluded.excerpt,
        body_chars=excluded.body_chars,
        state=excluded.state,
        visibility='public',
        created_at=excluded.created_at,
        updated_at=excluded.updated_at,
        ingested_at=datetime('now'),
        extra_json=excluded.extra_json
      WHERE contributions.github_node_id IS NOT excluded.github_node_id
         OR contributions.type IS NOT excluded.type
         OR contributions.url IS NOT excluded.url
         OR contributions.html_url IS NOT excluded.html_url
         OR contributions.repo IS NOT excluded.repo
         OR contributions.number IS NOT excluded.number
         OR contributions.title IS NOT excluded.title
         OR contributions.excerpt IS NOT excluded.excerpt
         OR contributions.body_chars IS NOT excluded.body_chars
         OR contributions.state IS NOT excluded.state
         OR contributions.visibility IS NOT 'public'
         OR contributions.created_at IS NOT excluded.created_at
         OR contributions.updated_at IS NOT excluded.updated_at
         OR contributions.extra_json IS NOT excluded.extra_json`,
    ).run(
      row.id,
      row.id,
      row.type,
      row.url,
      row.url,
      row.repo ?? null,
      row.number ?? null,
      row.title ?? null,
      excerpt,
      (row.body ?? "").length,
      row.state ?? null,
      row.created_at,
      row.updated_at ?? null,
      extraJson,
    ),
  );

  if (!didChange) return false;

  db.prepare("DELETE FROM flags WHERE contribution_id = ?").run(row.id);
  const insertFlag = db.prepare(
    "INSERT OR IGNORE INTO flags (contribution_id, code, severity, detail) VALUES (?, ?, ?, ?)",
  );
  for (const flag of flagContribution({
    type: row.type,
    title: row.title,
    body: row.body,
  })) {
    insertFlag.run(row.id, flag.code, flag.severity, flag.detail);
  }
  return true;
}

function desiredCommitRows(
  year: number,
  publicRows: readonly PublicCommitRow[],
  privateCommits: number,
) {
  const rows = publicRows
    .map((row) => ({
      id: `${year}:${row.repo}`,
      year,
      repo: row.repo,
      visibility: "public",
      commit_count: row.count,
      html_url: `https://github.com/${row.repo}/commits?author=kvnloo`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (privateCommits > 0) {
    rows.push({
      id: `private:${year}`,
      year,
      repo: null,
      visibility: "private",
      commit_count: privateCommits,
      html_url: null,
    });
  }
  return rows;
}

/**
 * Replace a yearly commit-bucket projection only when its semantic rows differ.
 * This avoids delete/reinsert churn on every overlapping incremental scan.
 */
export function replaceCommitYearIfChanged(
  db: DatabaseSync,
  year: number,
  publicRows: readonly PublicCommitRow[],
  privateCommits: number,
) {
  const desired = desiredCommitRows(year, publicRows, privateCommits);
  const current = db
    .prepare(
      `SELECT id, year, repo, visibility, commit_count, html_url
       FROM commit_buckets
       WHERE year = ?
       ORDER BY id`,
    )
    .all(year);

  if (JSON.stringify(current) === JSON.stringify(desired)) return false;

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM commit_buckets WHERE year = ?").run(year);
    const insert = db.prepare(
      `INSERT INTO commit_buckets (id, year, repo, visibility, commit_count, html_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const row of desired) {
      insert.run(
        row.id,
        row.year,
        row.repo,
        row.visibility,
        row.commit_count,
        row.html_url,
      );
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
