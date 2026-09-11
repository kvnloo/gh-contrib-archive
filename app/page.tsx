import { queryContributions } from "@/lib/query";

export const dynamic = "force-dynamic";

const TYPES = ["", "pull_request", "issue", "comment", "review", "review_comment", "discussion", "discussion_comment"];
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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; flag?: string; repo?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? "0") || 0);
  const limit = 60;
  const data = queryContributions({
    type: sp.type || undefined,
    flag: sp.flag || undefined,
    repo: sp.repo || undefined,
    q: sp.q || undefined,
    limit,
    offset: page * limit,
  });

  const qs = (over: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const next = { type: sp.type, flag: sp.flag, repo: sp.repo, q: sp.q, page, ...over };
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== "" && v !== 0) u.set(k, String(v));
    }
    const s = u.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">GitHub contribution archive</p>
        <h1 className="text-3xl font-semibold tracking-tight">@kvnloo</h1>
        <p className="max-w-3xl text-sm leading-6 text-zinc-400">
          Links to every issue, pull request, issue comment, discussion, and review GitHub will
          return for this account. Bodies are stored as short excerpts for sanity checks — not diffs
          or patches.{" "}
          <a href="/sanity" className="text-sky-300 hover:underline">
            Read the sanity notes
          </a>
          .
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="records" value={data.stats.total} />
        <Stat label="bad flags" value={data.stats.bad} />
        <Stat label="agent markers" value={data.stats.agent_marker} />
        <Stat label="empty bodies" value={data.stats.empty_body} />
      </section>

      <section className="flex flex-wrap gap-2 text-xs text-zinc-400">
        {data.byType.map((t) => (
          <span key={t.type} className="rounded-full bg-zinc-900 px-3 py-1 ring-1 ring-zinc-800">
            {t.type} {t.n}
          </span>
        ))}
      </section>

      <form className="grid gap-3 rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800 sm:grid-cols-4">
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
        <input name="repo" defaultValue={sp.repo ?? ""} placeholder="repo filter" className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800" />
        <input name="q" defaultValue={sp.q ?? ""} placeholder="search title / excerpt" className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800" />
        <button className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 sm:col-span-4">
          Filter
        </button>
      </form>

      <p className="text-sm text-zinc-500">
        Showing {data.items.length} of {data.total}
      </p>

      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl ring-1 ring-zinc-800">
        {data.items.length === 0 ? (
          <li className="p-8 text-sm text-zinc-500">No rows yet. Run <code>npm run ingest</code>.</li>
        ) : (
          data.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 bg-zinc-900/40 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono">{item.type}</span>
                  <span>{item.created_at.slice(0, 10)}</span>
                  {item.repo ? <span>{item.repo}</span> : null}
                  {item.state ? <span>{item.state}</span> : null}
                </div>
                <a href={item.url} className="mt-1 block truncate text-sm font-medium text-sky-300 hover:underline" target="_blank" rel="noreferrer">
                  {item.title || item.url}
                </a>
                {item.excerpt ? (
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{item.excerpt}</p>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600">No excerpt</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {item.flags.map((f) => (
                  <span key={f.code} className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${severityClass(f.severity)}`} title={f.detail}>
                    {f.code}
                  </span>
                ))}
              </div>
            </li>
          ))
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
