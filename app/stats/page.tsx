import type { Metadata } from "next";
import Link from "next/link";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_DB_PATH } from "@/lib/db";
import { compilePublicSnapshot } from "@/lib/public-snapshot";
import { buildDevStats, type DevStats } from "@/lib/dev-stats";
import { projectPublicUpstreamLandings } from "@/lib/upstream-landings";

export const metadata: Metadata = {
  title: "Dev velocity | kvnloo GitHub archive",
  description: "Public-safe GitHub activity, merged PRs, and verified upstream salvage.",
};

const integer = new Intl.NumberFormat("en-US");
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function Score({
  label, value, note, accent = "text-zinc-100",
}: {
  label: string;
  value: number | string;
  note: string;
  accent?: string;
}) {
  return (
    <div className="group min-w-0 rounded-2xl border border-white/10 bg-zinc-900/70 p-4 transition-colors hover:border-white/25 sm:p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">{label}</p>
      <p className={`mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl ${accent}`}>
        {typeof value === "number" ? integer.format(value) : value}
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{note}</p>
    </div>
  );
}

function WeekChart({ stats }: { stats: DevStats }) {
  const peak = Math.max(1, ...stats.weeks.map((week) => week.n));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">Weekly GitHub events</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {integer.format(stats.last7dEvents)}
            <span className="ml-2 text-sm font-normal text-zinc-500">last 7 days</span>
          </p>
        </div>
        {stats.velocityChangePct !== null ? (
          <p className={`rounded-full px-3 py-1 text-xs font-medium ${stats.velocityChangePct >= 0 ? "bg-lime-300/10 text-lime-300" : "bg-orange-300/10 text-orange-300"}`}>
            {stats.velocityChangePct > 0 ? "+" : ""}{stats.velocityChangePct}% vs prior 28 days ({stats.previous28dEvents} events)
          </p>
        ) : (
          <p className="text-xs text-zinc-500">No prior 28-day baseline</p>
        )}
      </div>
      <ol
        aria-label="Last twelve rolling seven-day activity intervals; commits excluded"
        className="grid h-44 grid-cols-12 items-end gap-1 border-b border-white/10 pb-2 sm:h-52 sm:gap-2"
      >
        {stats.weeks.map((week, index) => (
          <li key={week.start} className="group flex h-full min-w-0 flex-col items-center justify-end gap-2" title={`${week.start} to ${week.end}: ${week.n} events`}>
            <span className="sr-only">{week.start}: {week.n} events</span>
            <div className="flex h-full w-full items-end">
              <div
                className={`w-full rounded-t-md transition-[height] duration-500 motion-reduce:transition-none ${index === 11 ? "bg-lime-300" : "bg-sky-400/70 group-hover:bg-sky-300"}`}
                style={{ height: week.n === 0 ? "2px" : `${Math.max(5, (week.n / peak) * 100)}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="hidden shrink-0 text-[10px] tabular-nums text-zinc-500 sm:block">{week.start.slice(5)}</span>
            <span className="text-[9px] tabular-nums text-zinc-600 sm:hidden">{index % 3 === 0 ? week.start.slice(5) : " "}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs leading-5 text-zinc-500">
        Rolling 7-day buckets ending at the archive snapshot, not a commit-frequency graph.
        Private events contribute only anonymous type and date counts.
      </p>
    </div>
  );
}

function Mix({ stats }: { stats: DevStats }) {
  const max = Math.max(1, ...stats.mix.map((row) => row.n));
  return (
    <ul className="space-y-3">
      {stats.mix.filter((row) => row.n > 0).map((row) => (
        <li key={row.category}>
          <div className="mb-1 flex justify-between gap-3 text-xs">
            <span className="text-zinc-300">{row.category}</span>
            <span className="tabular-nums text-zinc-400">{integer.format(row.n)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-sky-400" style={{ width: `${(row.n / max) * 100}%` }} />
          </div>
        </li>
      ))}
      {stats.mix.every((row) => row.n === 0) ? (
        <li className="text-sm text-zinc-500">No events in this snapshot window.</li>
      ) : null}
    </ul>
  );
}

function CommitHistory({ stats }: { stats: DevStats }) {
  const recent = stats.yearlyCommits.slice(-9);
  const max = Math.max(1, ...recent.map((r) => r.publicCount + r.privateCount));
  return (
    <section aria-labelledby="commit-history-title" className="mt-5 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-sky-300">Years in code</p>
          <h2 id="commit-history-title" className="mt-2 text-xl font-semibold">Commit history</h2>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-400">
          <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" />Public</span>
          <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-violet-400/80" />Private</span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        GitHub contribution-graph counts by year. No private repositories, SHAs, or patches exposed.
        Annual commit totals are not folded into event velocity or upstream salvage.
      </p>
      <ol className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-9">
        {recent.map((r) => {
          const height = ((r.publicCount + r.privateCount) / max) * 100;
          const total = r.publicCount + r.privateCount || 1;
          return (
            <li key={r.year} className="flex min-w-0 flex-col">
              <div className="flex h-36 items-end">
                <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-md bg-zinc-800" style={{ height: `${Math.max(2, height)}%` }}>
                  <div className="bg-violet-400/80" style={{ height: `${(r.privateCount / total) * 100}%` }} />
                  <div className="bg-sky-400" style={{ height: `${(r.publicCount / total) * 100}%` }} />
                </div>
              </div>
              <div className="mt-2 text-center text-xs font-medium tabular-nums text-zinc-200">{r.year}</div>
              <div className="text-center text-[11px] tabular-nums text-zinc-500">{integer.format(r.publicCount + r.privateCount)}</div>
              <span className="sr-only">{r.year}: {r.publicCount} public and {r.privateCount} private commits</span>
            </li>
          );
        })}
      </ol>
      {recent.length === 0 ? <p className="mt-4 text-sm text-zinc-500">No yearly commit records in this snapshot.</p> : null}
    </section>
  );
}

function Salvage({ stats }: { stats: DevStats }) {
  return (
    <section aria-labelledby="salvage-title" className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-lime-300">Code that made it upstream</p>
          <h2 id="salvage-title" className="mt-2 text-xl font-semibold">Salvage ledger</h2>
        </div>
        <p className="rounded-full border border-lime-300/20 bg-lime-300/10 px-3 py-1 text-xs text-lime-200">
          {integer.format(stats.verifiedSalvagedCommits)} confirmed SHAs
        </p>
      </div>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-400">
        Verified cherry-picks and maintainer consolidations with original source-commit or
        source-PR evidence. Only {stats.salvageTrackedRepos} tracked upstream repositories,
        last checked {stats.salvageCoverageDate}. This is a lower bound, not an exhaustive
        count. Credit belongs to the original authors and upstream maintainers.
      </p>
      <ul className="mt-5 divide-y divide-white/10">
        {stats.salvaged.slice(0, 5).map((commit) => (
          <li key={commit.sha} className="py-3">
            <a href={commit.url} target="_blank" rel="noreferrer" className="group block rounded-lg hover:text-lime-200">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                <span>{commit.repo}</span>
                <span className="font-mono">{commit.sha.slice(0, 9)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-medium text-zinc-200 group-hover:text-lime-200">
                {commit.title}
              </p>
              <span className="mt-1 block text-[11px] text-zinc-500">
                {commit.landing === "cherry-picked" ? "Cherry-picked" : "Maintainer-consolidated"}
                {commit.sourcePRs.length ? ` · source PR #${commit.sourcePRs.join(", #")}` : ""}
              </span>
            </a>
          </li>
        ))}
        {stats.salvaged.length === 0 ? <li className="py-4 text-sm text-zinc-500">No verified salvage records in this partial ledger.</li> : null}
      </ul>
    </section>
  );
}

export default function StatsPage() {
  const { archive, manifest } = compilePublicSnapshot(PUBLIC_DB_PATH);
  const ledger = projectPublicUpstreamLandings(
    JSON.parse(readFileSync(path.join(process.cwd(), "data", "upstream-landings.json"), "utf8")) as unknown,
  );
  const stats = buildDevStats(archive, ledger, manifest.lastCheckedAt);
  const snapshotAgeDays = Math.max(0, Math.floor((Date.now() - Date.parse(stats.asOf)) / 86_400_000));
  const staleSnapshot = !Number.isFinite(snapshotAgeDays) || snapshotAgeDays >= 3;
  const topRepos = archive.byRepo.slice(0, 5);
  const maxRepo = Math.max(1, ...topRepos.map((repo) => repo.n));

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
      <section className="relative overflow-hidden rounded-3xl border border-lime-300/15 bg-gradient-to-br from-zinc-900 via-zinc-950 to-sky-950/70 px-5 py-8 sm:px-10 sm:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-36 h-80 w-80 rounded-full bg-lime-300/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-lime-300">Build record // public-safe</span>
            <Link href="/" className="text-xs text-zinc-400 underline-offset-4 hover:text-zinc-100 hover:underline">Explore the ledger</Link>
          </div>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
            Developer <span className="text-lime-300">velocity.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
            Not just commits. PRs, issues, reviews, momentum, and proven code salvaged upstream.
            Everything counted from the archive, nothing guessed.
          </p>
          <div className="mt-8 flex flex-wrap items-end gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-zinc-500">Recent event pace</p>
              <p className="font-mono text-5xl font-semibold tracking-tight tabular-nums text-white sm:text-7xl">
                {decimal.format(stats.velocityPerWeek)}
                <span className="ml-2 text-sm font-normal text-zinc-400 sm:text-lg">/ week</span>
              </p>
            </div>
            {stats.recordWeek ? (
              <span className="rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-lime-300">
                {staleSnapshot ? "Snapshot 12-week high" : "New 12-week record"}
              </span>
            ) : null}
          </div>
          <p className="mt-5 font-mono text-[11px] text-zinc-500">
            28-day rolling average · checked {stats.asOf.slice(0, 19).replace("T", " ")} UTC
          </p>
        </div>
      </section>

      {staleSnapshot ? (
        <div role="status" className="mt-5 rounded-xl border border-amber-300/30 bg-amber-300/5 px-4 py-3 text-xs leading-5 text-amber-200 sm:text-sm">
          Historical snapshot: the archive was last checked {stats.asOf.slice(0, 10)}.
          These are archived records, not verified current-week activity. A collector refresh is needed for live velocity.
        </div>
      ) : null}

      <section aria-label="Key GitHub statistics" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Score label="Commits" value={stats.publicCommits + stats.privateCommits} note={`${integer.format(stats.publicCommits)} public · ${integer.format(stats.privateCommits)} private · yearly buckets`} accent="text-sky-200" />
        <Score label="PRs merged" value={stats.mergedPublicPRs} note={`Public authored PRs · ${integer.format(stats.publicPRs)} total · state at snapshot`} accent="text-lime-300" />
        <Score label="Issues opened" value={stats.issuesCreated} note="Authored issues · private records anonymous" />
        <Score label="Commits salvaged" value={stats.verifiedSalvagedCommits} note={`Explicit upstream provenance · checked ${stats.salvageCoverageDate} · partial coverage`} accent="text-amber-200" />
      </section>

      <section className="mt-5 grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-6">
          <WeekChart stats={stats} />
        </div>
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-6">
          <h2 className="text-base font-semibold">The last 28 days</h2>
          <div className="mt-5 grid grid-cols-3 gap-2 border-b border-white/10 pb-5">
            <div><p className="text-2xl font-semibold tabular-nums">{integer.format(stats.last28dEvents)}</p><p className="mt-1 text-[11px] text-zinc-500">Events</p></div>
            <div><p className="text-2xl font-semibold tabular-nums">{integer.format(stats.activeDays28d)}</p><p className="mt-1 text-[11px] text-zinc-500">Active days</p></div>
            <div><p className="text-2xl font-semibold tabular-nums">{integer.format(stats.eventStreakDays)}</p><p className="mt-1 text-[11px] text-zinc-500">Day streak</p></div>
          </div>
          <div className="mt-5"><Mix stats={stats} /></div>
        </div>
      </section>

      <CommitHistory stats={stats} />

      <section className="mt-5 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
        <Salvage stats={stats} />
        <section aria-labelledby="repos-title" className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-6">
          <p className="text-xs uppercase tracking-widest text-sky-300">Where the work happens</p>
          <h2 id="repos-title" className="mt-2 text-xl font-semibold">Top public repositories</h2>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Ranked by archived events, not stars, LOC or commits. Private repositories are never identified.
          </p>
          <ol className="mt-5 space-y-5">
            {topRepos.map((row, index) => (
              <li key={row.repo}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-zinc-300">
                    <span className="mr-2 font-mono text-zinc-600">{String(index + 1).padStart(2, "0")}</span>
                    {row.repo}
                  </span>
                  <span className="tabular-nums text-zinc-400">{integer.format(row.n)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-sky-400/80" style={{ width: `${row.n / maxRepo * 100}%` }} />
                </div>
              </li>
            ))}
            {topRepos.length === 0 ? <li className="text-sm text-zinc-500">No public repository rows yet.</li> : null}
          </ol>
        </section>
      </section>

      <footer className="mt-8 space-y-2 text-xs leading-5 text-zinc-500">
        <p>
          <strong className="font-medium text-zinc-300">Counting rules:</strong> Weekly velocity measures archived activity events, not commits or hours worked.
          Commits are year-level GitHub contribution totals. PR merged status is current at collection; PR creation time is not a merge timestamp.
          Salvaged means a verified, uniquely identified upstream commit with explicit source provenance—not any mention or review.
        </p>
        <p>
          Verified salvage covers only the tracked upstream subset. Figures can lag ingestion, and missing records never imply zero work.
          Source inspiration: <a href="https://x.com/poteto/status/2114535806199275809" target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">Lauren (poteto)</a>;
          original post image was not inspected or reused. Data from the <Link href="/" className="text-sky-300 hover:underline">public-safe archive</Link>.
        </p>
      </footer>
    </main>
  );
}
