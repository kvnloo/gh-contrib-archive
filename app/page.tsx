import ArchiveExplorer from "@/components/ArchiveExplorer";
import { PUBLIC_DB_PATH } from "@/lib/db";
import { compilePublicSnapshot } from "@/lib/public-snapshot";

export default function Home() {
  const { archive, manifest } = compilePublicSnapshot(PUBLIC_DB_PATH);
  return <ArchiveExplorer archive={archive} manifest={manifest} />;
}
