import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, it } from "node:test";
import { probeUrl, compareRoutes, validateUrl } from "../scripts/probe-api.mjs";

const body = JSON.stringify({ schemaVersion: 1, privacy: "public-safe", items: [], note: "DO_NOT_LOG_BODY" });
const urls = ["https://a.example/api/v1/bootstrap.json", "https://b.example/api/v1/bootstrap.json"];
const ok = async () => new Response(body, { headers: { "content-type": "application/json", age: "4", "x-cache": "HIT" } });

describe("delivery probe", () => {
  it("measures decoded bytes and hashes, not response bodies", async () => {
    const row = await probeUrl(urls[0], { fetcher: ok });
    assert.equal(row.ok, true);
    assert.equal(row.decodedBytes, Buffer.byteLength(body));
    assert.match(row.bodyHash!, /^sha256:[a-f0-9]{64}$/);
    assert.ok(row.totalMs >= row.headersMs!);
    assert.equal(row.cache.age, "4");
    assert.equal(JSON.stringify(row).includes("DO_NOT_LOG_BODY"), false);
  });
  it("records HTTP failures without consuming or reporting an error body", async () => {
    const row = await probeUrl(urls[0], { fetcher: async () => new Response("secret", { status: 404 }) });
    assert.equal(row.ok, false);
    assert.equal(row.error, "HTTP 404");
    assert.equal(JSON.stringify(row).includes("secret"), false);
  });
  it("records fetch failures rather than silently discarding samples", async () => {
    const row = await probeUrl(urls[0], { fetcher: async () => { throw new Error("fetch failed"); } });
    assert.equal(row.ok, false);
    assert.equal(row.error, "Error");
  });
  it("caps decoded response bytes", async () => {
    const row = await probeUrl(urls[0], { fetcher: async () => new Response("x".repeat(262145)) });
    assert.equal(row.ok, false);
    assert.equal(row.error, "response exceeds 262144 decoded bytes");
  });
  it("rejects non-JSON and non-public snapshot responses", async () => {
    for (const value of ["<html>not deployed</html>", JSON.stringify({ privacy: "private", schemaVersion: 1 })]) {
      const row = await probeUrl(urls[0], { fetcher: async () => new Response(value) });
      assert.equal(row.ok, false);
    }
  });
  it("rejects credentials, query strings, fragments, and non-loopback HTTP", () => {
    for (const value of ["https://user:pass@a.example/x", "https://a.example/x?token=secret", "https://a.example/x#x", "http://a.example/x"]) {
      assert.throws(() => validateUrl(value));
    }
    assert.equal(validateUrl("http://127.0.0.1:1234/api/v1/bootstrap.json", true).hostname, "127.0.0.1");
  });
  it("alternates A/B order, records every sample, and compares only identical bytes", async () => {
    const calls: string[] = [];
    const report = await compareRoutes(urls, { samples: 3, fetcher: async (url) => { calls.push(String(url)); return ok(); } });
    assert.deepEqual(calls, [urls[0], urls[1], urls[1], urls[0], urls[0], urls[1]]);
    assert.equal(report.comparable, true);
    assert.equal(report.results.length, 6);
    assert.deepEqual(report.routes.map((row) => row.successes), [3, 3]);
    assert.equal(report.measurementOrigin, "this-process-not-chatgpt-egress");
  });
  it("refuses an A/B comparison with mismatched content or a failed sample", async () => {
    for (const fail of [false, true]) {
      const report = await compareRoutes(urls, { samples: 1, fetcher: async (url) =>
        String(url) === urls[0] ? ok() : new Response(fail ? "fail" : body.replace('"items":[]', '"items":[1]'), { status: fail ? 503 : 200 }),
      });
      assert.equal(report.comparable, false);
    }
  });
  it("enforces the small fixed request budget before issuing any request", async () => {
    await assert.rejects(compareRoutes(urls, { samples: 11, fetcher: () => { throw new Error("must not fetch"); } }), RangeError);
  });
  it("rejects duplicate A/B routes", async () => {
    await assert.rejects(compareRoutes([urls[0], urls[0]], { fetcher: ok }), /distinct/);
  });
  it("times out a stalled real HTTP response", async () => {
    const server = createServer((_request, response) => { response.writeHead(200); response.flushHeaders(); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address(); assert.ok(address && typeof address === "object");
      const row = await probeUrl(`http://127.0.0.1:${address.port}/api/v1/bootstrap.json`, { allowLoopback: true, timeoutMs: 50 });
      assert.equal(row.ok, false);
      assert.ok(row.totalMs < 5000);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("performs a real HTTP read on loopback without requiring Internet access", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" }); response.end(body);
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address(); assert.ok(address && typeof address === "object");
      const row = await probeUrl(`http://127.0.0.1:${address.port}/api/v1/bootstrap.json`, { allowLoopback: true });
      assert.equal(row.ok, true); assert.equal(row.decodedBytes, Buffer.byteLength(body));
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
