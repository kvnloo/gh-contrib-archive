import { publicAssetPath } from "@/lib/public-path";

export function HBars({
  rows,
  hrefFor,
}: {
  rows: { label: string; n: number; href?: string }[];
  hrefFor?: (label: string) => string;
}) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-zinc-300">{r.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-500">{r.n}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-sky-400/80"
                style={{ width: `${(r.n / max) * 100}%` }}
              />
            </div>
          </>
        );
        const rawHref = r.href ?? hrefFor?.(r.label);
        const href = rawHref ? publicAssetPath(rawHref) : undefined;
        return (
          <li key={r.label}>
            {href ? (
              <a href={href} className="block rounded-md hover:bg-zinc-800/60">
                {inner}
              </a>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function YearBars({
  rows,
}: {
  rows: { year: string; n: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1 pt-6">
      {rows.map((r) => (
        <a
          key={r.year}
          href={publicAssetPath(`/?year=${r.year}`)}
          className="group flex min-w-10 flex-1 flex-col items-center gap-2"
          title={`${r.year}: ${r.n}`}
        >
          <span className="text-[11px] tabular-nums text-zinc-500">{r.n}</span>
          <div
            className="w-full rounded-t-md bg-sky-400/80 group-hover:bg-sky-300"
            style={{ height: `${Math.max(8, (r.n / max) * 140)}px` }}
          />
          <span className="text-[11px] text-zinc-400">{r.year}</span>
        </a>
      ))}
    </div>
  );
}

export function MonthHeat({ rows }: { rows: { month: string; n: number }[] }) {
  const map = new Map(rows.map((r) => [r.month, r.n]));
  const max = Math.max(...rows.map((r) => r.n), 1);
  const uniqueYears = [...new Set(rows.map((r) => r.month.slice(0, 4)))].sort();
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid grid-cols-[auto_repeat(12,minmax(1.6rem,1fr))] gap-1 text-[10px]">
        <span />
        {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m, i) => (
          <span key={`${m}-${i}`} className="text-center text-zinc-500">
            {m}
          </span>
        ))}
        {uniqueYears.map((year) => (
          <div key={year} className="contents">
            <span className="pr-2 text-zinc-500">{year}</span>
            {months.map((m) => {
              const key = `${year}-${m}`;
              const n = map.get(key) ?? 0;
              const t = n / max;
              const bg =
                n === 0
                  ? "bg-zinc-800"
                  : t > 0.66
                    ? "bg-sky-300"
                    : t > 0.33
                      ? "bg-sky-500"
                      : "bg-sky-800";
              return (
                <div
                  key={key}
                  title={`${key}: ${n}`}
                  className={`h-6 w-full rounded-sm ${bg}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TypeMix({ rows }: { rows: { type: string; n: number }[] }) {
  const total = rows.reduce((s, r) => s + r.n, 0) || 1;
  const colors = [
    "bg-sky-400",
    "bg-violet-400",
    "bg-emerald-400",
    "bg-amber-400",
    "bg-rose-400",
    "bg-cyan-400",
    "bg-fuchsia-400",
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 overflow-hidden rounded-full">
        {rows.map((r, i) => (
          <div
            key={r.type}
            className={colors[i % colors.length]}
            style={{ width: `${(r.n / total) * 100}%` }}
            title={`${r.type}: ${r.n}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400 sm:grid-cols-2">
        {rows.map((r, i) => (
          <li key={r.type} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${colors[i % colors.length]}`} />
              {r.type}
            </span>
            <span className="tabular-nums">{r.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
