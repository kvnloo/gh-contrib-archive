"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import type { Drilldown, FeaturedRepo, Thread } from "@/lib/featured";

const KIND: Record<Thread["kind"], string> = { pull_request: "PR", issue: "Issue", thread: "Discussion" };
const day = (iso: string) => iso.slice(0, 10);

function Row({ t }: { t: Thread }) {
  return (
    <li className="fr-row">
      <a href={t.url} target="_blank" rel="noreferrer" className="fr-link">
        <span className="fr-kind">{KIND[t.kind]}{t.state ? ` · ${t.state.toLowerCase()}` : ""}</span>
        <span className="fr-title">{t.title}</span>
        <span className="fr-meta">
          {t.repo.split("/")[0]} #{t.number} · {day(t.lastActivity)} · {t.myEvents} {t.myEvents === 1 ? "event" : "events"}
          {t.stale ? <b className="fr-stale"> · quiet 30d+</b> : null}
        </span>
      </a>
    </li>
  );
}

/** Shows the first `limit` rows; the rest stay one tap away, so long histories never bury open work. */
function Section({ id, title, hint, threads, limit = 5 }: { id: string; title: string; hint: string; threads: Thread[]; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (!threads.length) return null;
  const shown = open ? threads : threads.slice(0, limit);
  return (
    <section className="fr-section" aria-labelledby={id}>
      <h2 id={id} className="fr-h2">{title} <span className="fr-count">{threads.length}</span></h2>
      <p className="fr-hint">{hint}</p>
      <ul className="fr-list">{shown.map((t) => <Row key={t.key} t={t} />)}</ul>
      {threads.length > limit ? (
        <button type="button" className="fr-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show fewer" : `Show ${threads.length - limit} more`}
        </button>
      ) : null}
    </section>
  );
}

export default function FeaturedRepoView({ repo, d, checkedAt }: { repo: FeaturedRepo; d: Drilldown; checkedAt: string }) {
  const t = repo.theme;
  const style = {
    "--fr-bg": t.bg, "--fr-panel": t.panel, "--fr-fg": t.fg, "--fr-muted": t.muted, "--fr-accent": t.accent,
    "--fr-accent2": t.accent2, "--fr-font": t.font, "--fr-display": t.display, "--fr-radius": t.radius,
    "--fr-case": t.caps ? "uppercase" : "none",
  } as CSSProperties;
  const fresh = d.inProgress.filter((x) => !x.stale).length;
  return (
    <div className="fr" style={style} data-featured={repo.slug}>
      <main className="fr-main">
        <Link href="/" className="fr-back">← all contributions</Link>
        <header className="fr-head">
          <p className="fr-eyebrow">{repo.repos.join(" + ")}</p>
          <h1 className="fr-h1">{repo.name}</h1>
          <p className="fr-tagline">
            {repo.tagline}
            {repo.site ? <> · <a href={repo.site} target="_blank" rel="noreferrer">{repo.site.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></> : null}
          </p>
        </header>
        <dl className="fr-stats">
          <div><dt>contributions</dt><dd>{d.totals.all.toLocaleString("en-US")}</dd></div>
          <div><dt>PRs merged</dt><dd>{d.totals.merged}</dd></div>
          <div><dt>open now</dt><dd>{d.inProgress.length}</dd></div>
          <div><dt>comments + reviews</dt><dd>{(d.totals.comments + d.totals.reviews).toLocaleString("en-US")}</dd></div>
        </dl>
        <p className="fr-focus" role="status">
          {fresh ? `${fresh} open ${fresh === 1 ? "item has" : "items have"} activity in the last 30 days` : "No open work with recent activity"}
          {d.first ? ` · active since ${day(d.first)}` : ""}
        </p>
        <Section id="fr-open" title="In progress" hint="Open PRs and issues Kevin opened. Recent first, PRs before issues; quiet ones sink." threads={d.inProgress} />
        <Section id="fr-recent" title="Recent conversations" hint="Threads he commented on or reviewed in the last 30 days." threads={d.recent} />
        {d.past.map((y) => (
          <Section key={y.year} id={`fr-past-${y.year}`} title={`Past · ${y.year}`} hint="Merged, closed and older threads." threads={y.threads} limit={3} />
        ))}
        <footer className="fr-foot">
          States as of the public snapshot checked {checkedAt.slice(0, 16).replace("T", " ")} UTC. Theme after {repo.themeSource}.
        </footer>
      </main>
    </div>
  );
}
