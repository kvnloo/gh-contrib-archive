import fs from "node:fs";
import path from "node:path";
import type { CompiledPublicApi } from "./public-api.ts";
import { contentRevision } from "./resource-revision.ts";

export type BootstrapOptions = { maxItems?: number; maxBytes?: number };
const REVISION = /^sha256:[a-f0-9]{64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function clip(value: string, limit: number): string {
  // Do not leave a dangling high surrogate when clipping a Unicode string.
  return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
}

/** Accept only the public projection returned by writePublicApi, never a raw seed. */
export function compileAgentBootstrap(api: CompiledPublicApi, options: BootstrapOptions = {}) {
  const maxItems = options.maxItems ?? 12;
  const maxBytes = options.maxBytes ?? 16_384;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20 ||
      !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 65_536) {
    throw new RangeError("bootstrap requires 1..20 items and 1024..65536 bytes");
  }
  const attention = api.attention;
  if (attention.schemaVersion !== 1 || attention.privacy !== "public-safe" ||
      !REVISION.test(attention.revision)) {
    throw new Error("bootstrap requires a revisioned public attention snapshot");
  }
  const candidates = attention.items.filter((row) => {
    if (row.priority !== "P0" && row.priority !== "P1") return false;
    if (!REPO.test(row.repo) || row.repo.split("/").some((part) => part === "." || part === "..") ||
        !Number.isSafeInteger(row.number) || row.number < 1) return false;
    const thread = api.threadResources.get(`${row.repo}#${row.number}`);
    return thread?.privacy === "public-safe" && thread.repo === row.repo &&
      thread.number === row.number && REVISION.test(thread.revision);
  }).sort((a, b) => {
    const left = `${a.priority}:${a.repo}`;
    const right = `${b.priority}:${b.repo}`;
    if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return left === right ? a.number - b.number : left < right ? -1 : 1;
  });
  const items = candidates.slice(0, maxItems).map((row) => ({
    repo: row.repo,
    number: row.number,
    title: clip(row.title, 160),
    url: `https://github.com/${row.repo}/pull/${row.number}`,
    priority: row.priority,
    blocker: clip(row.blocker, 96),
    nextAction: clip(row.nextAction, 320),
    ciState: row.ciState,
    updatedAt: row.updatedAt,
    thread: {
      href: `threads/${row.repo}/${row.number}.json`,
      revision: api.threadResources.get(`${row.repo}#${row.number}`)!.revision,
    },
  }));
  const packet = () => {
    const semantic = {
      schemaVersion: 1 as const,
      privacy: "public-safe" as const,
      kind: "agent-bootstrap" as const,
      scope: "cached-actionable-only" as const,
      maxBytes,
      actionableCached: candidates.length,
      count: items.length,
      omitted: candidates.length - items.length,
      truncated: items.length < candidates.length,
      links: { index: "index.json", attention: "attention.json", changes: "changes.json" },
      items: [...items],
    };
    return {
      ...semantic,
      revision: contentRevision(semantic),
      // Collection freshness does not invalidate otherwise identical semantic content.
      source: { updatedAt: attention.updatedAt, revision: attention.revision },
    };
  };
  let result = packet();
  while (Buffer.byteLength(JSON.stringify(result) + "\n", "utf8") > maxBytes) {
    if (items.length === 0) throw new RangeError("bootstrap metadata exceeds byte budget");
    items.pop();
    result = packet();
  }
  return result;
}

export function writeAgentBootstrap(api: CompiledPublicApi, outputRoot: string, options: BootstrapOptions = {}) {
  const packet = compileAgentBootstrap(api, options);
  const file = path.join(outputRoot, "api", "v1", "bootstrap.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(packet) + "\n", "utf8");
  return packet;
}
