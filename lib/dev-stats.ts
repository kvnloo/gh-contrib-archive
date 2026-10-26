import type { PublicArchive } from "./public-snapshot.ts";
import type { PublicUpstreamLandingArchive } from "./upstream-landings.ts";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type ActivityCategory =
  | "Pull requests"
  | "Issues"
  | "Reviews"
  | "Conversation"
  | "Discussions"
  | "Other";

export type SalvagedCommit = {
  repo: string;
  sha: string;
  url: string;
  at: string;
  title: string;
  landing: "cherry-picked" | "maintainer-consolidated";
  sourcePRs: number[];
  sourceCommitSha: string | null;
};

export type DevStats = {
  asOf: string;
  publicCommits: number;
  privateCommits: number;
  mergedPublicPRs: number;
  publicPRs: number;
  issuesCreated: number;
  verifiedSalvagedCommits: number;
  salvageCoverageDate: string;
  salvageTrackedRepos: number;
  salvaged: SalvagedCommit[];
  velocityPerWeek: number;
  last7dEvents: number;
  last28dEvents: number;
  previous28dEvents: number;
  velocityChangePct: number | null;
  activeDays28d: number;
  eventStreakDays: number;
  recordWeek: boolean;
  weeks: { start: string; end: string; n: number }[];
  mix: { category: ActivityCategory; n: number }[];
};

function categoryFor(type: string): ActivityCategory {
  if (type === "pull_request") return "Pull requests";
  if (type === "issue") return "Issues";
  if (type === "review" || type === "review_comment") return "Reviews";
  if (type === "comment" || type === "discussion_comment") return "Conversation";
  if (type === "discussion") return "Discussions";
  return "Other";
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function isoDay(utcMillis: number): string {
  return new Date(utcMillis).toISOString().slice(0, 10);
}

/**
 * The archive has event timestamps but only YEARLY commit buckets. Do not merge
 * those incompatible grains into a fictional daily/weekly commit velocity.
 * PR state is the state at collection, not the time the PR was merged.
 */
export function buildDevStats(
  archive: PublicArchive,
  upstream: PublicUpstreamLandingArchive,
  asOf: string,
): DevStats {
  const parsedAsOf = Date.parse(asOf);
  const end = Number.isFinite(parsedAsOf) ? parsedAsOf : 0;

  const weeks = Array.from({ length: 12 }, (_, index) => {
    const start = end - (12 - index) * WEEK_MS;
    return {
      start: isoDay(start),
      end: isoDay(start + WEEK_MS),
      n: 0,
    };
  });

  const categories: ActivityCategory[] = [
    "Pull requests", "Issues", "Reviews", "Conversation", "Discussions", "Other",
  ];
  const categoryCounts = new Map<ActivityCategory, number>(
    categories.map((category) => [category, 0]),
  );
  const activeDays = new Set<number>();
  let last28dEvents = 0;
  let previous28dEvents = 0;
  let mergedPublicPRs = 0;
  let publicPRs = 0;
  let issuesCreated = 0;

  for (const item of archive.items) {
    if (item.type === "issue") issuesCreated += 1;
    if (item.type === "pull_request" && item.visibility === "public") {
      publicPRs += 1;
      if (item.state?.toUpperCase() === "MERGED") mergedPublicPRs += 1;
    }
    const created = Date.parse(item.created_at);
    if (!Number.isFinite(created) || created > end) continue;

    const weekAgo = Math.floor((end - created) / WEEK_MS);
    if (weekAgo >= 0 && weekAgo < 12) weeks[11 - weekAgo].n += 1;

    if (created > end - 28 * DAY_MS) {
      last28dEvents += 1;
      activeDays.add(Math.floor(created / DAY_MS));
      const category = categoryFor(item.type);
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    } else if (created > end - 56 * DAY_MS) {
      previous28dEvents += 1;
    }
  }

  const today = Math.floor(end / DAY_MS);
  const allActiveDays = new Set(
    archive.items
      .map((item) => Date.parse(item.created_at))
      .filter((time) => Number.isFinite(time) && time <= end)
      .map((time) => Math.floor(time / DAY_MS)),
  );
  let streakDay = allActiveDays.has(today) ? today : today - 1;
  let eventStreakDays = 0;
  while (allActiveDays.has(streakDay)) {
    eventStreakDays += 1;
    streakDay -= 1;
  }

  const salvageShas = new Set<string>();
  const salvaged: SalvagedCommit[] = [];
  for (const [repo, entry] of Object.entries(upstream.repositories)) {
    for (const commit of entry.commits) {
      if (commit.landing !== "cherry-picked" && commit.landing !== "maintainer-consolidated") {
        continue;
      }
      // Count explicit code provenance, never a bare mention or review acknowledgement.
      if (!commit.sourceCommitSha && !commit.sourcePRs?.length) continue;
      if (salvageShas.has(commit.sha)) continue;
      salvageShas.add(commit.sha);
      salvaged.push({
        repo,
        sha: commit.sha,
        url: commit.url,
        at: commit.at,
        title: commit.title,
        landing: commit.landing,
        sourcePRs: commit.sourcePRs ?? [],
        sourceCommitSha: commit.sourceCommitSha ?? null,
      });
    }
  }
  salvaged.sort((a, b) => b.at.localeCompare(a.at) || a.sha.localeCompare(b.sha));

  const publicCommits = archive.commitBuckets
    .filter((row) => row.visibility === "public")
    .reduce((n, row) => n + safeCount(row.commit_count), 0);
  const privateCommits = archive.commitBuckets
    .filter((row) => row.visibility === "private")
    .reduce((n, row) => n + safeCount(row.commit_count), 0);

  const priorBest = Math.max(0, ...weeks.slice(0, -1).map((week) => week.n));
  return {
    asOf,
    publicCommits,
    privateCommits,
    mergedPublicPRs,
    publicPRs,
    issuesCreated,
    verifiedSalvagedCommits: salvaged.length,
    salvageCoverageDate: upstream.verifiedOn,
    salvageTrackedRepos: Object.keys(upstream.repositories).length,
    salvaged,
    velocityPerWeek: Math.round((last28dEvents / 4) * 10) / 10,
    last7dEvents: weeks[weeks.length - 1].n,
    last28dEvents,
    previous28dEvents,
    velocityChangePct: previous28dEvents
      ? Math.round(((last28dEvents - previous28dEvents) / previous28dEvents) * 100)
      : null,
    activeDays28d: activeDays.size,
    eventStreakDays,
    recordWeek: weeks[weeks.length - 1].n > 0 && weeks[weeks.length - 1].n > priorBest,
    weeks,
    mix: categories.map((category) => ({ category, n: categoryCounts.get(category) ?? 0 })),
  };
}
