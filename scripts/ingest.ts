import { DatabaseSync } from "node:sqlite";
import { excerptOf, flagContribution, flagDuplicates } from "../lib/sanity";
import { openDb } from "../lib/db";

const LOGIN = process.env.GH_LOGIN ?? "kvnloo";
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GH_TOKEN is required");
  process.exit(1);
}

type Gql = {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
};

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

function upsert(
  db: DatabaseSync,
  row: {
    id: string;
    github_node_id?: string | null;
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
  },
) {
  const excerpt = excerptOf(row.body);
  db.prepare(
    `INSERT INTO contributions (
      id, github_node_id, type, url, html_url, repo, number, title, excerpt,
      body_chars, state, created_at, updated_at, ingested_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      excerpt=excluded.excerpt,
      body_chars=excluded.body_chars,
      state=excluded.state,
      updated_at=excluded.updated_at,
      ingested_at=datetime('now'),
      extra_json=excluded.extra_json`,
  ).run(
    row.id,
    row.github_node_id ?? null,
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
    row.extra ? JSON.stringify(row.extra) : null,
  );

  db.prepare("DELETE FROM flags WHERE contribution_id = ?").run(row.id);
  for (const flag of flagContribution({ type: row.type, title: row.title, body: row.body })) {
    db.prepare(
      "INSERT OR IGNORE INTO flags (contribution_id, code, severity, detail) VALUES (?, ?, ?, ?)",
    ).run(row.id, flag.code, flag.severity, flag.detail);
  }
}

async function paginateUserConnection(
  db: DatabaseSync,
  field: string,
  inner: string,
  map: (node: Record<string, unknown>) => Parameters<typeof upsert>[1],
) {
  let cursor: string | null = null;
  let page = 0;
  for (;;) {
    const query = `
      query ($login: String!, $cursor: String) {
        user(login: $login) {
          ${field}(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}${
            field === "issues"
              ? ", states: [OPEN, CLOSED]"
              : field === "pullRequests"
                ? ", states: [OPEN, CLOSED, MERGED]"
                : ""
          }) {
            pageInfo { hasNextPage endCursor }
            nodes { ${inner} }
          }
        }
      }`;
    const json = await graphql<{
      data: {
        user: {
          [k: string]: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Record<string, unknown>[];
          };
        };
      };
    }>(query, { login: LOGIN, cursor });
    const conn = json.data.user[field];
    page += 1;
    for (const node of conn.nodes) {
      upsert(db, map(node));
    }
    console.log(`${field} page ${page}: +${conn.nodes.length} (newest-first)`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
}

async function ingestIssueComments(db: DatabaseSync) {
  let cursor: string | null = null;
  let page = 0;
  for (;;) {
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
              repository: { nameWithOwner: string } | null;
              issue: {
                number?: number;
                title?: string;
                url?: string;
              } | null;
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
              repository { nameWithOwner }
              issue { number title url }
            }
          }
        }
      }`,
      { login: LOGIN, cursor },
    );
    const conn = json.data.user.issueComments;
    page += 1;
    for (const node of conn.nodes) {
      upsert(db, {
        id: node.id,
        github_node_id: node.id,
        type: "comment",
        url: node.url,
        repo: node.repository?.nameWithOwner,
        number: node.issue?.number ?? null,
        title: node.issue?.title ?? null,
        body: node.body,
        created_at: node.createdAt,
        updated_at: node.updatedAt,
        extra: { parentUrl: node.issue?.url },
      });
    }
    console.log(`issueComments page ${page}: +${conn.nodes.length}`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
}

async function ingestDiscussions(db: DatabaseSync) {
  let cursor: string | null = null;
  for (;;) {
    const json = await graphql<{
      data: {
        user: {
          repositoryDiscussions: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              id: string;
              url: string;
              title: string;
              body: string;
              createdAt: string;
              updatedAt: string;
              number: number;
              repository: { nameWithOwner: string };
            }[];
          };
        };
      };
    }>(
      `query ($login: String!, $cursor: String) {
        user(login: $login) {
          repositoryDiscussions(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id url title body createdAt updatedAt number
              repository { nameWithOwner }
            }
          }
        }
      }`,
      { login: LOGIN, cursor },
    );
    const conn = json.data.user.repositoryDiscussions;
    for (const node of conn.nodes) {
      upsert(db, {
        id: node.id,
        github_node_id: node.id,
        type: "discussion",
        url: node.url,
        repo: node.repository.nameWithOwner,
        number: node.number,
        title: node.title,
        body: node.body,
        created_at: node.createdAt,
        updated_at: node.updatedAt,
      });
    }
    console.log(`discussions: +${conn.nodes.length}`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  cursor = null;
  for (;;) {
    const json = await graphql<{
      data: {
        user: {
          repositoryDiscussionComments: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              id: string;
              url: string;
              body: string;
              createdAt: string;
              updatedAt: string;
              discussion: { title: string; url: string; number: number; repository: { nameWithOwner: string } };
            }[];
          };
        };
      };
    }>(
      `query ($login: String!, $cursor: String) {
        user(login: $login) {
          repositoryDiscussionComments(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id url body createdAt updatedAt
              discussion {
                title url number
                repository { nameWithOwner }
              }
            }
          }
        }
      }`,
      { login: LOGIN, cursor },
    );
    const conn = json.data.user.repositoryDiscussionComments;
    for (const node of conn.nodes) {
      upsert(db, {
        id: node.id,
        github_node_id: node.id,
        type: "discussion_comment",
        url: node.url,
        repo: node.discussion.repository.nameWithOwner,
        number: node.discussion.number,
        title: node.discussion.title,
        body: node.body,
        created_at: node.createdAt,
        updated_at: node.updatedAt,
        extra: { parentUrl: node.discussion.url },
      });
    }
    console.log(`discussionComments: +${conn.nodes.length}`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
}

async function ingestReviews(db: DatabaseSync) {
  let cursor: string | null = null;
  for (;;) {
    const json = await graphql<{
      data: {
        search: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            __typename: string;
            url?: string;
            number?: number;
            title?: string;
            repository?: { nameWithOwner: string };
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
        search(type: ISSUE, query: $q, first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on PullRequest {
              url number title
              repository { nameWithOwner }
              reviews(first: 40) {
                nodes {
                  id url body state submittedAt
                  author { login }
                  comments(first: 50) {
                    nodes { id url body createdAt author { login } }
                  }
                }
              }
            }
          }
        }
      }`,
      { q: `reviewed-by:${LOGIN}`, cursor },
    );
    const conn = json.data.search;
    for (const pr of conn.nodes) {
      if (pr.__typename !== "PullRequest" || !pr.reviews) continue;
      for (const review of pr.reviews.nodes) {
        if (review.author?.login !== LOGIN) continue;
        if (review.body?.trim()) {
          upsert(db, {
            id: review.id,
            github_node_id: review.id,
            type: "review",
            url: review.url,
            repo: pr.repository?.nameWithOwner,
            number: pr.number,
            title: pr.title,
            body: review.body,
            state: review.state,
            created_at: review.submittedAt ?? new Date().toISOString(),
            extra: { prUrl: pr.url },
          });
        }
        for (const comment of review.comments.nodes) {
          if (comment.author?.login !== LOGIN) continue;
          upsert(db, {
            id: comment.id,
            github_node_id: comment.id,
            type: "review_comment",
            url: comment.url,
            repo: pr.repository?.nameWithOwner,
            number: pr.number,
            title: pr.title,
            body: comment.body,
            created_at: comment.createdAt,
            extra: { prUrl: pr.url, reviewUrl: review.url },
          });
        }
      }
    }
    console.log(`reviews search page: +${conn.nodes.length} PRs`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
}

