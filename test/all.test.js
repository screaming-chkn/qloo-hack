import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { insights, isMock } from "../src/qloo.js";
import { rank } from "../src/logic.js";

const req = (path, init) => new Request("http://x" + path, init);
const post = (b) => req("/api/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

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
  const d = await insights({}, {});
  assert.ok(d.results.entities.length > 0);
});
test("logic ranks and every claim has proof", async () => {
  const d = await insights({}, {});
  const r = rank(d.results.entities, { seed: "S" });
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  for (const x of r) for (const w of x.why) { assert.ok(w.proof.entity_id); assert.ok(w.proof.signal); }
});
test("recommend end-to-end in mock", async () => {
  const r = await handle(post({ query: "diners" }));
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.mock, true);
  assert.equal(b.results[0].entity_id, "MOCK-A1");
});
