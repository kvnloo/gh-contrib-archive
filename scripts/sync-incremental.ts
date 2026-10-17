import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PUBLIC_DB_PATH, openDb } from "../lib/db.ts";
import { nextDay, pageIsOlderThan, searchDay, splitDay, watermarkFrom } from "../lib/incremental.ts";
import { replaceCommitYearIfChanged, upsertContribution } from "../lib/incremental-storage.ts";

const LOGIN = process.env.GH_LOGIN ?? "kvnloo";
const TOKEN = process.env.GH_ARCHIVE_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const DB_PATH = process.env.ARCHIVE_DB ?? PUBLIC_DB_PATH;

let contributionWrites = 0;
let commitBucketYearsChanged = 0;

function storageStats(db: DatabaseSync) {
  const pageCount = Number(
    (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count,
  );
  const pageSize = Number(
    (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size,
  );
  const freePages = Number(
    (db.prepare("PRAGMA freelist_count").get() as { freelist_count: number })
      .freelist_count,
  );
  return {
    bytes: fs.statSync(DB_PATH).size,
    pageCount,
    pageSize,
    freePages,
    logicalBytes: pageCount * pageSize,
  };
}

if (!TOKEN) {
  console.error("GH_ARCHIVE_TOKEN or GH_TOKEN is required");
  process.exit(1);
}

type Gql = { data?: Record<string, unknown>; errors?: { message: string }[] };

type Repo = { nameWithOwner: string; isPrivate?: boolean | null } | null;

function isPrivateRepo(repo: Repo) {
  return !repo || repo.isPrivate !== false;
}

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
    throw new Error(json.errors?.map((error) => error.message).join("; ") || `HTTP ${res.status}`);
  }
  return json;
}

async function searchIssues(db: DatabaseSync, query: string, type: "pull_request" | "issue") {
  let cursor: string | null = null;
  for (let page = 1; page <= 20; page += 1) {
    const json = await graphql<{
      data: {
        search: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            __typename: string;
            id: string;
            url: string;
            number: number;
            title: string;
            body: string;
            state: string;
            createdAt: string;
            updatedAt: string;
            repository: Repo;
          }[];
        };
      };
    }>(
      `query ($q: String!, $cursor: String) {
        search(type: ISSUE, query: $q, first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on PullRequest {
              id url number title body state createdAt updatedAt
              repository { nameWithOwner isPrivate }
            }
            ... on Issue {
              id url number title body state createdAt updatedAt
              repository { nameWithOwner isPrivate }
            }
          }
        }
      }`,
      { q: query, cursor },
    );
    const conn = json.data.search;
    let written = 0;
    for (const node of conn.nodes) {
      if (!node?.id) continue;
      if (type === "pull_request" && node.__typename !== "PullRequest") continue;
      if (type === "issue" && node.__typename !== "Issue") continue;
      contributionWrites += Number(upsertContribution(db, {
        id: node.id,
        type,
        url: node.url,
        repo: node.repository?.nameWithOwner,
        number: node.number,
        title: node.title,
        body: node.body,
        state: node.state,
        created_at: node.createdAt,
        updated_at: node.updatedAt,
        isPrivate: isPrivateRepo(node.repository),
      }));
      written += 1;
    }
    console.log(`${type} search page ${page}: ${written}`);
    if (!conn.pageInfo.hasNextPage) return;
    if (page === 20) throw new Error(`${type} search still has pages after the incremental cap`);
    cursor = conn.pageInfo.endCursor;
  }
}

async function searchCount(query: string) {
  const json = await graphql<{ data: { search: { issueCount: number } } }>(
    `query ($q: String!) { search(type: ISSUE, query: $q, first: 1) { issueCount } }`,
    { q: query },
  );
  return json.data.search.issueCount;
}

