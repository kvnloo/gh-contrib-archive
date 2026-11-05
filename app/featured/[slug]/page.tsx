import { notFound } from "next/navigation";
import FeaturedRepoView from "@/components/FeaturedRepoView";
import { PUBLIC_DB_PATH } from "@/lib/db";
import { FEATURED, drilldown, featuredBySlug } from "@/lib/featured";
import { compilePublicSnapshot } from "@/lib/public-snapshot";

export function generateStaticParams() {
  return FEATURED.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const f = featuredBySlug((await params).slug);
  return { title: f ? `${f.name} · kvnloo contributions` : "kvnloo contributions" };
}

export default async function FeaturedPage({ params }: { params: Promise<{ slug: string }> }) {
  const f = featuredBySlug((await params).slug);
  if (!f) return notFound();
  const { archive, manifest } = compilePublicSnapshot(PUBLIC_DB_PATH);
  // Snapshot time, not build time, decides "recent", so a rebuild never changes what counts as stale.
  const d = drilldown(archive.items, f.repos, new Date(manifest.lastCheckedAt));
  return <FeaturedRepoView repo={f} d={d} checkedAt={manifest.lastCheckedAt} />;
}
