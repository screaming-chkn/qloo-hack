import { test, beforeEach } from "node:test";
import { beforeEach as __be } from "node:test"; import { _resetQloo as __rq } from "../src/qloo.js"; __be(() => __rq());
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { weekendOf, inWindow } from "../src/dates.js";
import { tmEvents, tmUrl, venueNotes, overpassQuery, liveLayer, _reset, TM_GAP_MS, OSM_CREDIT } from "../src/live.js";

const W = weekendOf("2026-10-12");
beforeEach(() => _reset());
const stub = async (impl, fn) => { const o = globalThis.fetch; const calls = []; globalThis.fetch = async (u, i) => (calls.push({ url: String(u), init: i }), impl(String(u), i)); try { return { out: await fn(), calls }; } finally { globalThis.fetch = o; } };
const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
const TM = { _embedded: { events: [
  { name: "Fri Show", url: "https://www.ticketmaster.com/event/A1", dates: { start: { localDate: "2026-10-16" } }, _embedded: { venues: [{ name: "Moody Center" }] } },
  { name: "Sun Show", url: "https://www.ticketmaster.com/event/A2", dates: { start: { localDate: "2026-10-18" } }, _embedded: { venues: [{ name: "Stubb's" }] } },
  { name: "Mon Show", url: "https://www.ticketmaster.com/event/A3", dates: { start: { localDate: "2026-10-19" } } },
  { name: "No link", dates: { start: { localDate: "2026-10-17" } } },
] } };
const nap = () => Promise.resolve();

test("TM url: Fri-Sun window, city + state filter, ZIP uses postalCode", () => {
  const u = new URL(tmUrl("KEY", "Austin, TX", W));
  assert.equal(u.origin + u.pathname, "https://app.ticketmaster.com/discovery/v2/events.json");
  assert.equal(u.searchParams.get("city"), "Austin"); assert.equal(u.searchParams.get("stateCode"), "TX");
  assert.match(u.searchParams.get("startDateTime"), /^2026-10-16T/); assert.match(u.searchParams.get("endDateTime"), /^2026-10-19T/);
  const z = new URL(tmUrl("KEY", "78701", W)); assert.equal(z.searchParams.get("postalCode"), "78701"); assert.equal(z.searchParams.get("city"), null);
});

