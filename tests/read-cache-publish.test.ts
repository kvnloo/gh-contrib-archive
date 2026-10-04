import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const script = fileURLToPath(new URL("../scripts/publish-read-cache.sh", import.meta.url));

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

describe("connector-readable API cache", () => {
  it("publishes only validated JSON, is idempotent, and advances without force pushes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "read-cache-publish-"));
    const work = path.join(root, "work");
    const remote = path.join(root, "remote.git");
    try {
      run("git", ["init", "-b", "main", work], root);
      run("git", ["config", "user.name", "Fixture"], work);
      run("git", ["config", "user.email", "fixture@example.invalid"], work);
      fs.writeFileSync(path.join(work, "seed.txt"), "seed\n");
      run("git", ["add", "seed.txt"], work);
      run("git", ["commit", "-m", "seed"], work);
      const baseline = run("git", ["rev-parse", "HEAD"], work);
      run("git", ["branch", "read-cache"], work);
      run("git", ["init", "--bare", remote], root);
      run("git", ["remote", "add", "origin", remote], work);
      run("git", ["push", "origin", "main", "read-cache"], work);

      const api = path.join(work, "out", "api", "v1");
      fs.mkdirSync(api, { recursive: true });
      fs.writeFileSync(path.join(api, "index.json"), JSON.stringify({ generatedAt: "2026-10-04T05:00:00Z" }));
      fs.writeFileSync(path.join(api, "bootstrap.json"), JSON.stringify({ privacy: "public-safe" }));
      fs.writeFileSync(path.join(api, "attention.json"), JSON.stringify({ items: [{ number: 1 }] }));
      fs.writeFileSync(path.join(work, "out", "DO_NOT_COPY.txt"), "SYNTHETIC_SECRET_SENTINEL");

      const env1 = {
        ...process.env,
        READ_CACHE_BRANCH: "read-cache",
        READ_CACHE_SOURCE_DIR: "out/api/v1",
        READ_CACHE_SOURCE_SHA: "1".repeat(40),
      };
      run("bash", [script], work, env1);
      run("git", ["fetch", "origin", "read-cache"], work);
      const first = run("git", ["rev-parse", "origin/read-cache"], work);
      assert.notEqual(first, baseline);
      assert.equal(run("git", ["rev-parse", "origin/read-cache^"], work), baseline);

      const index = JSON.parse(run("git", ["show", "origin/read-cache:public/api/v1/index.json"], work));
      assert.equal(index.generatedAt, "2026-10-04T05:00:00Z");
      const meta = JSON.parse(run("git", ["show", "origin/read-cache:public/api/v1/connector-meta.json"], work));
      assert.equal(meta.sourceRevision, "1".repeat(40));
      assert.equal(meta.sourceGeneratedAt, "2026-10-04T05:00:00Z");
      assert.equal(meta.privacy, "public-safe");
      const privateProbe = spawnSync("git", ["show", "origin/read-cache:public/DO_NOT_COPY.txt"], { cwd: work, encoding: "utf8" });
      assert.notEqual(privateProbe.status, 0);

      run("bash", [script], work, env1);
      run("git", ["fetch", "origin", "read-cache"], work);
      assert.equal(run("git", ["rev-parse", "origin/read-cache"], work), first);

      fs.writeFileSync(path.join(api, "attention.json"), JSON.stringify({ items: [{ number: 1 }, { number: 2 }] }));
      run("bash", [script], work, { ...env1, READ_CACHE_SOURCE_SHA: "2".repeat(40) });
      run("git", ["fetch", "origin", "read-cache"], work);
      const second = run("git", ["rev-parse", "origin/read-cache"], work);
      assert.notEqual(second, first);
      assert.equal(run("git", ["rev-parse", "origin/read-cache^"], work), first);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
