import { queryContributions } from "@/lib/query";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SanityPage() {
  const data = queryContributions({ limit: 1 });
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-sky-300 hover:underline">
        ← archive
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">Sanity check</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        {data.stats.total} records for @kvnloo (2016–2026). GitHub GraphQL returned 629 PRs, 308
        issues, 517 issue comments, 9 discussions, 2 discussion comments, plus 2 reviews and 18
        inline review comments from <code>reviewed-by</code> search. Most activity is 2025–2026.
      </p>
      <ul className="mt-6 list-disc space-y-3 pl-5 text-sm leading-6 text-zinc-300">
        <li>
          <strong className="text-zinc-100">Not a dump of LLM filler on public OSS.</strong> The
          single <code>generic_ai_slop</code> hit is a real withdrawal on{" "}
          <a className="text-sky-300 underline" href="https://github.com/NousResearch/hermes-agent/pull/87493#issuecomment-5421709927">
            hermes-agent#87493
          </a>{" "}
          that happens to include “I&apos;d be happy to…”. Substance is a scope-mismatch apology,
          not a generated essay.
        </li>
        <li>
          <strong className="text-zinc-100">Agent workflow is visible and repetitive.</strong>{" "}
          {data.stats.agent_marker} PRs still contain <code>CURSOR_AGENT_PR_BODY</code> markers
          (mostly your own repos). {data.stats.agent_template} comments on{" "}
          <code>NousResearch/hermes-agent</code> use KEEP / H01 triage templates — dense, not
          empty, but they will look like a bot to maintainers.
        </li>
        <li>
          <strong className="text-zinc-100">Empty and unfilled PRs in personal repos.</strong>{" "}
          {data.stats.empty_body} issues/PRs with no body, plus template leftovers (“## Description”
          with HTML placeholders) clustered on <code>kvnloo/evolve</code>. Late-2025 Claude branch
          titles on ace/lagless/portfolio are the sloppiest public titles.
        </li>
        <li>
          <strong className="text-zinc-100">Nothing extremely stupid on old history.</strong>{" "}
          Pre-2025 is small (HackIllinois, techradar). Short comments are human (“haha bro”, “cool
          my bad”). No leaked secrets in excerpts, no rage comments, no paste of huge generated
          READMEs into issues.
        </li>
      </ul>
    </main>
  );
}
