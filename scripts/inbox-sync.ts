import { spawnSync } from "node:child_process";
import {
  classifyPullRequest,
  sortAttention,
  type AttentionActivity,
  type AttentionCheck,
  type PullRequestSnapshot,
} from "../lib/attention.ts";
import { openAttentionDb, replaceAttentionRecords } from "../lib/attention-db.ts";

type Json = Record<string, any>;

function ghJson(args: string[]): any {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error("GitHub CLI (`gh`) is required. Install it and run `gh auth login` first.");
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "GitHub CLI command failed").trim();
    throw new Error(detail);
  }
  return JSON.parse(result.stdout || "null");
}

function notificationPages(): Json[] {
  try {
    const pages = ghJson([
      "api",
      "--paginate",
      "--slurp",
      "notifications?all=true&participating=true&per_page=100",
    ]) as Json[][];
    return pages.flat();
  } catch (error) {
    throw new Error(
      "Unable to read GitHub notifications. Run `gh auth refresh --hostname github.com --scopes notifications`, then retry. " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

function authoredOpenPulls(login: string): Array<{ repo: string; number: number }> {
  const query = encodeURIComponent(`is:pr is:open author:${login}`);
  const pages = ghJson([
    "api",
    "--paginate",
    "--slurp",
    `search/issues?q=${query}&per_page=100`,
  ]) as Array<{ items?: Json[] }>;

  return pages.flatMap((page) => page.items ?? []).flatMap((item) => {
    const match = String(item.repository_url ?? "").match(/\/repos\/([^/]+\/[^/]+)$/);
    return match ? [{ repo: match[1], number: Number(item.number) }] : [];
  });
}

function notificationPulls(notifications: Json[]) {
  const refs = new Map<string, { repo: string; number: number; reasons: string[] }>();
  for (const notification of notifications) {
    if (notification.subject?.type !== "PullRequest") continue;
    const repo = String(notification.repository?.full_name ?? "");
    const match = String(notification.subject?.url ?? "").match(/\/pulls\/(\d+)$/);
    if (!repo || !match) continue;
    const number = Number(match[1]);
    const key = `${repo}#${number}`;
    const existing = refs.get(key) ?? { repo, number, reasons: [] };
    const reason = String(notification.reason ?? "");
    if (reason && !existing.reasons.includes(reason)) existing.reasons.push(reason);
    refs.set(key, existing);
  }
  return refs;
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

function snapshotFor(
  repo: string,
  number: number,
  reasons: string[],
): PullRequestSnapshot | null {
  const raw = ghJson([
    "pr",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "number,title,url,state,isDraft,author,reviewDecision,mergeStateStatus,comments,reviews,statusCheckRollup,updatedAt",
  ]) as Json;

  const author = String(raw.author?.login ?? "");
  if (String(raw.state).toUpperCase() !== "OPEN") return null;

  const activities: AttentionActivity[] = [
    ...(raw.comments ?? []).map((item: Json) =>
      activity(item.author, item.body, item.createdAt, "comment"),
    ),
    ...(raw.reviews ?? []).map((item: Json) =>
      activity(item.author, item.body, item.submittedAt, "review", item.state),
    ),
  ].filter(Boolean) as AttentionActivity[];

  const checks: AttentionCheck[] = (raw.statusCheckRollup ?? []).map((item: Json) => ({
    name: String(item.name ?? item.context ?? "check"),
    state: String(item.conclusion ?? item.state ?? item.status ?? "UNKNOWN"),
  }));

  return {
    repo,
    number,
    title: String(raw.title ?? `${repo}#${number}`),
    url: String(raw.url ?? `https://github.com/${repo}/pull/${number}`),
    state: String(raw.state ?? "OPEN"),
    isDraft: Boolean(raw.isDraft),
    author,
    reviewDecision: raw.reviewDecision == null ? null : String(raw.reviewDecision),
    mergeState: raw.mergeStateStatus == null ? null : String(raw.mergeStateStatus),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    notificationReasons: reasons,
    activities,
    checks,
  };
}

const user = ghJson(["api", "user"]) as Json;
const login = String(user.login ?? "");
if (!login) {
  throw new Error("Could not determine the authenticated GitHub login from `gh api user`.");
}

const notifications = notificationPages();
const refs = notificationPulls(notifications);
for (const pull of authoredOpenPulls(login)) {
  const key = `${pull.repo}#${pull.number}`;
  if (!refs.has(key)) refs.set(key, { ...pull, reasons: [] });
}

const records = [];
for (const ref of refs.values()) {
  const snapshot = snapshotFor(ref.repo, ref.number, ref.reasons);
  if (!snapshot || snapshot.author.toLowerCase() !== login.toLowerCase()) continue;
  records.push(classifyPullRequest(snapshot, login));
}

const sorted = sortAttention(records);
const db = openAttentionDb();
try {
  replaceAttentionRecords(db, sorted, new Date().toISOString());
} finally {
  db.close();
}

const p0 = sorted.filter((item) => item.priority === "P0").length;
const p1 = sorted.filter((item) => item.priority === "P1").length;
console.log(`Synced ${sorted.length} authored open PRs (${p0} P0, ${p1} P1).`);
