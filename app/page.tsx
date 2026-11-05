import ArchiveExplorer from "@/components/ArchiveExplorer";
import { PUBLIC_DB_PATH } from "@/lib/db";
import { FEATURED, featuredSummary } from "@/lib/featured";
import { compilePublicSnapshot } from "@/lib/public-snapshot";

export default function Home() {
  const { archive, manifest } = compilePublicSnapshot(PUBLIC_DB_PATH);
  const now = new Date(manifest.lastCheckedAt);
  const featured = FEATURED.map((f) => featuredSummary(archive.items, f, now));
  return <ArchiveExplorer archive={archive} manifest={manifest} featured={featured} />;
}
