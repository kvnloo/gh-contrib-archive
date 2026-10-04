import type { AttentionRecord } from "./attention.ts";

export type WorkQueueName =
  | "needs_action"
  | "ready"
  | "blocked"
  | "waiting"
  | "superseded";

export type WorkQueueRecord = Pick<
  AttentionRecord,
  | "repo"
  | "number"
  | "title"
  | "url"
  | "priority"
  | "blocker"
  | "nextAction"
  | "updatedAt"
  | "ciState"
  | "reviewDecision"
  | "mergeState"
>;

const BLOCKED = new Set(["ci_failed", "merge_conflict", "branch_behind"]);
const NEEDS_ACTION = new Set(["external_reply", "notification_attention"]);

export function workQueueFor(record: WorkQueueRecord): WorkQueueName {
  if (record.blocker === "superseded_candidate") return "superseded";
  if (
    record.blocker === "approved" ||
    (record.reviewDecision?.toUpperCase() === "APPROVED" &&
      record.ciState !== "pending" &&
      record.ciState !== "failing" &&
      !["DIRTY", "BEHIND"].includes(record.mergeState?.toUpperCase() ?? ""))
  ) {
    return "ready";
  }
  if (BLOCKED.has(record.blocker)) return "blocked";
  if (record.priority === "P0" || NEEDS_ACTION.has(record.blocker)) return "needs_action";
  return "waiting";
}

export function buildWorkQueues<T extends WorkQueueRecord>(
  records: readonly T[],
): Record<WorkQueueName, T[]> {
  const queues: Record<WorkQueueName, T[]> = {
    needs_action: [],
    ready: [],
    blocked: [],
    waiting: [],
    superseded: [],
  };
  for (const record of records) queues[workQueueFor(record)].push(record);
  return queues;
}
