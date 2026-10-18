import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const TRACKED_UPSTREAM_REPOS = [
  "NousResearch/hermes-agent",
  "omacom/omarchy",
] as const;

const shaPattern = /^[a-f0-9]{40}$/;
const validCredits = new Set(["author", "co-authored", "review-acknowledged", "referenced"]);
const validLandings = new Set([
  "author-attributed", "cherry-picked", "credited-upstream",
  "maintainer-consolidated", "direct-merged-pr",
]);

type Landing = {
  sha: string;
  url: string;
  title: string;
  at: string;
  credit: string;
  landing: string;
  evidence: string;
  verification: string;
  sourceCommitSha?: string;
  sourcePRs?: number[];
  landingPR?: number;
};

export type PublicUpstreamLandingArchive = {
  schemaVersion: 1;
  privacy: "public-safe";
  subject: "kvnloo";
  verifiedOn: string;
  semanticNote: string;
  repositories: Record<string, {
    upstreamBranch: string;
    verifiedHead: string;
    branchUrl: string;
    coverage: { complete: false; method: string; limitations: string[] };
    commits: Landing[];
  }>;
};

/** Strict whitelist: public API must never leak an accidentally added private repo. */
export function projectPublicUpstreamLandings(value: unknown): PublicUpstreamLandingArchive {
  if (!value || typeof value !== "object") throw new Error("missing upstream archive");
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1 || root.privacy !== "public-safe" || root.subject !== "kvnloo") {
    throw new Error("invalid upstream archive contract");
  }
  if (typeof root.verifiedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(root.verifiedOn)) {
    throw new Error("invalid verification date");
  }
  const source = root.repositories as Record<string, unknown> | undefined;
  if (!source || Object.keys(source).sort().join("|") !== [...TRACKED_UPSTREAM_REPOS].sort().join("|")) {
    throw new Error("unapproved or missing upstream repository");
  }
  const repositories: PublicUpstreamLandingArchive["repositories"] = {};
  for (const repo of TRACKED_UPSTREAM_REPOS) {
    const entry = source[repo] as Record<string, unknown> | undefined;
    if (!entry || typeof entry.upstreamBranch !== "string" ||
        !/^[\w./-]+$/.test(entry.upstreamBranch) || entry.upstreamBranch.includes("..") ||
        typeof entry.verifiedHead !== "string" || !shaPattern.test(entry.verifiedHead)) {
      throw new Error("invalid upstream ref: " + repo);
    }
    const coverage = entry.coverage as Record<string, unknown> | undefined;
    if (!coverage || coverage.complete !== false || !Array.isArray(coverage.limitations) ||
        typeof coverage.method !== "string" ||
        !coverage.limitations.every((s: unknown) => typeof s === "string")) {
      throw new Error("upstream completeness must be explicit");
    }
    if (!Array.isArray(entry.commits)) throw new Error("missing upstream commits");
    const seen = new Set<string>();
    const commits: Landing[] = entry.commits.map((raw: unknown) => {
      if (!raw || typeof raw !== "object") throw new Error("invalid commit row");
      const row = raw as Record<string, unknown>;
      const sha = row.sha;
      if (typeof sha !== "string" || !shaPattern.test(sha) || seen.has(sha)) {
        throw new Error("duplicate or invalid SHA in " + repo);
      }
      seen.add(sha);
      const expectedUrl = "https://github.com/" + repo + "/commit/" + sha;
      if (row.url !== expectedUrl || typeof row.title !== "string" || row.title.length > 300 ||
          typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at)) ||
          !validCredits.has(String(row.credit)) || !validLandings.has(String(row.landing)) ||
          typeof row.evidence !== "string" || typeof row.verification !== "string") {
        throw new Error("invalid upstream commit evidence: " + sha);
      }
      const commit: Landing = {
        sha, url: expectedUrl, title: row.title, at: row.at,
        credit: String(row.credit), landing: String(row.landing),
        evidence: row.evidence, verification: row.verification,
      };
      if (row.sourceCommitSha !== undefined) {
        if (typeof row.sourceCommitSha !== "string" || !shaPattern.test(row.sourceCommitSha)) {
          throw new Error("invalid cherry-pick provenance");
        }
        commit.sourceCommitSha = row.sourceCommitSha;
      }
      if (row.sourcePRs !== undefined) {
        if (!Array.isArray(row.sourcePRs) || !row.sourcePRs.every(
          (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0,
        )) throw new Error("invalid source PR");
        commit.sourcePRs = [...new Set(row.sourcePRs as number[])];
      }
      if (row.landingPR !== undefined) {
        if (!Number.isSafeInteger(row.landingPR) || (row.landingPR as number) < 1) {
          throw new Error("invalid landing PR");
        }
        commit.landingPR = row.landingPR as number;
      }
      return commit;
    });
    repositories[repo] = {
      upstreamBranch: entry.upstreamBranch,
      verifiedHead: entry.verifiedHead,
      branchUrl: "https://github.com/" + repo + "/tree/" + entry.upstreamBranch,
      coverage: {
        complete: false,
        method: coverage.method,
        limitations: [...coverage.limitations as string[]],
      },
      commits,
    };
  }
  return {
    schemaVersion: 1, privacy: "public-safe", subject: "kvnloo",
    verifiedOn: root.verifiedOn, semanticNote:
      "Each upstream SHA counts once. Review acknowledgements do not imply code authorship.",
    repositories,
  };
}

/** Publish only validated, known-public repository records; never raw GitHub payloads. */
export function writePublicUpstreamLandings(
  inputPath: string,
  outputRoot: string,
): { count: number; href: string; revision: string } {
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8")) as unknown;
  const archive = projectPublicUpstreamLandings(source);
  const payload = JSON.stringify(archive);
  const revision = createHash("sha256").update(payload).digest("hex");
  const href = "api/v1/upstream-landings.json";
  const target = path.join(outputRoot, href);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ ...archive, revision }) + "\n", "utf8");
  return {
    count: Object.values(archive.repositories).reduce((n, r) => n + r.commits.length, 0),
    href,
    revision,
  };
}