async function searchIssuesWindow(
  db: DatabaseSync,
  type: "pull_request" | "issue",
  fromDay: string,
  toDay: string,
) {
  const kind = type === "pull_request" ? "is:pr" : "is:issue";
  const query = `author:${LOGIN} ${kind} updated:${fromDay}..${toDay}`;
  const count = await searchCount(query);
  console.log(`${type} ${fromDay}..${toDay}: ${count}`);
  if (count > 800) {
    const mid = splitDay(fromDay, toDay);
    if (!mid) throw new Error(`${query} has ${count} results and cannot be split under the search cap`);
    await searchIssuesWindow(db, type, fromDay, mid);
    await searchIssuesWindow(db, type, nextDay(mid), toDay);
    return;
  }
  if (count === 0) return;
  await searchIssues(db, query, type);
}

async function ingestCommentsSince(db: DatabaseSync, watermark: string) {
  let cursor: string | null = null;
  for (let page = 1; page <= 80; page += 1) {
    const json = await graphql<{
      data: {
        user: {
          issueComments: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              id: string;
              url: string;
              createdAt: string;
              updatedAt: string;
              body: string;
              repository: Repo;
              issue: { number?: number; title?: string; url?: string } | null;
            }[];
          };
        };
      };
    }>(
      `query ($login: String!, $cursor: String) {
        user(login: $login) {
          issueComments(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id url createdAt updatedAt body
              repository { nameWithOwner isPrivate }
              issue { number title url }
            }
          }
        }
      }`,
      { login: LOGIN, cursor },
    );
    const conn = json.data.user.issueComments;
    for (const node of conn.nodes) {
      if (pageIsOlderThan([node.updatedAt], watermark)) continue;
      contributionWrites += Number(upsertContribution(db, {
        id: node.id,
        type: "comment",
        url: node.url,
        repo: node.repository?.nameWithOwner,
        number: node.issue?.number ?? null,
        title: node.issue?.title ?? null,
        body: node.body,
        created_at: node.createdAt,
        updated_at: node.updatedAt,
        extra: { parentUrl: node.issue?.url },
        isPrivate: isPrivateRepo(node.repository),
      }));
    }
    const oldest = conn.nodes.at(-1)?.updatedAt ?? "none";
    console.log(`comments page ${page}: ${conn.nodes.length} oldest ${oldest}`);
    if (pageIsOlderThan(conn.nodes.map((node) => node.updatedAt), watermark)) return;
    if (!conn.pageInfo.hasNextPage) return;
    if (page === 80) throw new Error("comment walk still newer than the high-water mark after the cap");
    cursor = conn.pageInfo.endCursor;
  }
}

async function ingestReviewsSince(db: DatabaseSync, day: string) {
  let cursor: string | null = null;
  for (let page = 1; page <= 20; page += 1) {
    const json = await graphql<{
      data: {
        search: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            __typename: string;
            url?: string;
            number?: number;
            title?: string;
            repository?: Repo;
            reviews?: {
              nodes: {
                id: string;
                url: string;
                body: string;
                state: string;
                submittedAt: string | null;
                author: { login: string } | null;
                comments: {
                  nodes: {
                    id: string;
                    url: string;
                    body: string;
                    createdAt: string;
                    author: { login: string } | null;
                  }[];
                };
              }[];
            };
          }[];
        };
      };
    }>(
      `query ($q: String!, $cursor: String) {
        search(type: ISSUE, query: $q, first: 20, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on PullRequest {
              url number title
              repository { nameWithOwner isPrivate }
              reviews(first: 20) {
                nodes {
                  id url body state submittedAt
                  author { login }
                  comments(first: 20) {
                    nodes { id url body createdAt author { login } }
                  }
                }
              }
            }
          }
        }
      }`,
      { q: `reviewed-by:${LOGIN} updated:>=${day}`, cursor },
    );
    const conn = json.data.search;
    for (const pr of conn.nodes) {
      if (pr.__typename !== "PullRequest" || !pr.reviews) continue;
      const hidden = isPrivateRepo(pr.repository ?? null);
      for (const review of pr.reviews.nodes) {
        if (review.author?.login !== LOGIN) continue;
        if (review.body?.trim()) {
          contributionWrites += Number(upsertContribution(db, {
            id: review.id,
            type: "review",
            url: review.url,
            repo: pr.repository?.nameWithOwner,
            number: pr.number,
            title: pr.title,
            body: review.body,
            state: review.state,
            created_at: review.submittedAt ?? new Date().toISOString(),
            extra: { prUrl: pr.url },
            isPrivate: hidden,
          }));
        }
        for (const comment of review.comments.nodes) {
          if (comment.author?.login !== LOGIN) continue;
          contributionWrites += Number(upsertContribution(db, {
            id: comment.id,
            type: "review_comment",
            url: comment.url,
            repo: pr.repository?.nameWithOwner,
            number: pr.number,
            title: pr.title,
            body: comment.body,
            created_at: comment.createdAt,
            extra: { prUrl: pr.url, reviewUrl: review.url },
            isPrivate: hidden,
          }));
        }
      }
    }
    console.log(`reviews page ${page}: ${conn.nodes.length} PRs`);
    if (!conn.pageInfo.hasNextPage) return;
    if (page === 20) throw new Error("review search still has pages after the incremental cap");
    cursor = conn.pageInfo.endCursor;
  }
}

