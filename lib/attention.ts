export type AttentionPriority = "P0" | "P1" | "P2";

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

const VERIFY_RE =
  /\b(test|tests|tested|verification|verify|evidence|screenshot|screenshots|recording|repro|reproduce|run)\b/i;
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
  const verificationRequest = unansweredExternal.find((activity) => VERIFY_RE.test(activity.body));
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
  } else if (unansweredExternal.length > 0) {
    priority = "P0";
    blocker = "external_reply";
    nextAction = "read and respond to the newest unanswered human feedback";
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
