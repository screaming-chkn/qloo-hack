import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { isMock, insightsFor } from "../src/qloo.js";

const req = (path, init) => new Request("http://x" + path, init);
const post = (b) => req("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

test("GET / serves html", async () => {
  const r = await handle(req("/"));
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /<input/);
  assert.doesNotMatch(t, /\bAI\b/);
});
test("health", async () => assert.deepEqual(await (await handle(req("/api/health"))).json(), { ok: true, mock: true }));
test("404", async () => assert.equal((await handle(req("/nope"))).status, 404));
test("400 on empty input", async () => {
  assert.equal((await handle(post({ query: "  " }))).status, 400);
  assert.equal((await handle(post({}))).status, 400);
});
test("mock qloo with no key", async () => {
  assert.equal(isMock({}), true);
  assert.equal(isMock({ QLOO_API_KEY: "k", MOCK: "1" }), true);
  assert.equal(isMock({ QLOO_API_KEY: "k", MOCK: "0" }), false);
  const d = await insightsFor({}, { type: "movie", entityIds: ["X"] });
  assert.ok(d.length > 0);
});
