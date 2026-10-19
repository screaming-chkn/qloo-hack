import test from "node:test";
import assert from "node:assert/strict";
import { tmEvents, tmWideMusic, tmWideUrl, _reset, TM_NEG_429_MS, TM_NEG_ERR_MS } from "../src/live.js";
import { buildPlan } from "../src/logic.js";

const w = { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" };
const env = { TICKETMASTER_API_KEY: "K" }, sleep = async () => {};
async function withFetch(fn, impl) { const o = globalThis.fetch; const urls = []; globalThis.fetch = async (u) => { urls.push(String(u)); return impl(String(u)); }; try { await fn(urls); } finally { globalThis.fetch = o; } }
const T0 = Date.parse("2026-10-14T18:00:00Z");

test("TM 429 is remembered ~60s per city/weekend, then retried", async () => {
  _reset();
  await withFetch(async (urls) => {
    assert.equal((await tmEvents(env, "Chicago", w, { sleep, now: T0 })).status, "rate_limited");
    assert.equal((await tmEvents(env, "Chicago", w, { sleep, now: T0 + TM_NEG_429_MS - 1 })).status, "rate_limited");
    assert.equal(urls.length, 1, "no refetch inside the window");
    await tmEvents(env, "Austin", w, { sleep, now: T0 + 1 }); assert.equal(urls.length, 2, "other cities unaffected");
    await tmEvents(env, "Chicago", w, { sleep, now: T0 + TM_NEG_429_MS + 1 }); assert.equal(urls.length, 3);
  }, () => new Response("{}", { status: 429 }));
});

test("TM other errors (5xx, network) are remembered ~30s", async () => {
  _reset();
  await withFetch(async (urls) => {
    assert.equal((await tmEvents(env, "Chicago", w, { sleep, now: T0 })).status, "error");
    await tmEvents(env, "Chicago", w, { sleep, now: T0 + TM_NEG_ERR_MS - 1 }); assert.equal(urls.length, 1);
    await tmEvents(env, "Chicago", w, { sleep, now: T0 + TM_NEG_ERR_MS + 1 }); assert.equal(urls.length, 2);
  }, () => new Response("{}", { status: 503 }));
  _reset();
  await withFetch(async (urls) => {
    await tmEvents(env, "Chicago", w, { sleep, now: T0 }); await tmEvents(env, "Chicago", w, { sleep, now: T0 + 5 });
    assert.equal(urls.length, 1);
  }, () => { throw new TypeError("network"); });
});

test("wide search 429 is negative-cached; hear slot falls through to the next tier", async () => {
  _reset();
  await withFetch(async (urls) => {
    assert.deepEqual(await tmWideMusic(env, "Chicago", { sleep, now: T0 }), []);
    assert.deepEqual(await tmWideMusic(env, "Chicago", { sleep, now: T0 + 1000 }), []);
    assert.equal(urls.length, 1);
  }, () => new Response("{}", { status: 429 }));
  const days = buildPlan({ seeds: [{ name: "Bowie" }], ranked: { artist: [{ entity_id: "a", name: "Bowie", affinity: 0.9, score: 1, proof: [] }] }, live: { events: [] }, wide: [], weekend: w, city: "Chicago" });
  assert.equal(days.sun.find((i) => i.slot === "hear").name, "Your vibe: Bowie");
});

test("wide search dates use the city's local date, not UTC", async () => {
  _reset();
  // Sun Oct 18, 9:30 PM PDT = Mon Oct 19 04:30 UTC. LA is still Sunday; New York is already Monday.
  const now = Date.parse("2026-10-19T04:30:00Z");
  await withFetch(async (urls) => {
    await tmWideMusic(env, "Los Angeles, CA", { sleep, now });
    await tmWideMusic(env, "New York, NY", { sleep, now });
    const la = new URL(urls[0]).searchParams, ny = new URL(urls[1]).searchParams;
    assert.equal(la.get("startDateTime"), "2026-10-18T00:00:00Z"); assert.equal(la.get("endDateTime"), "2026-11-01T23:59:59Z");
    assert.equal(ny.get("startDateTime"), "2026-10-19T00:00:00Z");
  }, () => new Response(JSON.stringify({})));
  assert.equal(new URL(tmWideUrl("K", "Austin", "2026-10-18")).searchParams.get("startDateTime"), "2026-10-18T00:00:00Z");
});
