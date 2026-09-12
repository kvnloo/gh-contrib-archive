import { queryContributions } from "@/lib/query";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SanityPage() {
  const data = queryContributions({ limit: 1 });
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Sanity check</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        {data.stats.public_n} public records and {data.stats.private_n} private records (details
        withheld). {data.stats.public_commits} public commits linked as author lists;{" "}
        {data.stats.private_commits} private commits counted only.
      </p>
      <ul className="mt-6 list-disc space-y-3 pl-5 text-sm leading-6 text-zinc-300">
        <li>
          The public site never stores private titles, excerpts, repo names, SHAs, or GitHub
          URLs. Private rows are “this {`{type}`} existed on {`{date}`}.”
        </li>
        <li>
          Public OSS comments are mostly specific. The one generic-AI regex hit is a withdrawal
          comment on a public NousResearch PR, not a generated essay.
        </li>
        <li>
          Agent KEEP/H01 templates and Cursor PR markers show up on public activity and are
          flagged — not hidden.
        </li>
      </ul>
      <Link href="/" className="mt-8 inline-block text-sm text-sky-300 hover:underline">
        Back to visualization
      </Link>
    </main>
  );
}
