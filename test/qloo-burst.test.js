import test from "node:test";
import assert from "node:assert/strict";
import { handle, HOLD } from "../src/index.js";
import { _reset } from "../src/live.js";
import { _resetQloo } from "../src/qloo.js";

const ok = (j) => new Response(JSON.stringify(j));
const typeOf = (u) => (u.match(/urn%3Aentity%3A(\w+)|urn:entity:(\w+)/) || []).slice(1).find(Boolean);
// insights(type, n) -> Response for the nth call of that type
async function run(insights, envExtra = {}) {
  _reset(); _resetQloo(); const o = globalThis.fetch; const log = []; const n = {}; const t0 = Date.now();
  globalThis.fetch = async (u) => { u = String(u);
    if (u.includes("ticketmaster")) return ok({});
    if (u.includes("overpass")) return ok({ elements: [] });
    if (u.includes("/search")) return ok({ results: [{ entity_id: "E1", name: "Dune", types: ["urn:entity:movie"] }] });
    const t = typeOf(decodeURIComponent(u)); n[t] = (n[t] || 0) + 1; log.push({ t, at: Date.now() - t0, n: n[t] });
    return insights(t, n[t]); };
  try {
    const env = { QLOO_API_KEY: "Q", QLOO_STAGGER_MS: "40", QLOO_RETRY_MS: "30", QLOO_RETRY_JITTER_MS: "0", ...envExtra };
    const r = await handle(new Request("http://x/api/picks", { method: "POST", body: JSON.stringify({ seeds: ["Dune"], city: "Chicago, IL" }) }), env);
    return { r, b: await r.json(), log, ms: Date.now() - t0 };
  } finally { globalThis.fetch = o; }
}
const good = (t) => ok({ results: { entities: [{ entity_id: t + "1", name: t + " one", query: { affinity: 0.6 }, popularity: 0.2 }] } });
const q429 = () => new Response("{}", { status: 429 });

test("stagger: movie, artist, place fire in order ~stagger apart", async () => {
  const { r, log } = await run(good);
  assert.equal(r.status, 200);
  assert.deepEqual(log.map((x) => x.t), ["movie", "artist", "place"]);
  assert.ok(log[1].at - log[0].at >= 30 && log[2].at - log[1].at >= 30, JSON.stringify(log));
});

test("one Qloo 429 is retried once and the plan succeeds", async () => {
  const { r, b, log } = await run((t, n) => (t === "artist" && n === 1 ? q429() : good(t)));
  assert.equal(r.status, 200); assert.equal(b.degraded, undefined);
  assert.equal(log.filter((x) => x.t === "artist").length, 2);
  assert.ok(b.trace.some((x) => x.retry === "artist"));
});

test("429 twice -> hold with x-hold-source: qloo", async () => {
  const { r, b, log } = await run((t) => (t === "artist" ? q429() : good(t)));
  assert.equal(r.status, 429); assert.equal(r.headers.get("x-hold-source"), "qloo"); assert.equal(b.message, HOLD);
  assert.equal(log.filter((x) => x.t === "artist").length, 2, "exactly one retry");
});

test("non-429 errors are not retried (degrade as before)", async () => {
  const { r, b, log } = await run((t) => (t === "artist" ? new Response("{}", { status: 500 }) : good(t)));
  assert.equal(r.status, 200); assert.equal(b.degraded, "qloo_slow");
  assert.equal(log.filter((x) => x.t === "artist").length, 1);
});

test("budget cap: no retry if stagger + retry delay would exceed the cap", async () => {
  // place waits 2*40=80ms; retry 30 -> 110 > cap 100, so place's 429 is not retried -> hold
  const { r, log } = await run((t) => (t === "place" ? q429() : good(t)), { QLOO_BURST_CAP_MS: "100" });
  assert.equal(r.status, 429); assert.equal(r.headers.get("x-hold-source"), "qloo");
  assert.equal(log.filter((x) => x.t === "place").length, 1);
});

test("defaults keep added wait under ~1s", async () => {
  const { r, ms } = await run((t, n) => (t === "place" && n === 1 ? q429() : good(t)), { QLOO_STAGGER_MS: undefined, QLOO_RETRY_MS: undefined, QLOO_RETRY_JITTER_MS: undefined });
  assert.equal(r.status, 200); assert.ok(ms < 1300, `took ${ms}ms`); // 400 stagger + 300-400 retry
});
