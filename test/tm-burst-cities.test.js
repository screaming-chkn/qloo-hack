import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { _reset } from "../src/live.js";
import { _resetQloo } from "../src/qloo.js";

// Reference: eggbot burst-sim-v5 "10 users same instant, 10 cities". Before the fix, the waiter cap counted the
// throttle queue, so later cities' fast plans returned at ~3.5s with no events.
const CITIES = ["Chicago, IL", "Austin, TX", "Denver, CO", "Boston, MA", "Seattle, WA", "Miami, FL", "Atlanta, GA", "Portland, OR", "Dallas, TX", "Houston, TX"];
test("10-city burst: every fast plan has events and every plan finishes under 15s", { timeout: 30000 }, async () => {
  _reset(); _resetQloo(); const o = globalThis.fetch;
  const ok = (j) => new Response(JSON.stringify(j)), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  globalThis.fetch = async (u) => { u = String(u?.url ?? u);
    if (u.includes("ticketmaster")) { await sleep(250); return ok({ _embedded: { events: [] } }); }
    if (u.includes("overpass")) return ok({ elements: [] });
    await sleep(300);
    if (u.includes("/search")) return ok({ results: [{ entity_id: "E1", name: "Dune", types: ["urn:entity:movie"] }] });
    return ok({ results: { entities: [] } }); };
  try {
    const env = { QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T", QLOO_STAGGER_MS: "0" }, ctx = { waitUntil() {} };
    const req = (p, city) => new Request("http://x" + p, { method: "POST", body: JSON.stringify({ seeds: ["Dune"], city }) });
    const user = async (city) => { const t0 = Date.now();
      const pp = handle(req("/api/picks", city), env, ctx).then((r) => ({ ms: Date.now() - t0, status: r.status }));
      const f = await handle(req("/api/plan?stage=fast", city), env, ctx); const fast = Date.now() - t0;
      return { fast, events: (await f.json()).events, picks: await pp }; };
    const r = await Promise.all(CITIES.map(user));
    for (const x of r) { assert.equal(x.events, "ok"); assert.ok(x.fast < 15000, `fast ${x.fast}`); assert.equal(x.picks.status, 200); assert.ok(x.picks.ms < 15000, `picks ${x.picks.ms}`); }
  } finally { globalThis.fetch = o; }
});
