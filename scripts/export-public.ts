import path from "node:path";
import { PUBLIC_DB_PATH } from "../lib/db";
import { writePublicSnapshot } from "../lib/public-snapshot";

const outputRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "public"));
const snapshot = writePublicSnapshot(PUBLIC_DB_PATH, outputRoot);

console.log(
  [
    `public snapshot schema v${snapshot.manifest.schemaVersion}`,
    `${snapshot.manifest.counts.events} events`,
    `${snapshot.manifest.counts.commits} commits`,
    `checked ${snapshot.manifest.lastCheckedAt}`,
  ].join(" · "),
);
