"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HBars, MonthHeat, TypeMix, YearBars } from "@/components/charts";
import { pageArchiveItems, type ArchiveFilters } from "@/lib/archive-filter";
import type { PublicArchive, PublicSnapshotManifest } from "@/lib/public-snapshot";

const TYPES = [
  "",
  "pull_request",
  "issue",
  "comment",
  "review",
  "review_comment",
  "discussion",
  "discussion_comment",
];

const FLAGS = [
  "",
  "agent_marker",
  "agent_template",
  "generic_ai_slop",
  "empty_body",
  "near_duplicate",
  "unfilled_template",
  "machine_title",
  "very_short",
  "low_signal",
];

type Props = {
  archive: PublicArchive;
  manifest: PublicSnapshotManifest;
};

function severityClass(severity: string) {
  if (severity === "bad") return "bg-red-500/15 text-red-300 ring-red-500/30";
  if (severity === "warn") return "bg-amber-500/15 text-amber-200 ring-amber-500/30";
  return "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30";
}

function initialFilters(): ArchiveFilters {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    type: params.get("type") ?? undefined,
    flag: params.get("flag") ?? undefined,
    repo: params.get("repo") ?? undefined,
    q: params.get("q") ?? undefined,
    year: params.get("year") ?? undefined,
  };
}

function initialPage() {
  if (typeof window === "undefined") return 0;
  return Math.max(0, Number(new URLSearchParams(window.location.search).get("page") ?? "0") || 0);
}

function syncUrl(filters: ArchiveFilters, page: number) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (page > 0) params.set("page", String(page));
  const query = params.toString();
  window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
}