function recomputeDuplicates(db: DatabaseSync) {
  const rows = db
    .prepare("SELECT id, excerpt FROM contributions")
    .all() as { id: string; excerpt: string }[];
  const dupes = flagDuplicates(rows);
  for (const [id, flag] of dupes) {
    db.prepare(
      "INSERT OR IGNORE INTO flags (contribution_id, code, severity, detail) VALUES (?, ?, ?, ?)",
    ).run(id, flag.code, flag.severity, flag.detail);
  }
  console.log(`duplicate clusters flagged: ${dupes.size}`);
}

function printSanity(db: DatabaseSync) {
  const totals = db
    .prepare("SELECT type, COUNT(*) AS n FROM contributions GROUP BY type ORDER BY n DESC")
    .all() as { type: string; n: number }[];
  console.log("\n=== inventory ===");
  for (const row of totals) console.log(`  ${row.type}: ${row.n}`);

  const flags = db
    .prepare(
      `SELECT severity, code, COUNT(*) AS n
       FROM flags GROUP BY severity, code ORDER BY severity, n DESC`,
    )
    .all() as { severity: string; code: string; n: number }[];
  console.log("\n=== flags ===");
  for (const row of flags) console.log(`  ${row.severity} ${row.code}: ${row.n}`);

  const worst = db
    .prepare(
      `SELECT c.type, c.url, c.repo, c.title, f.code, f.severity
       FROM flags f JOIN contributions c ON c.id = f.contribution_id
       WHERE f.severity = 'bad'
       ORDER BY c.created_at DESC LIMIT 20`,
    )
    .all() as { type: string; url: string; repo: string; title: string; code: string }[];
  console.log("\n=== recent bad ===");
  for (const row of worst) console.log(`  [${row.code}] ${row.url} (${row.repo})`);
}

async function main() {
  const db = openDb();
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run("login", LOGIN);
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(
    "started_at",
    new Date().toISOString(),
  );

  console.log(`Ingesting @${LOGIN} newest-first…`);

  await paginateUserConnection(
    db,
    "pullRequests",
    `id url number title body state createdAt updatedAt repository { nameWithOwner }`,
    (n) => ({
      id: n.id as string,
      github_node_id: n.id as string,
      type: "pull_request",
      url: n.url as string,
      repo: (n.repository as { nameWithOwner: string } | null)?.nameWithOwner,
      number: n.number as number,
      title: n.title as string,
      body: n.body as string,
      state: n.state as string,
      created_at: n.createdAt as string,
      updated_at: n.updatedAt as string,
    }),
  );

  await paginateUserConnection(
    db,
    "issues",
    `id url number title body state createdAt updatedAt repository { nameWithOwner }`,
    (n) => ({
      id: n.id as string,
      github_node_id: n.id as string,
      type: "issue",
      url: n.url as string,
      repo: (n.repository as { nameWithOwner: string } | null)?.nameWithOwner,
      number: n.number as number,
      title: n.title as string,
      body: n.body as string,
      state: n.state as string,
      created_at: n.createdAt as string,
      updated_at: n.updatedAt as string,
    }),
  );

  await ingestIssueComments(db);
  await ingestDiscussions(db);
  await ingestReviews(db);
  recomputeDuplicates(db);

  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(
    "finished_at",
    new Date().toISOString(),
  );
  const count = db.prepare("SELECT COUNT(*) AS n FROM contributions").get() as { n: number };
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run("total", String(count.n));
  printSanity(db);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
