// Imported only by the synthetic eval subprocess. Never makes a network request.
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const dirty = process.env.API_EVAL_DIRTY === "1";
let requests = 0;
let active = 0;
let maxActive = 0;
let unexpected = 0;
process.on("exit", () => fs.writeFileSync("transport.json", JSON.stringify({ requests, maxActive, unexpected })));
globalThis.fetch = async (input) => {
  requests += 1;
  const url = new URL(String(input));
  if (url.origin !== "https://api.github.com") { unexpected += 1; throw new Error("unexpected fixture origin"); }
  active += 1;
  maxActive = Math.max(maxActive, active);
  try {
    await delay(2);
    if (url.pathname === "/repos/bilawalsidhu/gods-eye-view") {
      return Response.json({ private: false, visibility: "public", full_name: "bilawalsidhu/gods-eye-view" });
    }
    if (url.pathname === "/search/issues") {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("repo:bilawalsidhu/gods-eye-view")) return Response.json({ total_count: 0, items: [] });
      const items = [101, 102].map((number) => ({
        id: number, number, title: "Synthetic change", repository_url: "https://api.github.com/repos/fixture/repo",
        html_url: `https://github.com/fixture/repo/pull/${number}`, state: "open", draft: false,
        user: { login: "fixture-self" }, comments: 1, pull_request: {},
        updated_at: dirty && number === 101 ? "2026-01-02T00:00:00Z" : "2026-01-01T00:00:00Z",
      }));
      // The recent-involvement scan deliberately changes between the aggregate
      // count and its disjoint leaf scans. This models a live GitHub search
      // without making a stable partition incomplete.
      if (q.includes("involves:fixture-self")) {
        const range = /created:([^ ]+)\.\.([^ ]+)/.exec(q);
        const spanMs = range ? Date.parse(range[2]) - Date.parse(range[1]) : 0;
        if (spanMs > 15 * 365 * 86400_000) return Response.json({ total_count: 1000, items: [] });
        const target = Date.parse("2026-01-01T00:00:00Z");
        const containsTarget = range && Date.parse(range[1]) <= target && target <= Date.parse(range[2]);
        return Response.json({ total_count: containsTarget ? 2 : 0, items: containsTarget ? items : [] });
      }
      return Response.json({ total_count: 2, items });
    }
    const match = /^\/repos\/fixture\/repo\/(issues|pulls)\/(101|102)\/(comments|reviews)$/.exec(url.pathname);
    if (!match) { unexpected += 1; throw new Error("unexpected fixture route"); }
    if (match[3] === "reviews") return Response.json([]);
    return Response.json([{
      id: Number(match[2]), user: { login: "fixture-reviewer", type: "User" },
      body: "Please run the regression test. SYNTHETIC_FEEDBACK_SENTINEL",
      created_at: dirty && match[2] === "101" ? "2026-01-02T00:00:00Z" : "2026-01-01T00:00:00Z",
      html_url: `https://github.com/fixture/repo/pull/${match[2]}#issuecomment-1`,
      author_association: "CONTRIBUTOR", token: "SYNTHETIC_TOKEN_SENTINEL",
    }]);
  } finally { active -= 1; }
};
