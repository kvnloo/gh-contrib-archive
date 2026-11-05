import type { PublicArchiveItem } from "@/lib/public-snapshot";

/** Kevin's pinned GitHub repos (GraphQL user.pinnedItems, 2026-11-05). Themes come from each project's own site. */
export type FeaturedTheme = {
  bg: string;
  panel: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  font: string;
  display: string;
  /** Uppercase, tracked display headings (Hermes' Rules Gothic, GEV HUD). */
  caps: boolean;
  radius: string;
};

export type FeaturedRepo = {
  slug: string;
  name: string;
  /** Upstream first; a fork Kevin works in is listed after it. */
  repos: string[];
  site: string | null;
  tagline: string;
  theme: FeaturedTheme;
  themeSource: string;
};

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const FEATURED: FeaturedRepo[] = [
  {
    slug: "hermes-agent",
    name: "Hermes Agent",
    repos: ["NousResearch/hermes-agent"],
    site: "https://hermes-agent.nousresearch.com",
    tagline: "Nous Research's open agent",
    theme: { bg: "#03031a", panel: "#0a0a3a", fg: "#f3f5ff", muted: "#a9b0e0", accent: "#0000f2", accent2: "#7f8cff", font: "ui-sans-serif, system-ui, sans-serif", display: '"Arial Narrow", "Roboto Condensed", ui-sans-serif, sans-serif', caps: true, radius: "0px" },
    themeSource: "hermes-agent.nousresearch.com: theme-color #0000f2, Rules Gothic condensed caps (system stand-in)",
  },
  {
    slug: "cua",
    name: "Cua",
    repos: ["trycua/cua"],
    site: "https://cua.ai",
    tagline: "Computers for computer-use agents",
    theme: { bg: "#050607", panel: "#0e1113", fg: "#f3f2ee", muted: "#8d939c", accent: "#5ec0e8", accent2: "#b4b9c2", font: '"Urbanist", "Inter", ui-sans-serif, system-ui, sans-serif', display: '"Outfit", "Urbanist", ui-sans-serif, sans-serif', caps: false, radius: "14px" },
    themeSource: "cua.ai: theme-color #050607, accent ink #5ec0e8, fg #f3f2ee, Urbanist/Outfit",
  },
  {
    slug: "oh-my-pi",
    name: "oh my pi",
    repos: ["can1357/oh-my-pi"],
    site: "https://omp.sh",
    tagline: "A coding agent with the IDE wired in",
    theme: { bg: "#000000", panel: "#0a0a0c", fg: "oklch(97% 0 0)", muted: "oklch(82% .005 280)", accent: "oklch(70% .24 340)", accent2: "oklch(81% .14 200)", font: '"Geist", ui-sans-serif, system-ui, sans-serif', display: '"Geist", ui-sans-serif, system-ui, sans-serif', caps: false, radius: "6px" },
    themeSource: "omp.sh: ink-0 #000, ink-9 fg, magenta accent, cyan accent-2, Geist + JetBrains Mono",
  },
  {
    slug: "gods-eye-view",
    name: "God's Eye View",
    repos: ["bilawalsidhu/gods-eye-view", "kvnloo/gods-eye-view"],
    site: "https://maptheworld.ai/",
    tagline: "Spatial intelligence HUD",
    theme: { bg: "#0a0a0f", panel: "#10131a", fg: "#e6f7ff", muted: "#7f93a3", accent: "#00d4ff", accent2: "#ffb020", font: MONO, display: MONO, caps: true, radius: "2px" },
    themeSource: "gods-eye-view HUD: #0a0a0f, cyan #00d4ff, amber caution, mono caps",
  },
  {
    slug: "noctalia",
    name: "Noctalia",
    repos: ["noctalia-dev/noctalia"],
    site: "https://docs.noctalia.dev",
    tagline: "Desktop shell",
    theme: { bg: "#14151a", panel: "#1d1f26", fg: "#eceef8", muted: "#9aa0b8", accent: "#3d50f5", accent2: "#cfd4fc", font: "Inter, ui-sans-serif, system-ui, sans-serif", display: "Inter, ui-sans-serif, system-ui, sans-serif", caps: false, radius: "10px" },
    themeSource: "docs.noctalia.dev: Starlight accent #3d50f5 / low #cfd4fc, Inter",
  },
  {
    slug: "noop",
    name: "noop",
    repos: ["ryanbr/noop", "muftiarfan/noop"],
    site: null,
    tagline: "Android app (no project site; GitHub dark)",
    theme: { bg: "#0d1117", panel: "#161b22", fg: "#e6edf3", muted: "#8b949e", accent: "#58a6ff", accent2: "#3fb950", font: "ui-sans-serif, system-ui, sans-serif", display: "ui-sans-serif, system-ui, sans-serif", caps: false, radius: "6px" },
    themeSource: "no project site; GitHub dark palette",
  },
];

