#!/usr/bin/env python3
"""Read-only P07 proof. Run on MBP with frozen public evidence, never private data."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile

BASE = "https://kvnloo.github.io/gh-contrib-archive/"
E = Path(sys.argv[1] if len(sys.argv) > 1 else "evidence").resolve()
OUT = Path("qualification-results").resolve()
OUT.mkdir(exist_ok=True)
checks = []


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + "\n")


def check(name, passed, detail):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})
    print(json.dumps(checks[-1]), flush=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url):
    receipt = json.loads((E / "frozen-http.json").read_text())[url]
    body = (E / receipt["file"]).read_bytes()
    if receipt["status"] != 200:
        raise ValueError("non-200 frozen evidence: " + url)
    return body, {**receipt, "bytes": len(body), "sha256": digest(body)}


def run(name, command, cwd):
    result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (OUT / (name + ".log")).write_text("COMMAND " + repr(command) + "\n" + result.stdout + "\nEXIT " + str(result.returncode) + "\n")
    check(name, result.returncode == 0, {"command": command, "exit": result.returncode})
    return result


for name in ["archive", "civ"]:
    target = OUT / name
    target.mkdir(exist_ok=True)
    with tarfile.open(E / (name + "-source.tar")) as bundle:
        bundle.extractall(target, filter="data")

# Compare actual live files to the successful Pages artifact, not a workflow head.
live = {"index.html": E / "archive.html", "worlds/index.html": E / "worlds.html", "data/manifest.json": E / "data-manifest.json", "data/archive.json": E / "data-archive.json", "world-graph.json": E / "world-graph.json"}
comparisons = []
with tarfile.open(E / "served-artifact/artifact.tar") as bundle:
    members = {m.name.removeprefix("./"): m for m in bundle.getmembers() if m.isfile()}
    (OUT / "artifact-files.txt").write_text("\n".join(sorted(members)) + "\n")
    for name, local in live.items():
        member = members.get(name)
        if member is None:
            check("artifact:" + name, False, "file absent from artifact")
            continue
        expected = bundle.extractfile(member).read()
        actual = local.read_bytes()
        row = {"path": name, "served_sha256": digest(actual), "artifact_sha256": digest(expected), "equal": actual == expected}
        comparisons.append(row)
        check("artifact:" + name, row["equal"], row)
    # Every JS chunk on the observed pages must match the same artifact.
    sources = sorted(set(re.findall(r'<script[^>]+src="([^"]+)"', (E / "archive.html").read_text() + (E / "worlds.html").read_text())))
    for source in sources:
        name = source.removeprefix("/gh-contrib-archive/")
        actual, receipt = fetch("https://kvnloo.github.io" + source)
        expected = bundle.extractfile(members[name]).read()
        receipt["artifact_sha256"] = digest(expected)
        check("script:" + name, actual == expected, receipt)
    metadata = [name for name in members if re.search(r'(release|build-info|version)[^/]*\.json$', name) and name.count("/") < 4]
    save("artifact-metadata.json", {name: json.loads(bundle.extractfile(members[name]).read()) for name in metadata})
save("artifact-comparison.json", comparisons)

archive = json.loads((E / "data-archive.json").read_text())
graph = json.loads((E / "world-graph.json").read_text())
manifest = json.loads((E / "data-manifest.json").read_text())
items = archive["items"]
nodes = graph["nodes"]
check("archive-world-ID-coverage", {r["id"] for r in items} == {r["id"] for r in nodes}, {"archive": len(items), "world_nodes": len(nodes)})
private_items = [r for r in items if r["visibility"] == "private"]
private_nodes = [r for r in nodes if r["visibility"] == "private"]
check("private-record-redaction", all(set(r) == {"id", "type", "visibility", "created_at"} for r in private_items) and all(set(r) == {"id", "type", "visibility", "created"} for r in private_nodes), {"archive_private": len(private_items), "world_private": len(private_nodes)})
public_ids = {r["id"] for r in items if r["visibility"] == "public"}
check("public-only-graph-edges", all(r["source"] in public_ids and r["target"] in public_ids for r in graph["edges"]), {"edges": len(graph["edges"])})

with sqlite3.connect("file:" + str(E / "served-public.db") + "?mode=ro", uri=True) as db:
    db.row_factory = sqlite3.Row
    db_counts = [dict(r) for r in db.execute("SELECT visibility,type,count(*) AS n,min(created_at) AS first_at,max(created_at) AS last_at FROM contributions GROUP BY visibility,type ORDER BY visibility,type")]
    db_ids = {r[0] for r in db.execute("SELECT id FROM contributions")}
    db_meta = dict(db.execute("SELECT key,value FROM meta"))
check("database-archive-ID-coverage", db_ids == {r["id"] for r in items}, {"database": len(db_ids), "archive": len(items)})
save("source-coverage.json", {"counts_by_visibility_and_type": db_counts, "manifest": manifest, "database_meta": db_meta, "warning": "Counts reconcile the archived database only. They do not prove all GitHub history was collected."})

civ = OUT / "civ"
spec = importlib.util.spec_from_file_location("oss_strategy", civ / "tools/oss_strategy.py")
strategy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(strategy)
routes, waves = strategy.load_documents(civ)
joined = strategy.compile_snapshot(routes, waves, E / "served-public.db")
save("civ-join.json", joined)
resolved = [ref for ref, result in joined["refs"].items() if result["status"] == "resolved"]
unresolved = [ref for ref, result in joined["refs"].items() if result["status"] == "unresolved"]
check("existing-civ-resolver", bool(resolved), {"resolved": len(resolved), "unresolved": unresolved, "routes": len(routes["routes"]), "waves": len(waves["waves"])})
# Prefer a root issue/PR with a canonical API timestamp, not an invented sample.
candidates = [r for r in items if r["visibility"] == "public" and r["url"] in resolved and r["type"] in {"pull_request", "issue"}]
example = next((r for r in candidates if r["url"] == "https://github.com/gazebosim/gz-sensors/pull/664"), candidates[0])
node = next(r for r in nodes if r["id"] == example["id"])
ref = example["url"]
api = ref.replace("https://github.com/", "https://api.github.com/repos/").replace("/pull/", "/pulls/")
canonical_bytes, receipt = fetch(api)
canonical = json.loads(canonical_bytes)
save("canonical-example.json", canonical)
save("canonical-http.json", receipt)
check("canonical-source-and-date", canonical["created_at"] == example["created_at"] == node["created"] and canonical["html_url"] == ref and example["id"] in joined["refs"][ref]["contribution_ids"], {"id": example["id"], "url": ref, "created_at": example["created_at"], "graph_created": node["created"], "github_created_at": canonical["created_at"], "github_updated_at": canonical["updated_at"], "archived_updated_at": example["updated_at"]})
save("example.json", {"archive": example, "world_node": node, "trade_route_join": joined["refs"][ref], "trade_routes": [r["id"] for r in routes["routes"] if any(ref in e.get("evidence_refs", []) for e in r.get("edges", []))], "deep_link": BASE + "?repo=" + example["repo"] + "&q=" + ref})

# Test the exact frontend revision, including filters against served, not synthetic, rows.
frontend = OUT / "archive"
# These existing tests read the canonical public ledger at data/public.db.
shutil.copyfile(E / "served-public.db", frontend / "data/public.db")
filter_program = '''import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {filterArchiveItems,pageArchiveItems} from './lib/archive-filter.ts';
import {compilePublicSnapshot} from './lib/public-snapshot.ts';
const e=process.argv[2];
const a=JSON.parse(fs.readFileSync(e+'/data-archive.json'));
const g=JSON.parse(fs.readFileSync(e+'/world-graph.json'));
const m=JSON.parse(fs.readFileSync(e+'/data-manifest.json'));
const example=JSON.parse(fs.readFileSync('../example.json')).archive;
const filters={repo:example.repo,q:example.url,type:example.type,year:example.created_at.slice(0,4)};
const filtered=filterArchiveItems(a.items,filters);
assert(filtered.some(r=>r.id===example.id));
assert(filtered.every(r=>r.visibility==='public'));
assert(pageArchiveItems(a.items,filters,0,50).items.some(r=>r.id===example.id));
assert.equal(filterArchiveItems(a.items,{q:'P07-no-such-contribution-8c04417e'}).length,0);
assert.equal(filterArchiveItems(a.items,{}).length,a.items.length);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
assert.equal(sha(a),m.hashes.archiveSha256);
assert.equal(sha(g),m.hashes.worldGraphSha256);
const built=compilePublicSnapshot(e+'/served-public.db');
assert.deepEqual(built.archive,a);
assert.deepEqual(built.worldGraph,g);
assert.deepEqual(built.manifest,m);
console.log(JSON.stringify({example:example.id,filters,matches:filtered.length,emptyQuery:0,clear:a.items.length,recompiledSnapshot:'equal',manifestHashes:'equal'}));
'''
(frontend / "p07-check.mjs").write_text(filter_program)
run("served-data-filter-and-recompile", ["node", "--experimental-strip-types", "p07-check.mjs", str(E)], frontend)
run("archive-tests", ["node", "--experimental-strip-types", "--test", *[str(p.relative_to(frontend)) for p in sorted((frontend / "tests").glob("*.test.ts"))]], frontend)
run("civ-tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_oss_strategy.py", "-v"], civ)
run("civ-real-CLI", [sys.executable, "tools/oss_strategy.py", "--archive-db", str(E / "served-public.db")], civ)

# HTTP reachability is recorded separately from browser behavior.
for route in ["worlds/mycelium/", "worlds/night/", "worlds/phase/", "worlds/metro/", "worlds/constellation/"]:
    body, receipt = fetch(BASE + route)
    (OUT / (route.strip("/").replace("/", "-") + ".html")).write_bytes(body)
    check("HTTP:" + route, receipt["status"] == 200, receipt)
save("checks.json", checks)
save("limits.json", {"browser_interactions": "NOT RUN: installed Jev runner requires credentials and model calls, forbidden by execution contract", "civ_live_UI": "NOT RUN; existing read-only strategy resolver was executed against the real public ledger", "upstream_completeness": "UNKNOWN; no full resync performed", "capability_progress": "NOT inferred from activity"})
print("P07 CHECK SUMMARY", sum(c["passed"] for c in checks), "/", len(checks), flush=True)
sys.exit(0 if all(c["passed"] for c in checks) else 1)
