import fs from "node:fs";
import path from "node:path";
import { projectPublicUpstreamLandings, TRACKED_UPSTREAM_REPOS } from "../lib/upstream-landings.ts";

const subject = "kvnloo";
const inputPath = path.join(process.cwd(), "data", "upstream-landings.json");
const token = process.env.GH_ARCHIVE_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const checkOnly = process.argv.includes("--check");
const apiRoot = "https://api.github.com";
const headers: Record<string, string> = {
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "gh-contrib-archive/upstream-landings",
  ...(token ? { Authorization: "Bearer " + token } : {}),
};

type GithubCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; committer?: { date?: string }; author?: { date?: string } };
};
type Landing = ReturnType<typeof projectPublicUpstreamLandings>["repositories"][string]["commits"][number];

async function json<T>(url: string): Promise<T> {
  const parsed = new URL(url, apiRoot);
  if (parsed.origin !== apiRoot || parsed.username || parsed.password) {
    throw new Error("unsafe upstream GitHub URL");
  }
  const response = await fetch(parsed, {
    headers, redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("GitHub HTTP " + response.status + " for " + parsed.pathname);
  return await response.json() as T;
}

function validDate(commit: GithubCommit): string {
  const raw = commit.commit.committer?.date ?? commit.commit.author?.date;
  if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw))) {
    throw new Error("GitHub commit missing date: " + commit.sha);
  }
  return raw;
}

function creditForMessage(message: string): Landing["credit"] {
  if (/^co-authored-by:[^\n]*(kvnloo|Kevin Rajan)/im.test(message)) return "co-authored";
  if (/\b(review|requested by|reported by|thanks to|identified by|feedback|addresses)\b/i.test(message)) {
    return "review-acknowledged";
  }
  return "referenced";
}

function landingRow(repo: string, commit: GithubCommit, authored: boolean): Landing {
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("invalid commit SHA");
  const message = commit.commit.message;
  const picked = message.match(/\(cherry picked from commit ([a-f0-9]{40})\)/i);
  return {
    sha: commit.sha,
    url: "https://github.com/" + repo + "/commit/" + commit.sha,
    title: message.split("\n")[0].slice(0, 300),
    at: validDate(commit),
    credit: authored ? "author" : creditForMessage(message),
    landing: authored ? (picked ? "cherry-picked" : "author-attributed") : "credited-upstream",
    evidence: authored ? "GitHub upstream branch author-filter" : "GitHub upstream commit message credit",
    verification: authored ? "in-upstream-branch" : "GitHub compare: zero commits behind upstream branch",
    ...(picked ? { sourceCommitSha: picked[1] } : {}),
  };
}

async function authoredCommits(repo: string, branch: string): Promise<GithubCommit[]> {
  const commits: GithubCommit[] = [];
  for (let page = 1; page <= 40; page++) {
    const rows = await json<GithubCommit[]>(
      "/repos/" + repo + "/commits?sha=" + encodeURIComponent(branch) +
      "&author=" + subject + "&per_page=100&page=" + page,
    );
    if (!Array.isArray(rows)) throw new Error("malformed author response");
    commits.push(...rows);
    if (rows.length < 100) return commits;
  }
  throw new Error("authored commit pagination limit: " + repo);
}

async function referencedCommits(repo: string, term: string): Promise<GithubCommit[]> {
  const result: GithubCommit[] = [];
  for (let page = 1; page <= 10; page++) {
    const q = term + " repo:" + repo;
    const response = await json<{
      total_count: number;
      incomplete_results: boolean;
      items: GithubCommit[];
    }>(
      "/search/commits?q=" + encodeURIComponent(q) + "&per_page=100&page=" + page,
    );
    if (!response || !Array.isArray(response.items) ||
        response.incomplete_results || response.total_count > 1000) {
      throw new Error("incomplete commit search for " + repo + " / " + term);
    }
    result.push(...response.items);
    if (result.length >= response.total_count) return result;
    if (response.items.length < 100) {
      throw new Error("truncated commit search for " + repo + " / " + term);
    }
  }
  throw new Error("commit search pagination limit: " + repo);
}

