import Link from "next/link";
import { PUBLIC_DB_PATH } from "@/lib/db";
import { compilePublicSnapshot } from "@/lib/public-snapshot";

export default function SanityPage() {
  const { archive, manifest } = compilePublicSnapshot(PUBLIC_DB_PATH);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Sanity check</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        {archive.stats.public_n} public records and {archive.stats.private_n} private records
        (details withheld). {archive.stats.public_commits} public commits linked as author lists;{" "}
        {archive.stats.private_commits} private commits counted only.
      </p>
      <p className="mt-2 text-xs text-zinc-600">
        Snapshot checked {manifest.lastCheckedAt.slice(0, 19).replace("T", " ")} UTC · schema v{manifest.schemaVersion}
      </p>
      <ul className="mt-6 list-disc space-y-3 pl-5 text-sm leading-6 text-zinc-300">
        <li>
          The public site never stores private titles, excerpts, repo names, SHAs, or GitHub
          URLs. Private rows are only an opaque id, contribution type, and date.
        </li>
        <li>
          Private commit buckets contain year/count only. Repository names and commit URLs are
          structurally null in the public snapshot.
        </li>
        <li>
          Public quality flags remain visible rather than being hidden from the archive.
        </li>
      </ul>
      <Link href="/" className="mt-8 inline-block text-sm text-sky-300 hover:underline">
        Back to visualization
      </Link>
    </main>
  );
}
