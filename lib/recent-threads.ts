import type { AttentionPriority } from "./attention.ts";

export type RecentThreadContribution = {
  repo: string | null;
  number: number | null;
  type: string;
  title: string | null;
  url: string;
  created_at: string;
  updated_at: string | null;
};

export type RecentThreadAttention = {
  repo: string;
  number: number;
  title: string;
  url: string;
  priority: AttentionPriority;
  blocker: string;
  nextAction: string;
  updatedAt: string;
};

export type RecentThread = {
  repo: string;
  number: number;
  title: string | null;
  url: string;
  href: string;
  lastActivityAt: string;
  types: string[];
  attention: null | {
    priority: AttentionPriority;
    blocker: string;
    nextAction: string;
  };
};

function safeRepo(repo: string): [string, string] | null {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo);
  if (!match || [".", ".."].includes(match[1]) || [".", ".."].includes(match[2])) return null;
  return [match[1], match[2]];
}

function canonicalThreadUrl(value: string, repo: string, number: number) {
  const match = value.match(
    /^(https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull|discussions)\/\d+)/,
  );
  return match?.[1] ?? `https://github.com/${repo}/pull/${number}`;
}

function maxIso(a: string, b: string) {
  return b > a ? b : a;
}

export function buildRecentThreads(
  contributions: readonly RecentThreadContribution[],
  attention: readonly RecentThreadAttention[],
  limit = 250,
): RecentThread[] {
  const rows = new Map<
    string,
    {
      repo: string;
      number: number;
      title: string | null;
      url: string;
      lastActivityAt: string;
      types: Set<string>;
      attention: RecentThread["attention"];
    }
  >();

  for (const item of contributions) {
    if (!item.repo || item.number == null || !safeRepo(item.repo)) continue;
    const key = `${item.repo}#${item.number}`;
    const at = item.updated_at ?? item.created_at;
    const existing = rows.get(key);
    const isRoot = ["pull_request", "issue", "discussion"].includes(item.type);
    if (!existing) {
      rows.set(key, {
        repo: item.repo,
        number: item.number,
        title: item.title,
        url: canonicalThreadUrl(item.url, item.repo, item.number),
        lastActivityAt: at,
        types: new Set([item.type]),
        attention: null,
      });
      continue;
    }
    existing.lastActivityAt = maxIso(existing.lastActivityAt, at);
    existing.types.add(item.type);
    if (isRoot) {
      existing.title = item.title ?? existing.title;
      existing.url = canonicalThreadUrl(item.url, item.repo, item.number);
    }
  }

  for (const item of attention) {
    if (!safeRepo(item.repo)) continue;
    const key = `${item.repo}#${item.number}`;
    const existing = rows.get(key);
    const projection = {
      priority: item.priority,
      blocker: item.blocker,
      nextAction: item.nextAction,
    };
    if (!existing) {
      rows.set(key, {
        repo: item.repo,
        number: item.number,
        title: item.title,
        url: canonicalThreadUrl(item.url, item.repo, item.number),
        lastActivityAt: item.updatedAt,
        types: new Set(),
        attention: projection,
      });
      continue;
    }
    existing.title = existing.title ?? item.title;
    existing.url = existing.url || canonicalThreadUrl(item.url, item.repo, item.number);
    existing.lastActivityAt = maxIso(existing.lastActivityAt, item.updatedAt);
    existing.attention = projection;
  }

  return [...rows.values()]
    .map((item) => {
      const [owner, repoName] = safeRepo(item.repo)!;
      return {
        repo: item.repo,
        number: item.number,
        title: item.title,
        url: item.url,
        href: `threads/${owner}/${repoName}/${item.number}.json`,
        lastActivityAt: item.lastActivityAt,
        types: [...item.types].sort(),
        attention: item.attention,
      };
    })
    .sort(
      (a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt) ||
        a.repo.localeCompare(b.repo) ||
        a.number - b.number,
    )
    .slice(0, Math.max(1, limit));
}