export default function ArchiveExplorer({ archive, manifest }: Props) {
  const [filters, setFilters] = useState<ArchiveFilters>({});
  const [draft, setDraft] = useState<ArchiveFilters>({});
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const limit = 50;

  useEffect(() => {
    const next = initialFilters();
    const nextPage = initialPage();
    setFilters(next);
    setDraft(next);
    setPage(nextPage);
  }, []);

  const paged = useMemo(
    () => pageArchiveItems(archive.items, filters, page, limit),
    [archive.items, filters, page],
  );

  useEffect(() => {
    if (paged.page !== page) setPage(paged.page);
  }, [paged.page, page]);

  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = Object.fromEntries(
      Object.entries(draft).map(([key, value]) => [key, value?.trim() || undefined]),
    ) as ArchiveFilters;
    setFilters(next);
    setPage(0);
    syncUrl(next, 0);
  };

  const jumpTo = (nextPage: number) => {
    const clamped = Math.max(0, nextPage);
    setPage(clamped);
    syncUrl(filters, clamped);
    window.scrollTo({ top: document.body.scrollHeight * 0.55, behavior: "smooth" });
  };

  const clearFilters = () => {
    setFilters({});
    setDraft({});
    setPage(0);
    syncUrl({}, 0);
  };

  const publicCommitRows = [...archive.commitBuckets]
    .filter((row) => row.visibility === "public")
    .sort((a, b) => b.year - a.year || b.commit_count - a.commit_count)
    .slice(0, 16)
    .map((row) => ({
      label: `${row.year} · ${row.repo}`,
      n: row.commit_count,
      href: row.html_url ?? undefined,
    }));
  const privateCommitsByYear = [...archive.commitBuckets]
    .filter((row) => row.visibility === "private")
    .sort((a, b) => b.year - a.year);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">GitHub contribution archive</p>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Everything @kvnloo left on GitHub</h1>
        <p className="max-w-3xl text-sm leading-6 text-zinc-400">
          <Link href="/worlds" className="inline-flex min-h-11 items-center text-sky-300 hover:underline">Five graph worlds</Link>
          {" "}· public issues, PRs, and comments are linked. Private repositories appear only
          as anonymous type/date events and aggregate commit counts.
        </p>
        <p className="text-xs text-zinc-600">
          Public snapshot checked {manifest.lastCheckedAt.slice(0, 19).replace("T", " ")} UTC · schema v{manifest.schemaVersion}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="public records" value={archive.stats.public_n} />
        <Stat label="private records" value={archive.stats.private_n} />
        <Stat label="public commits" value={archive.stats.public_commits} />
        <Stat label="private commits" value={archive.stats.private_commits} />
      </section>

      <section className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Panel title="By year"><YearBars rows={archive.byYear} /></Panel>
        <Panel title="Type mix"><div className="mt-4"><TypeMix rows={archive.byType} /></div></Panel>
        <Panel title="Monthly activity" wide subtitle="Includes private events as anonymous counts.">
          <div className="mt-4"><MonthHeat rows={archive.byMonth} /></div>
        </Panel>
        <Panel title="Public repos">
          <div className="mt-4">
            <HBars rows={archive.byRepo.slice(0, 18).map((row) => ({ label: row.repo, n: row.n }))} />
          </div>
        </Panel>
        <Panel title="Public commit volume" subtitle="Links open GitHub's author commit list, not patches.">
          <div className="mt-4"><HBars rows={publicCommitRows} /></div>
          {privateCommitsByYear.length > 0 ? (
            <ul className="mt-4 space-y-1 text-xs text-zinc-500">
              {privateCommitsByYear.map((row) => (
                <li key={row.year}>{row.year}: {row.commit_count} private commits (no repo or message)</li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </section>

      {archive.byFlag.length > 0 ? (
        <section className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 text-xs sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {archive.byFlag.map((flag) => (
            <button
              type="button"
              key={flag.code}
              onClick={() => {
                const next = { ...filters, flag: flag.code };
                setFilters(next);
                setDraft(next);
                setPage(0);
                syncUrl(next, 0);
              }}
              className={`min-h-9 shrink-0 rounded-full px-3 py-1 ring-1 ${severityClass(flag.severity)}`}
            >
              {flag.code} {flag.n}
            </button>
          ))}
        </section>
      ) : null}

      <>
      <button
        type="button"
        onClick={() => setFiltersOpen((open) => !open)}
        aria-expanded={filtersOpen}
        className="flex min-h-11 items-center justify-between rounded-xl bg-zinc-900/70 px-4 text-sm ring-1 ring-zinc-800 sm:hidden"
      >
        <span>Filters</span>
        <span className="text-zinc-500">{filtersOpen ? "hide" : "show"}</span>
      </button>
      <form
        onSubmit={applyFilters}
        className={`${filtersOpen ? "grid" : "hidden"} gap-3 rounded-xl bg-zinc-900/70 p-3 ring-1 ring-zinc-800 sm:grid sm:grid-cols-5 sm:p-4`}
      >
        <select value={draft.type ?? ""} onChange={(e) => setDraft((v) => ({ ...v, type: e.target.value || undefined }))} className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 text-base ring-1 ring-zinc-800 sm:text-sm">
          {TYPES.map((type) => <option key={type} value={type}>{type || "all types"}</option>)}
        </select>
        <select value={draft.flag ?? ""} onChange={(e) => setDraft((v) => ({ ...v, flag: e.target.value || undefined }))} className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 text-base ring-1 ring-zinc-800 sm:text-sm">
          {FLAGS.map((flag) => <option key={flag} value={flag}>{flag || "all flags"}</option>)}
        </select>
        <input value={draft.year ?? ""} onChange={(e) => setDraft((v) => ({ ...v, year: e.target.value || undefined }))} placeholder="year" inputMode="numeric" className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 text-base ring-1 ring-zinc-800 sm:text-sm" />
        <input value={draft.repo ?? ""} onChange={(e) => setDraft((v) => ({ ...v, repo: e.target.value || undefined }))} placeholder="public repo" className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 text-base ring-1 ring-zinc-800 sm:text-sm" />
        <input value={draft.q ?? ""} onChange={(e) => setDraft((v) => ({ ...v, q: e.target.value || undefined }))} placeholder="search public text" className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 text-base ring-1 ring-zinc-800 sm:text-sm" />
        <div className="flex gap-2 sm:col-span-5">
          <button className="min-h-11 flex-1 rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950">Filter</button>
          <button type="button" onClick={clearFilters} className="min-h-11 rounded-md px-4 py-2 text-sm text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200">Clear</button>
        </div>
      </form>
      </>

      <p className="text-sm text-zinc-500">Showing {paged.items.length} of {paged.total}</p>

      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl ring-1 ring-zinc-800">
        {paged.items.length === 0 ? (
          <li className="p-8 text-sm text-zinc-500">No matching rows.</li>
        ) : paged.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 bg-zinc-900/40 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono">{item.type}</span>
                <span>{item.created_at.slice(0, 10)}</span>
                {item.visibility === "public" && item.repo ? <span className="max-w-full truncate">{item.repo}</span> : null}
                {item.visibility === "private" ? <span className="rounded bg-zinc-800 px-1.5 py-0.5">private</span> : null}
              </div>
              {item.visibility === "public" ? (
                <>
                  <a href={item.url} className="mt-1 block break-words text-sm font-medium leading-5 text-sky-300 hover:underline" target="_blank" rel="noreferrer">
                    {item.title || item.url}
                  </a>
                  {item.excerpt ? <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{item.excerpt}</p> : null}
                </>
              ) : (
                <p className="mt-1 text-sm text-zinc-300">Private {item.type.replace("_", " ")} exists</p>
              )}
            </div>
            {item.visibility === "public" ? (
              <div className="flex shrink-0 flex-wrap gap-1">
                {item.flags.map((flag) => (
                  <span key={flag.code} className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${severityClass(flag.severity)}`} title={flag.detail}>
                    {flag.code}
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <nav className="flex items-center justify-between gap-3 text-sm">
        <button type="button" disabled={paged.page === 0} onClick={() => jumpTo(paged.page - 1)} className="min-h-11 min-w-20 rounded-full px-3 text-sky-300 ring-1 ring-zinc-800 hover:bg-zinc-900 disabled:invisible">Previous</button>
        <span className="text-zinc-600">page {paged.page + 1}</span>
        <button type="button" disabled={(paged.page + 1) * limit >= paged.total} onClick={() => jumpTo(paged.page + 1)} className="min-h-11 min-w-20 rounded-full px-3 text-sky-300 ring-1 ring-zinc-800 hover:bg-zinc-900 disabled:invisible">Next</button>
      </nav>
    </main>
  );
}

function Panel({ title, subtitle, wide = false, children }: { title: string; subtitle?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-xl bg-zinc-900/70 p-3 ring-1 ring-zinc-800 sm:p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="text-sm font-medium">{title}</h2>
      {subtitle ? <p className="mt-1 text-xs text-zinc-500">{subtitle}</p> : null}
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-zinc-900 p-3 ring-1 ring-zinc-800 sm:p-4">
      <div className="text-xl font-semibold tabular-nums sm:text-2xl">{value ?? 0}</div>
      <div className="text-[10px] uppercase leading-4 tracking-wide text-zinc-500 sm:text-xs">{label}</div>
    </div>
  );
}