test("TM events: own event url as source, in-window only, dropped if no link", async () => {
  const { out } = await stub(() => ok(TM), () => tmEvents({ TICKETMASTER_API_KEY: "K" }, "Austin", W, { sleep: nap }));
  assert.equal(out.status, "ok");
  assert.deepEqual(out.events.map(e => e.title), ["Fri Show", "Sun Show"]);
  for (const e of out.events) { assert.match(e.source.url, /^https:\/\/www\.ticketmaster\.com\/event\//); assert.ok(inWindow(e.date, W)); }
});

test("TM short cache: second call within TTL makes no request; expires after", async () => {
  const env = { TICKETMASTER_API_KEY: "K" }; const t0 = 1_000_000;
  const { calls } = await stub(() => ok(TM), async () => {
    await tmEvents(env, "Austin", W, { sleep: nap, now: t0 });
    await tmEvents(env, "Austin", W, { sleep: nap, now: t0 + 60_000 });
    await tmEvents(env, "Austin", W, { sleep: nap, now: t0 + 11 * 60_000 });
  });
  assert.equal(calls.length, 2);
});

test("TM throttle: back-to-back calls wait to stay at <= 2 rps", async () => {
  const waits = []; const sleep = (ms) => (waits.push(ms), Promise.resolve());
  await stub(() => ok(TM), async () => { for (const c of ["A", "B", "C"]) await tmEvents({ TICKETMASTER_API_KEY: "K" }, c, W, { sleep }); });
  assert.equal(waits.length, 2); // queued slots: ~0.5s then ~1.0s out
  assert.ok(waits[0] > 0 && waits[0] <= TM_GAP_MS); assert.ok(waits[1] > TM_GAP_MS && waits[1] <= 2 * TM_GAP_MS);
});

test("TM degrades: no key -> no request; 429/500/throw -> empty, never throws", async () => {
  const { out, calls } = await stub(() => ok(TM), () => tmEvents({}, "Austin", W, { sleep: nap }));
  assert.deepEqual(out, { events: [], status: "no_key" }); assert.equal(calls.length, 0);
  for (const [impl, st] of [[() => new Response("", { status: 429 }), "rate_limited"], [() => new Response("", { status: 500 }), "error"], [() => { throw new Error("x"); }, "error"]]) {
    _reset(); const r = (await stub(impl, () => tmEvents({ TICKETMASTER_API_KEY: "K" }, "Austin", W, { sleep: nap }))).out;
    assert.deepEqual(r, { events: [], status: st });
  }
});

test("Overpass notes: no key, credit + element link, matched to names, cached", async () => {
  const osm = { elements: [
    { type: "node", id: 42, timestamp: "2025-06-01T10:00:00Z", tags: { name: "Magnolia Cafe", amenity: "restaurant", cuisine: "american;tex-mex", opening_hours: "24/7" } },
    { type: "way", id: 7, timestamp: "2024-01-01T00:00:00Z", tags: { name: "Magnolia Cafe", amenity: "cafe" } },
    { type: "node", id: 9, tags: { name: "Bare" } },
  ] };
  const { out, calls } = await stub(() => ok(osm), async () => {
    const a = await venueNotes({ OSM_NAME_FALLBACK: "1" }, { city: "Austin, TX", names: ["Magnolia Cafe"], mock: false, now: 1 });
    await venueNotes({ OSM_NAME_FALLBACK: "1" }, { city: "Austin, TX", names: ["Magnolia Cafe"], mock: false, now: 2 });
    return a;
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://overpass-api.de/api/interpreter");
  assert.doesNotMatch(calls[0].init.body, /key/i);
  assert.equal(out.length, 1);
  assert.equal(out[0].source.name, "© OpenStreetMap contributors"); assert.equal(out[0].source.url, "https://www.openstreetmap.org/node/42");
  assert.equal(out[0].date, "2025-06-01"); assert.match(out[0].text, /restaurant · cuisine: american, tex-mex · hours: 24\/7/);
  assert.equal(OSM_CREDIT.url, "https://www.openstreetmap.org/copyright");
});

test("Overpass query escapes names; failure -> no notes", async () => {
  const q = overpassQuery('Austin"x', ['Joe\'s (Bar) "1"']);
  assert.match(q, /area\["name"="Austinx"\]/); assert.match(q, /Joe's \\\(Bar\\\) \\"1\\"/);
  const { out } = await stub(() => new Response("", { status: 504 }), () => venueNotes({}, { city: "Austin", names: ["A"], mock: false }));
  assert.deepEqual(out, []);
});

test("mock mode: fixtures, zero network", async () => {
  const { out, calls } = await stub(() => { throw new Error("no net"); }, () => liveLayer({ TICKETMASTER_API_KEY: "K" }, { city: "Austin", weekend: W, today: "2026-10-12", mock: true }));
  assert.equal(calls.length, 0); assert.equal(out.status, "mock"); assert.ok(out.events.length >= 3);
});

test("real mode without TM key: plan still renders with picks + notes, events flagged", async () => {
  const qloo = (u) => u.includes("/search") ? ok({ results: [{ entity_id: "E1", name: "Prince", types: ["urn:entity:artist"] }] })
    : ok({ results: { entities: [{ entity_id: "P" + Math.random(), name: "Magnolia Cafe", popularity: 0.3, query: { affinity: 0.9 } }] } });
  const { out, calls } = await stub((u) => u.includes("overpass") ? ok({ elements: [{ type: "node", id: 1, timestamp: "2025-01-02T00:00:00Z", tags: { name: "Magnolia Cafe", amenity: "restaurant" } }] }) : qloo(u),
    async () => { const r = await handle(new Request("http://x/api/plan", { method: "POST", body: JSON.stringify({ seeds: ["Prince"], city: "Austin" }) }), { QLOO_API_KEY: "Q", MOCK: "0", OSM_NAME_FALLBACK: "1" }); return { s: r.status, b: await r.json() }; });
  assert.equal(out.s, 200); assert.equal(out.b.events, "no_key");
  assert.ok(!calls.some(c => c.url.includes("ticketmaster")));
  assert.ok(!calls.some((c) => c.url.includes("overpass")), "OSM must not block the plan");
  assert.doesNotMatch(JSON.stringify(out.b), /"Q"|apikey/);
});

test("page: footer privacy note + OSM credit link + Ticketmaster credit; no keys", async () => {
  const t = await (await handle(new Request("http://x/"))).text();
  const f = t.slice(t.indexOf("<footer>"));
  assert.match(f, /Privacy:/); assert.match(f, /© OpenStreetMap contributors/); assert.match(f, /https:\/\/www\.openstreetmap\.org\/copyright/); assert.match(f, /Ticketmaster/);
  assert.doesNotMatch(t, /TICKETMASTER_API_KEY|apikey|\bAI\b/);
});

test("name-only OSM stays off the request path by default", async () => {
  let hit = 0; const f = globalThis.fetch; globalThis.fetch = async () => { hit++; return new Response("{}"); };
  try { assert.deepEqual(await venueNotes({}, { city: "Austin", names: ["X Bar"], mock: false, now: 9 }), []); assert.equal(hit, 0); } finally { globalThis.fetch = f; }
});

test("cacheOnly venue notes never fetch; warm call fills the cache", async () => {
  let hit = 0; const f = globalThis.fetch;
  globalThis.fetch = async () => { hit++; return new Response(JSON.stringify({ elements: [{ type: "node", id: 5, timestamp: "2025-01-02T00:00:00Z", tags: { name: "Warm Bar", amenity: "bar" } }] })); };
  try {
    const env = { OSM_NAME_FALLBACK: "1" }, a = { city: "Austin", names: ["Warm Bar"], mock: false, now: 50 };
    assert.deepEqual(await venueNotes(env, { ...a, cacheOnly: true }), []); assert.equal(hit, 0);
    await venueNotes(env, a); assert.equal(hit, 1);
    assert.equal((await venueNotes(env, { ...a, cacheOnly: true })).length, 1); assert.equal(hit, 1);
  } finally { globalThis.fetch = f; }
});
