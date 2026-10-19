import test from "node:test";
import assert from "node:assert/strict";
import { handle, HOLD } from "../src/index.js";
import { _reset } from "../src/live.js";
import { _resetQloo } from "../src/qloo.js";

const req = () => new Request("http://x/api/picks", { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify({ seeds: ["Prince"], city: "Austin, TX" }) });

test("our limiter hold is tagged x-hold-source: limiter", async () => {
  const env = { RATE_LIMITER_PICKS: { limit: async () => ({ success: false }) } };
  const r = await handle(req(), env);
  assert.equal(r.status, 429); assert.equal(r.headers.get("x-hold-source"), "limiter");
  const b = await r.json(); assert.equal(b.message, HOLD); assert.equal(b.source, "limiter"); assert.ok(r.headers.get("x-request-id"));
});

test("upstream Qloo 429 hold is tagged qloo and keeps server-timing", async () => {
  _reset(); _resetQloo(); const o = globalThis.fetch;
  globalThis.fetch = async (u) => { u = String(u);
    if (u.includes("/search")) return new Response(JSON.stringify({ results: [{ entity_id: "E1", name: "Prince", types: ["urn:entity:artist"] }] }));
    if (u.includes("qloo")) return new Response("{}", { status: 429 });
    return new Response(JSON.stringify({})); };
  try {
    const r = await handle(req(), { QLOO_API_KEY: "Q", RATE_LIMITER_PICKS: { limit: async () => ({ success: true }) } });
    assert.equal(r.status, 429); assert.equal(r.headers.get("x-hold-source"), "qloo"); assert.equal(r.headers.get("retry-after"), "60");
    assert.match(r.headers.get("server-timing") || "", /qloo_insights;dur=/);
    assert.equal((await r.json()).message, HOLD);
  } finally { globalThis.fetch = o; }
});
