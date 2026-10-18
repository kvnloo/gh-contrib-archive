import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  projectPublicUpstreamLandings,
  writePublicUpstreamLandings,
} from "../lib/upstream-landings.ts";

const fixture = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), "data", "upstream-landings.json"), "utf8",
)) as Record<string, unknown>;

const clone = () => structuredClone(fixture) as any;

describe("verified upstream landings", () => {
  it("includes SHA-grounded Omarchy consolidation and Hermes ancestry records", () => {
    const data = projectPublicUpstreamLandings(clone());
    const omarchy = data.repositories["omacom/omarchy"];
    const hermes = data.repositories["NousResearch/hermes-agent"];
    assert.equal(omarchy.upstreamBranch, "quattro");
    assert.equal(hermes.upstreamBranch, "main");
    assert.equal(omarchy.coverage.complete, false);
    assert.ok(hermes.commits.length >= 36);

    const landing = omarchy.commits.find(
      (entry) => entry.sha === "75250d37acdf19121efe2af85b3732b8cf248980",
    );
    assert.equal(landing?.landing, "maintainer-consolidated");
    assert.equal(landing?.credit, "co-authored");
    assert.deepEqual(landing?.sourcePRs, [13209]);
    assert.equal(landing?.landingPR, 14049);
    assert.equal(
      new Set(hermes.commits.map((entry) => entry.sha)).size,
      hermes.commits.length,
    );
    assert.ok(hermes.commits.some((entry) => entry.credit === "review-acknowledged"));
  });

  it("rejects private repo injection even when labeled public-safe", () => {
    const input = clone();
    input.repositories["secret/internal"] = input.repositories["omacom/omarchy"];
    assert.throws(() => projectPublicUpstreamLandings(input), /unapproved/);
  });

  it("rejects false landings, bad URLs, and duplicate SHAs", () => {
    const input = clone();
    input.repositories["omacom/omarchy"].coverage.complete = true;
    assert.throws(() => projectPublicUpstreamLandings(input), /completeness/);

    const spoofed = clone();
    spoofed.repositories["omacom/omarchy"].commits[0].url =
      "https://example.com/fake";
    assert.throws(() => projectPublicUpstreamLandings(spoofed), /evidence/);

    const repeated = clone();
    const rows = repeated.repositories["omacom/omarchy"].commits;
    rows.push(structuredClone(rows[0]));
    assert.throws(() => projectPublicUpstreamLandings(repeated), /duplicate/);
  });

  it("exports a stable, strictly public-safe read model", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-landings-"));
    try {
      const result = writePublicUpstreamLandings(
        path.join(process.cwd(), "data", "upstream-landings.json"),
        root,
      );
      const file = path.join(root, result.href);
      const published = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.match(result.revision, /^[a-f0-9]{64}$/);
      assert.equal(published.privacy, "public-safe");
      assert.equal(published.revision, result.revision);
      assert.equal(
        result.count,
        Object.values(published.repositories).reduce(
          (n: number, r: any) => n + r.commits.length, 0,
        ),
      );
      assert.equal(published.repositories["secret/internal"], undefined);
      assert.equal(fs.readFileSync(file, "utf8").includes("GH_ARCHIVE_TOKEN"), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
