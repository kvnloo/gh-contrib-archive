import path from "node:path";
import { writeAgentBootstrap } from "../lib/agent-bootstrap.ts";
import { ATTENTION_DB_PATH } from "../lib/attention-db.ts";
import { PUBLIC_DB_PATH } from "../lib/db.ts";
import { writePublicApi } from "../lib/public-api.ts";

const outputRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "public"));
const api = writePublicApi(PUBLIC_DB_PATH, ATTENTION_DB_PATH, outputRoot);
const bootstrap = writeAgentBootstrap(api, outputRoot);

console.log(
  [
    `public API schema v${api.index.schemaVersion}`,
    `${api.attention.count} attention rows`,
    `${bootstrap.count} bootstrap actions`,
    `${api.repos.count} public repos`,
    `${api.threadResources.size} thread shards`,
    `updated ${api.index.generatedAt}`,
  ].join(" · "),
);
