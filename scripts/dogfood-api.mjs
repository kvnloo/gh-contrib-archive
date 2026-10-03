import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "out/api/v1");

function readJson(href) {
  const file = path.join(root, href);
  const raw = fs.readFileSync(file);
  return { file, bytes: raw.byteLength, value: JSON.parse(raw.toString("utf8")) };
}

function invariant(ok, message) {
  if (!ok) throw new Error(message);
}

const index = readJson("index.json").value;
const changes = readJson(index.endpoints.changes).value;
let resources = 0;
let repos = 0;
let threads = 0;

for (const [name, descriptor] of Object.entries(index.resources)) {
  const loaded = readJson(descriptor.href);
  invariant(
    loaded.value.revision === descriptor.revision,
    `${name}: descriptor revision ${descriptor.revision} != payload ${loaded.value.revision}`,
  );
  invariant(
    loaded.bytes === descriptor.bytes,
    `${name}: descriptor bytes ${descriptor.bytes} != emitted ${loaded.bytes}`,
  );
  resources += 1;
}

invariant(
  changes.revision === index.resources.changes.revision,
  "changes manifest revision disagrees with index",
);

for (const repo of changes.repos) {
  const loaded = readJson(repo.href);
  invariant(loaded.value.kind === "repo-context", `${repo.repo}: expected repo-context`);
  invariant(loaded.value.revision === repo.revision, `${repo.repo}: stale repo revision`);
  invariant(loaded.bytes === repo.bytes, `${repo.repo}: stale repo byte count`);
  repos += 1;

  for (const thread of loaded.value.threads ?? []) {
    const child = readJson(thread.href);
    invariant(child.value.kind === "thread-context", `${repo.repo}#${thread.number}: expected thread-context`);
    invariant(child.value.revision === thread.revision, `${repo.repo}#${thread.number}: stale thread revision`);
    invariant(child.value.repo === repo.repo, `${thread.href}: thread/repo identity mismatch`);
    invariant(child.value.number === thread.number, `${thread.href}: thread number mismatch`);
    threads += 1;
  }
}

console.log(
  `dogfood api: ${resources} top-level resources, ${repos} repo contexts, ${threads} thread contexts verified`,
);