export const featuredBySlug = (slug: string) => FEATURED.find((f) => f.slug === slug);

type PublicItem = Extract<PublicArchiveItem, { visibility: "public" }>;

export type Thread = {
  key: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** pull_request / issue when Kevin authored it; "thread" when he only commented or reviewed. */
  kind: "pull_request" | "issue" | "thread";
  state: string | null;
  lastActivity: string;
  myEvents: number;
  stale: boolean;
};

export type Drilldown = {
  totals: { all: number; prs: number; merged: number; openPrs: number; issues: number; comments: number; reviews: number };
  first: string | null;
  last: string | null;
  inProgress: Thread[];
  recent: Thread[];
  past: { year: string; threads: Thread[] }[];
};

const DAY = 86_400_000;

/** Group one featured project's public items into threads and sort them for attention:
 * open authored work first (freshest first, stale flagged), then recent conversations, then finished work by year. */
export function drilldown(items: PublicArchiveItem[], repos: string[], now: Date, staleDays = 30): Drilldown {
  const mine = items.filter((i): i is PublicItem => i.visibility === "public" && !!i.repo && repos.includes(i.repo));
  const threads = new Map<string, Thread>();
  for (const i of mine) {
    if (i.number == null) continue;
    const key = `${i.repo}#${i.number}`;
    const at = [i.created_at, i.updated_at].filter(Boolean).sort().at(-1) as string;
    const t = threads.get(key) ?? {
      key, repo: i.repo as string, number: i.number, title: i.title ?? key,
      url: i.url.split("#")[0], kind: "thread" as Thread["kind"], state: null, lastActivity: at, myEvents: 0, stale: false,
    };
    if (i.type === "pull_request" || i.type === "issue") {
      t.kind = i.type;
      t.state = i.state;
      t.title = i.title ?? t.title;
      t.url = i.url;
    }
    if (at > t.lastActivity) t.lastActivity = at;
    t.myEvents += 1;
    threads.set(key, t);
  }
  const all = [...threads.values()];
  for (const t of all) t.stale = now.getTime() - Date.parse(t.lastActivity) > staleDays * DAY;
  const byLatest = (a: Thread, b: Thread) => b.lastActivity.localeCompare(a.lastActivity);
  const authoredOpen = (t: Thread) => t.kind !== "thread" && t.state === "OPEN";
  const inProgress = all.filter(authoredOpen).sort((a, b) =>
    Number(a.stale) - Number(b.stale) || Number(b.kind === "pull_request") - Number(a.kind === "pull_request") || byLatest(a, b));
  const recent = all.filter((t) => t.kind === "thread" && !t.stale).sort(byLatest);
  const done = all.filter((t) => !authoredOpen(t) && !(t.kind === "thread" && !t.stale)).sort(byLatest);
  const years = new Map<string, Thread[]>();
  for (const t of done) years.set(t.lastActivity.slice(0, 4), [...(years.get(t.lastActivity.slice(0, 4)) ?? []), t]);
  const dates = mine.map((i) => i.created_at).sort();
  const count = (type: string) => mine.filter((i) => i.type === type).length;
  return {
    totals: {
      all: mine.length,
      prs: count("pull_request"),
      merged: mine.filter((i) => i.type === "pull_request" && i.state === "MERGED").length,
      openPrs: mine.filter((i) => i.type === "pull_request" && i.state === "OPEN").length,
      issues: count("issue"),
      comments: count("comment") + count("review_comment") + count("discussion_comment"),
      reviews: count("review"),
    },
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    inProgress,
    recent,
    past: [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, threads]) => ({ year, threads })),
  };
}

/** Card summary for the home page's featured section. */
export function featuredSummary(items: PublicArchiveItem[], f: FeaturedRepo, now: Date) {
  const d = drilldown(items, f.repos, now);
  return { slug: f.slug, name: f.name, tagline: f.tagline, theme: f.theme, total: d.totals.all, merged: d.totals.merged, open: d.inProgress.length, last: d.last };
}
export type FeaturedSummary = ReturnType<typeof featuredSummary>;