async function refreshCommitYear(db: DatabaseSync, year: number) {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const json = await graphql<{
    data: {
      user: {
        contributionsCollection: {
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
          commitContributionsByRepository(maxRepositories: 100) {
            repository { nameWithOwner isPrivate }
            contributions { totalCount }
          }
        }
      }
    }`,
    { login: LOGIN, from, to },
  );
  const rows = json.data.user.contributionsCollection.commitContributionsByRepository;
  let privateCommits = 0;
  const publicRows: { repo: string; count: number }[] = [];
  for (const row of rows) {
    const repo = row.repository;
    if (!repo || repo.isPrivate) {
      privateCommits += row.contributions.totalCount;
      continue;
    }
    publicRows.push({ repo: repo.nameWithOwner, count: row.contributions.totalCount });
  }
  const changed = replaceCommitYearIfChanged(
    db,
    year,
    publicRows,
    privateCommits,
    LOGIN,
  );
  if (changed) commitBucketYearsChanged += 1;
  console.log(
    `commits ${year}: ${publicRows.length} public repos, private count ${privateCommits}, changed=${changed}`,
  );
}

async function main() {
  const db = openDb(DB_PATH);
  const storageBefore = storageStats(db);
  const before = db.prepare("SELECT COUNT(*) AS n FROM contributions").get() as { n: number };
  if (before.n < 1) throw new Error("public.db is empty; refusing a full historical ingest");
  const mark = db
    .prepare("SELECT MAX(COALESCE(updated_at, created_at)) AS mark FROM contributions")
    .get() as { mark: string | null };
  const watermark = watermarkFrom(mark.mark);
  const day = searchDay(watermark);
  console.log(`incremental since ${watermark} (${before.n} existing rows)`);

  await searchIssuesWindow(db, "pull_request", day, nextDay(new Date().toISOString().slice(0, 10)));
  await searchIssuesWindow(db, "issue", day, nextDay(new Date().toISOString().slice(0, 10)));
  await ingestCommentsSince(db, watermark);
  await ingestReviewsSince(db, day);

  const startYear = Number(day.slice(0, 4));
  const endYear = new Date().getUTCFullYear();
  for (let year = startYear; year <= endYear; year += 1) {
    await refreshCommitYear(db, year);
  }

  const after = db.prepare("SELECT COUNT(*) AS n FROM contributions").get() as { n: number };
  if (after.n < before.n) {
    throw new Error(`refusing to shrink public.db ${before.n} -> ${after.n}`);
  }
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run("privacy", "public-safe");
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run("incremental_from", watermark);
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run("finished_at", new Date().toISOString());
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const storageAfter = storageStats(db);
  console.log(`public.db ${before.n} -> ${after.n}`);
  console.log(
    JSON.stringify({
      storage: {
        before: storageBefore,
        after: storageAfter,
        deltaBytes: storageAfter.bytes - storageBefore.bytes,
        contributionWrites,
        commitBucketYearsChanged,
      },
    }),
  );
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