/** Branch ancestry, not merely commit existence, establishes landing. */
async function onBranch(repo: string, sha: string, branch: string): Promise<boolean> {
  const compare = await json<{
    status: string;
    behind_by: number;
  }>("/repos/" + repo + "/compare/" + sha + "..." + encodeURIComponent(branch));
  return compare.behind_by === 0 &&
    (compare.status === "ahead" || compare.status === "identical");
}

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error("missing tracked upstream ledger");
  const previous = projectPublicUpstreamLandings(JSON.parse(fs.readFileSync(inputPath, "utf8")));
  const updated: typeof previous = {
    ...previous,
    verifiedOn: new Date().toISOString().slice(0, 10),
    repositories: {},
  };
  for (const repo of TRACKED_UPSTREAM_REPOS) {
    const info = await json<{ default_branch: string; private: boolean }>(
      "/repos/" + repo,
    );
    if (info.private || typeof info.default_branch !== "string") {
      throw new Error("upstream repository is not confirmed public: " + repo);
    }
    const branch = info.default_branch;
    const head = await json<{ commit: { sha: string } }>(
      "/repos/" + repo + "/branches/" + encodeURIComponent(branch),
    );
    const rows = new Map<string, Landing>();
    for (const commit of await authoredCommits(repo, branch)) {
      rows.set(commit.sha, landingRow(repo, commit, true));
    }
    for (const term of ["kvnloo", "\"Kevin Rajan\""]) {
      for (const commit of await referencedCommits(repo, term)) {
        if (rows.has(commit.sha)) continue;
        if (await onBranch(repo, commit.sha, branch)) {
          rows.set(commit.sha, landingRow(repo, commit, false));
        }
      }
    }

    // Preserve human-verified source PR / consolidation mapping for the same SHA.
    for (const old of previous.repositories[repo].commits) {
      if (!rows.has(old.sha)) {
        if (!await onBranch(repo, old.sha, branch)) {
          throw new Error("previously landed SHA no longer on branch: " + repo + " " + old.sha);
        }
        rows.set(old.sha, old);
      }
      const next = rows.get(old.sha)!;
      if (old.sourcePRs) next.sourcePRs = old.sourcePRs;
      if (old.landingPR) next.landingPR = old.landingPR;
      if (old.sourceCommitSha) next.sourceCommitSha = old.sourceCommitSha;
      if (old.landing === "maintainer-consolidated" || old.landing === "direct-merged-pr") {
        next.landing = old.landing;
      }
      if (old.evidence.includes("Upstream #") || old.evidence.includes("co-authored-by trailer")) {
        next.evidence = old.evidence;
      }
      // Do not silently reduce a stronger, previously-verified code credit.
      if (old.credit === "co-authored" && next.credit !== "author") next.credit = old.credit;
    }
    const commits = [...rows.values()].sort(
      (a, b) => b.at.localeCompare(a.at) || a.sha.localeCompare(b.sha),
    );
    updated.repositories[repo] = {
      upstreamBranch: branch,
      verifiedHead: head.commit.sha,
      branchUrl: "https://github.com/" + repo + "/tree/" + branch,
      coverage: {
        complete: false,
        method: "upstream author commits + message references + ancestry; not uncredited patch-equivalence",
        limitations: [
          "Uncredited rewritten implementations require patch-level human review.",
          "GitHub search can omit unrelated commits without explicit credit.",
          "Review acknowledgements and references do not constitute code authorship.",
        ],
      },
      commits,
    };
    console.log(repo + ": " + commits.length + " verified upstream SHAs");
  }
  const publicSafe = projectPublicUpstreamLandings(updated);
  const next = JSON.stringify(publicSafe, null, 2) + "\n";
  const old = fs.readFileSync(inputPath, "utf8");
  if (checkOnly) {
    console.log(next === old ? "ledger is current" : "ledger refresh required");
    if (next !== old) process.exitCode = 1;
  } else if (next !== old) {
    fs.writeFileSync(inputPath, next, "utf8");
    console.log("updated " + path.relative(process.cwd(), inputPath));
  } else console.log("no changes");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
