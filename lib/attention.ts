export type AttentionPriority = "P0" | "P1" | "P2";
export type RepositoryVisibility = "public" | "private" | "internal" | "unknown";

export type AttentionActivity = {
  actor: string;
  body: string;
  at: string;
  kind: "comment" | "review";
  reviewState?: string | null;
};

export type AttentionCheck = {
  name: string;
  state: string;
};

export type PullRequestSnapshot = {
  repo: string;
  repoVisibility: RepositoryVisibility;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: string;
  reviewDecision: string | null;
  mergeState: string | null;
  updatedAt: string;
  notificationReasons: string[];
  activities: AttentionActivity[];
  checks: AttentionCheck[];
};

export type AttentionRecord = {
  repo: string;
  repoVisibility: RepositoryVisibility;
  number: number;
  title: string;
  url: string;
  priority: AttentionPriority;
  blocker: string;
  nextAction: string;
  updatedAt: string;
  lastExternalAt: string | null;
  lastSelfAt: string | null;
  ciState: "failing" | "passing" | "pending" | "none";
  reviewDecision: string | null;
  mergeState: string | null;
};

const VERIFICATION_REQUEST_RE =
  /(?:\b(?:please|could you|can you|need(?:s|ed)?|must|required|missing|which|useful addition)\b[\s\S]{0,180}\b(?:test|tests|verification|verify|evidence|screenshot|screenshots|recording|repro|reproduce|run|results|checks|link)\b)|(?:\b(?:test|tests|verification|verify|evidence|screenshot|screenshots|recording|repro|reproduce|run|results|checks)\b[\s\S]{0,180}\b(?:please|required|needed|missing|request|addition)\b)/i;
const ACTION_REQUEST_RE =
  /\b(?:please|could you|can you|needs?|needed|must|required|missing|one gap remains|useful addition|address|rebase|fix|update|which checks|which results)\b/i;
const SUPERSEDED_RE =
  /\b(?:supersed|competing fix|merge\s+[^.\n]{0,120}\s+in favor|covered by\s+#\d+|only one of the two should)\b/i;
const NO_ACTION_RE =
  /\b(?:no actionable defect|no new finding|nothing left|works as expected|everything works as expected|no issues found|clean fix with no issues)\b/i;
const FAILING_CHECK_STATES = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
]);
const PENDING_CHECK_STATES = new Set([
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "EXPECTED",
  "WAITING",
]);

function isBot(login: string): boolean {
  const value = login.toLowerCase();
  return value.endsWith("[bot]") || value === "dependabot" || value === "github-actions";
}

function maxIso(values: string[]): string | null {
  return values.length === 0 ? null : values.reduce((max, value) => (value > max ? value : max));
}

function ciState(checks: AttentionCheck[]): AttentionRecord["ciState"] {
  if (checks.length === 0) return "none";
  if (checks.some((check) => FAILING_CHECK_STATES.has(check.state.toUpperCase()))) return "failing";
  if (checks.some((check) => PENDING_CHECK_STATES.has(check.state.toUpperCase()))) return "pending";
  return "passing";
}

export function classifyPullRequest(
  snapshot: PullRequestSnapshot,
  selfLogin: string,
): AttentionRecord {
  const self = selfLogin.toLowerCase();
  const lastSelfAt = maxIso(
    snapshot.activities
      .filter((activity) => activity.actor.toLowerCase() === self)
      .map((activity) => activity.at),
  );
  const unansweredExternal = snapshot.activities
    .filter((activity) => activity.actor.toLowerCase() !== self && !isBot(activity.actor))
    .filter((activity) => lastSelfAt === null || activity.at > lastSelfAt)
    .sort((a, b) => b.at.localeCompare(a.at));

  const lastExternalAt = unansweredExternal[0]?.at ?? null;
  const requestedChanges = unansweredExternal.find(
    (activity) =>
      activity.kind === "review" && activity.reviewState?.toUpperCase() === "CHANGES_REQUESTED",
  );
  const verificationRequest = unansweredExternal.find((activity) =>
    VERIFICATION_REQUEST_RE.test(activity.body),
  );
  const actionRequest = unansweredExternal.find((activity) =>
    ACTION_REQUEST_RE.test(activity.body),
  );
  const superseded = unansweredExternal.find((activity) => SUPERSEDED_RE.test(activity.body));
  const latestExternal = unansweredExternal[0] ?? null;
  const ci = ciState(snapshot.checks);

  let priority: AttentionPriority = "P2";
  let blocker = "awaiting_review";
  let nextAction = "wait for review; do not start speculative follow-up work";

  if (requestedChanges) {
    priority = "P0";
    blocker = "changes_requested";
    nextAction = "address the requested review changes and reply with evidence";
  } else if (verificationRequest) {
    priority = "P0";
    blocker = "verification_requested";
    nextAction = "run the requested verification and post the observed results/evidence";
  } else if (actionRequest) {
    priority = "P0";
    blocker = "external_action_requested";
    nextAction = "address the newest unresolved human request/finding and reply with evidence";
  } else if (superseded) {
    priority = "P1";
    blocker = "superseded_candidate";
    nextAction = "confirm the competing fix landed or still covers the issue, then close/supersede this PR";
  } else if (latestExternal && NO_ACTION_RE.test(latestExternal.body)) {
    priority = "P2";
    blocker = "review_update_no_action";
    nextAction = "no immediate fix requested; wait for broader review or maintainer decision";
  } else if (unansweredExternal.length > 0) {
    priority = "P1";
    blocker = "external_reply";
    nextAction = "inspect the newest unanswered human feedback and respond if action is required";
  } else if (ci === "failing") {
    priority = "P1";
    blocker = "ci_failed";
    nextAction = "fix the failing checks and post the new verification result";
  } else if (snapshot.mergeState?.toUpperCase() === "DIRTY") {
    priority = "P1";
    blocker = "merge_conflict";
    nextAction = "rebase or resolve the merge conflict before starting new work";
  } else if (snapshot.mergeState?.toUpperCase() === "BEHIND") {
    priority = "P1";
    blocker = "branch_behind";
    nextAction = "update the branch on the current upstream base and rerun focused checks";
  } else if (snapshot.reviewDecision?.toUpperCase() === "APPROVED" && ci !== "pending") {
    priority = "P1";
    blocker = "approved";
    nextAction = "confirm the branch is current and surface it for merge";
  } else if (
    snapshot.notificationReasons.some((reason) =>
      ["mention", "team_mention", "assign"].includes(reason),
    )
  ) {
    priority = "P1";
    blocker = "notification_attention";
    nextAction = "inspect the GitHub notification and respond if action is required";
  }

  return {
    repo: snapshot.repo,
    repoVisibility: snapshot.repoVisibility,
    number: snapshot.number,
    title: snapshot.title,
    url: snapshot.url,
    priority,
    blocker,
    nextAction,
    updatedAt: snapshot.updatedAt,
    lastExternalAt,
    lastSelfAt,
    ciState: ci,
    reviewDecision: snapshot.reviewDecision,
    mergeState: snapshot.mergeState,
  };
}

const PRIORITY_RANK: Record<AttentionPriority, number> = { P0: 0, P1: 1, P2: 2 };

export function sortAttention(records: AttentionRecord[]): AttentionRecord[] {
  return [...records].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
