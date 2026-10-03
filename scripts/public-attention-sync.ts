import fs from "node:fs";
import path from "node:path";
import {
  classifyPullRequest,
  sortAttention,
  type AttentionActivity,
  type PullRequestSnapshot,
} from "../lib/attention.ts";

type Json = Record<string, any>;

const login = process.env.GITHUB_PUBLIC_LOGIN?.trim() || "kvnloo";
const deepLimit = Math.max(
  1,
  Math.min(24, Number(process.env.PUBLIC_ATTENTION_DEEP_LIMIT ?? "24") || 24),
);
const outputPath = path.join(process.cwd(), "data", "attention-seed.json");
const API = "https://api.github.com";

async function githubJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "gh-contrib-archive-public-attention/1",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(
      `GitHub public API ${response.status} for ${url} (remaining=${remaining ?? "unknown"})`,
    );
  }
  return response.json();
}

function repoFromApiUrl(value: unknown): string | null {
  const match = String(value ?? "").match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)$/);
  return match?.[1] ?? null;
}

function activity(
  actor: unknown,
  body: unknown,
  at: unknown,
  kind: "comment" | "review",
  reviewState?: unknown,
): AttentionActivity | null {
  const login = String((actor as Json | undefined)?.login ?? "");
  const timestamp = String(at ?? "");
  if (!login || !timestamp) return null;
  return {
    actor: login,
    body: String(body ?? ""),
    at: timestamp,
    kind,
    reviewState: reviewState == null ? null : String(reviewState),
  };
}

async function deepActivities(repo: string, number: number): Promise<AttentionActivity[]> {
  const [comments, reviews] = await Promise.all([
    githubJson(`${API}/repos/${repo}/issues/${number}/comments?per_page=100`) as Promise<Json[]>,
    githubJson(`${API}/repos/${repo}/pulls/${number}/reviews?per_page=100`) as Promise<Json[]>,
  ]);
  return [
    ...comments.map((item) =>
      activity(item.user, item.body, item.created_at, "comment"),
    ),
    ...reviews.map((item) =>
      activity(item.user, item.body, item.submitted_at, "review", item.state),
    ),
  ].filter(Boolean) as AttentionActivity[];
}

function snapshotFromSearch(
  item: Json,
  repo: string,
  activities: AttentionActivity[],
): PullRequestSnapshot {
  return {
    repo,
    repoVisibility: "public",
    number: Number(item.number),
    title: String(item.title ?? `${repo}#${item.number}`),
    url: String(item.html_url ?? `https://github.com/${repo}/pull/${item.number}`),
    state: String(item.state ?? "open").toUpperCase(),
    isDraft: Boolean(item.draft),
    author: String(item.user?.login ?? login),
    reviewDecision: null,
    mergeState: null,
    updatedAt: String(item.updated_at ?? new Date().toISOString()),
    notificationReasons: [],
    activities,
    checks: [],
  };
}

async function main() {
  const query = encodeURIComponent(`is:pr is:open author:${login}`);
  const search = (await githubJson(
    `${API}/search/issues?q=${query}&sort=updated&order=desc&per_page=100&page=1`,
  )) as Json;

  const items = Array.isArray(search.items) ? (search.items as Json[]) : [];
  const deepKeys = new Set(
    items
      .filter((item) => Number(item.comments ?? 0) > 0)
      .slice(0, deepLimit)
      .map((item) => String(item.id)),
  );

  const records = [];
  let deepInspected = 0;
  for (const item of items) {
    const repo = repoFromApiUrl(item.repository_url);
    if (!repo || !Number.isFinite(Number(item.number))) continue;

    let activities: AttentionActivity[] = [];
    if (deepKeys.has(String(item.id))) {
      try {
        activities = await deepActivities(repo, Number(item.number));
        deepInspected += 1;
      } catch (error) {
        console.warn(
          `attention deep inspection skipped for ${repo}#${item.number}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    records.push(classifyPullRequest(snapshotFromSearch(item, repo, activities), login));
  }

  const sorted = sortAttention(records);
  const output = {
    schemaVersion: 1,
    privacy: "public-safe",
    source: "github-public-rest-hotset",
    updatedAt: new Date().toISOString(),
    totalOpenReportedBySearch: Number(search.total_count ?? sorted.length),
    cachedOpen: sorted.length,
    deepInspected,
    deepLimit,
    items: sorted,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  const p0 = sorted.filter((item) => item.priority === "P0").length;
  const p1 = sorted.filter((item) => item.priority === "P1").length;
  console.log(
    `Refreshed public attention hotset: ${sorted.length} PRs, ${deepInspected} deep-inspected, ${p0} P0, ${p1} P1; GitHub reports ${output.totalOpenReportedBySearch} authored open PRs.`,
  );
}

main().catch((error) => {
  if (fs.existsSync(outputPath)) {
    console.warn(
      `Public attention refresh failed; keeping tracked fallback seed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 0;
  } else {
    throw error;
  }
});
