import { HBars, MonthHeat, TypeMix, YearBars } from "@/components/charts";
import { queryContributions } from "@/lib/query";

export const dynamic = "force-dynamic";

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

function severityClass(severity: string) {
  if (severity === "bad") return "bg-red-500/15 text-red-300 ring-red-500/30";
  if (severity === "warn") return "bg-amber-500/15 text-amber-200 ring-amber-500/30";
  return "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30";
}

function isPublicUrl(url: string) {
  return url.startsWith("https://github.com/");
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    flag?: string;
    repo?: string;
    q?: string;
    year?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? "0") || 0);
  const limit = 50;
  const data = queryContributions({
    type: sp.type || undefined,
    flag: sp.flag || undefined,
    repo: sp.repo || undefined,
    q: sp.q || undefined,
    year: sp.year || undefined,
    limit,
    offset: page * limit,
  });

  const qs = (over: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const next = {
      type: sp.type,
      flag: sp.flag,
      repo: sp.repo,
      q: sp.q,
      year: sp.year,
      page,
      ...over,
    };
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== "" && v !== 0) u.set(k, String(v));
    }
    const s = u.toString();
    return s ? `/?${s}` : "/";
  };

  const publicCommitRows = data.commitBuckets
    .filter((b) => b.visibility === "public")
    .slice(0, 16)
    .map((b) => ({
      label: `${b.year} · ${b.repo}`,
      n: b.commit_count,
      href: b.html_url ?? undefined,
    }));
  const privateCommitsByYear = data.commitBuckets.filter((b) => b.visibility === "private");

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">GitHub contribution archive</p>
        <h1 className="text-3xl font-semibold tracking-tight">Everything @kvnloo left on GitHub</h1>
        <p className="max-w-3xl text-sm leading-6 text-zinc-400">
          <a href="/worlds" className="text-sky-300 hover:underline">Five graph worlds</a>
          {' '}· public issues, PRs, and comments are linked. Private repositories only appear as a count
          and a date — no titles, messages, diffs, or URLs. Same for commits: public commit lists
          go to GitHub; private commits are a yearly total.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="public records" value={data.stats.public_n} />
        <Stat label="private records" value={data.stats.private_n} />
        <Stat label="public commits" value={data.stats.public_commits} />
        <Stat label="private commits" value={data.stats.private_commits} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800">
          <h2 className="text-sm font-medium">By year</h2>
          <YearBars rows={data.byYear} />
        </div>
        <div className="rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800">
          <h2 className="text-sm font-medium">Type mix</h2>
          <div className="mt-4">
            <TypeMix rows={data.byType} />
          </div>
        </div>
        <div className="rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800 lg:col-span-2">
          <h2 className="text-sm font-medium">Monthly activity</h2>
          <p className="mt-1 text-xs text-zinc-500">Includes private events as anonymous counts.</p>
          <div className="mt-4">
            <MonthHeat rows={data.byMonth} />
          </div>
        </div>
        <div className="rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800">
          <h2 className="text-sm font-medium">Public repos</h2>
          <div className="mt-4">
            <HBars
              rows={data.byRepo.map((r) => ({ label: r.repo, n: r.n }))}
              hrefFor={(label) => `/?repo=${encodeURIComponent(label)}`}
            />
          </div>
        </div>
        <div className="rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800">
          <h2 className="text-sm font-medium">Public commit volume</h2>
          <p className="mt-1 text-xs text-zinc-500">Links open GitHub&apos;s author commit list, not patches.</p>
          <div className="mt-4">
            <HBars rows={publicCommitRows} />
          </div>
          {privateCommitsByYear.length > 0 ? (
            <ul className="mt-4 space-y-1 text-xs text-zinc-500">
              {privateCommitsByYear.map((b) => (
                <li key={b.year}>
                  {b.year}: {b.commit_count} private commits (no repo or message)
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {data.byFlag.length > 0 ? (
        <section className="flex flex-wrap gap-2 text-xs">
          {data.byFlag.map((f) => (
            <a
              key={f.code}
              href={`/?flag=${f.code}`}
              className={`rounded-full px-3 py-1 ring-1 ${severityClass(f.severity)}`}
            >
              {f.code} {f.n}
            </a>
          ))}
        </section>
      ) : null}

      <form className="grid gap-3 rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800 sm:grid-cols-5">
        <select name="type" defaultValue={sp.type ?? ""} className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800">
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t || "all types"}
            </option>
          ))}
        </select>
        <select name="flag" defaultValue={sp.flag ?? ""} className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800">
          {FLAGS.map((t) => (
            <option key={t} value={t}>
              {t || "all flags"}
            </option>
          ))}
        </select>
        <input name="year" defaultValue={sp.year ?? ""} placeholder="year" className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800" />
        <input name="repo" defaultValue={sp.repo ?? ""} placeholder="public repo" className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800" />
        <input name="q" defaultValue={sp.q ?? ""} placeholder="search public text" className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800" />
        <button className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 sm:col-span-5">
          Filter
        </button>
      </form>

      <p className="text-sm text-zinc-500">
        Showing {data.items.length} of {data.total}
      </p>

      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl ring-1 ring-zinc-800">
        {data.items.length === 0 ? (
          <li className="p-8 text-sm text-zinc-500">No rows. Run npm run ingest.</li>
        ) : (
          data.items.map((item) => {
            const pub = item.visibility === "public" && isPublicUrl(item.url);
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 bg-zinc-900/40 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono">{item.type}</span>
                    <span>{item.created_at.slice(0, 10)}</span>
                    {pub && item.repo ? <span>{item.repo}</span> : null}
                    {item.visibility === "private" ? (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5">private</span>
                    ) : null}
                  </div>
                  {pub ? (
                    <a
                      href={item.url}
                      className="mt-1 block truncate text-sm font-medium text-sky-300 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.title || item.url}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-zinc-300">Private {item.type.replace("_", " ")} exists</p>
                  )}
                  {pub && item.excerpt ? (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{item.excerpt}</p>
                  ) : null}
                </div>
                {pub ? (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {item.flags.map((f) => (
                      <span
                        key={f.code}
                        className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${severityClass(f.severity)}`}
                        title={f.detail}
                      >
                        {f.code}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      <nav className="flex justify-between text-sm">
        {page > 0 ? (
          <a href={qs({ page: page - 1 })} className="text-sky-300 hover:underline">
            Previous
          </a>
        ) : (
          <span />
        )}
        {(page + 1) * limit < data.total ? (
          <a href={qs({ page: page + 1 })} className="text-sky-300 hover:underline">
            Next
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
      <div className="text-2xl font-semibold tabular-nums">{value ?? 0}</div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}
