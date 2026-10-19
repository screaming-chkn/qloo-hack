import test from "node:test";
import assert from "node:assert/strict";
import { collapseEvents, venueNotes, _reset } from "../src/live.js";
import { buildPlan } from "../src/logic.js";
import { phrase } from "../src/ai.js";

const ev = (title, venue, date, time, id) => ({ kind: "event", title, venue, date, time, source: { name: "Ticketmaster", url: `https://www.ticketmaster.com/event/${id}` } });

test("same name + venue collapse into one event with sorted showtimes", () => {
  const out = collapseEvents([ev("Yvette Segan", "Cap City", "2026-10-17", "21:30:00", "c"), ev("Yvette Segan", "Cap City", "2026-10-16", "19:00:00", "a"),
    ev("Yvette Segan", "Cap City", "2026-10-16", "21:30:00", "b"), ev("Yvette Segan", "Other Club", "2026-10-16", "20:00:00", "d"), ev("Deer Tick", "Scoot Inn", "2026-10-16", "", "e")]);
  assert.equal(out.length, 3);
  const y = out.find((e) => e.venue === "Cap City");
  assert.equal(y.date, "2026-10-16");
  assert.deepEqual(y.showtimes.map((s) => s.date + " " + s.time), ["2026-10-16 19:00:00", "2026-10-16 21:30:00", "2026-10-17 21:30:00"]);
  assert.equal(y.showtimes[2].url, "https://www.ticketmaster.com/event/c");
});

test("plan shows a collapsed event once, with every showtime in its reason", () => {
  const weekend = { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" };
  const events = collapseEvents([ev("Yvette Segan", "Cap City", "2026-10-16", "19:00:00", "a"), ev("Yvette Segan", "Cap City", "2026-10-17", "21:30:00", "b")]);
  const days = buildPlan({ seeds: [{ name: "X" }], ranked: {}, live: { events }, weekend, city: "Austin" });
  const all = [...days.fri, ...days.sat, ...days.sun].filter((i) => i.kind === "event");
  assert.equal(all.length, 1);
  assert.equal(all[0].showtimes.length, 2);
  assert.match(all[0].reason, /2026-10-16 19:00, 2026-10-17 21:30/);
});

test("slow Overpass is cut off: notes empty, plan not stalled", async () => {
  _reset();
  const orig = globalThis.fetch;
  globalThis.fetch = (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  try {
    const t = Date.now();
    const keep = setTimeout(() => {}, 2000); // AbortSignal.timeout is unref'd in Node
    const notes = await venueNotes({ OSM_TIMEOUT_MS: 50 }, { city: "Austin", names: ["Scoot Inn"], mock: false });
    clearTimeout(keep);
    assert.deepEqual(notes, []);
    assert.ok(Date.now() - t < 1000);
  } finally { globalThis.fetch = orig; }
});

test("slow Workers AI falls back to the template summary", async () => {
  const env = { AI_TIMEOUT_MS: 30, AI: { run: () => new Promise((r) => setTimeout(() => r({ response: "late" }), 500)) } };
  const s = await phrase(env, [{ name: "Radiohead" }], { fri: [{ name: "Deer Tick" }] });
  assert.match(s, /OHHH YEAH/);
});

test("plan response carries per-call server-timing and qloo cache header", async () => {
  const { handle } = await import("../src/index.js");
  const r = await handle(new Request("http://x/api/plan", { method: "POST", body: JSON.stringify({ seeds: ["Prince"], city: "Austin" }) }), { MOCK: "1" });
  const h = r.headers.get("server-timing") || "";
  for (const k of ["qloo_search", "qloo_insights", "ticketmaster", "summary", "total"]) assert.ok(h.includes(k + ";dur="), k);
  assert.ok(r.headers.get("x-qloo-cache")); assert.match(r.headers.get("x-cache-write"), /ok=\d+ fail=\d+ kv=0/);
});

test("shared KV cache: second request served from KV; stale copy used when Qloo fails", async () => {
  const { handle } = await import("../src/index.js");
  const { _resetQloo } = await import("../src/qloo.js");
  _resetQloo();
  const kv = new Map(); const QLOO_CACHE = { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } };
  let n = 0, fail = false; const f = globalThis.fetch;
  globalThis.fetch = async (u) => { u = String(u); if (!u.includes("qloo")) return new Response("{}", { status: 404 }); n++; if (fail) throw new Error("down");
    return new Response(JSON.stringify(u.includes("/search") ? { results: [{ entity_id: "E1", name: "Prince", types: ["urn:entity:artist"] }] } : { results: { entities: [{ entity_id: "P1", name: "Cafe One", popularity: 0.3, query: { affinity: 0.9 } }] } })); };
  const go = () => handle(new Request("http://x/api/plan", { method: "POST", body: JSON.stringify({ seeds: ["Prince"], city: "Austin" }) }), { QLOO_API_KEY: "Q", MOCK: "0", QLOO_CACHE });
  try {
    assert.equal((await go()).status, 200); const cold = n; assert.ok(kv.size > 0);
    const r2 = await go(); assert.equal(r2.status, 200); assert.equal(n, cold); assert.match(r2.headers.get("x-qloo-cache"), /hit/);
    for (const [k, v] of kv) { const o = JSON.parse(v); o.t -= 26 * 60e3; kv.set(k, JSON.stringify(o)); }
    fail = true; const r3 = await go(); assert.equal(r3.status, 200); assert.match(r3.headers.get("x-qloo-cache"), /stale/);
  } finally { globalThis.fetch = f; }
});

test("cron warm refreshes at most 2 demo pairs", async () => {
  const { warm } = await import("../src/index.js");
  const seen = []; const f = globalThis.fetch;
  globalThis.fetch = async (u) => { seen.push(String(u)); return new Response("{}", { status: 404 }); };
  try { await warm({ QLOO_API_KEY: "Q", MOCK: "0", DEMO_PAIRS: JSON.stringify([{ seeds: ["A"], city: "X" }, { seeds: ["B"], city: "Y" }, { seeds: ["C"], city: "Z" }]) }); }
  finally { globalThis.fetch = f; }
  // Match the city param only: the rotating TOP_SEEDS warm-up can legitimately search names with a "Z" (SZA, Led Zeppelin).
  assert.ok(!seen.some((u) => /[?&](filter\.location\.query|city)=Z(&|$)/.test(u)));
  assert.ok(!seen.some((u) => /[?&]query=C(&|$)/.test(u)));
});

test("seed search: parallel, case-insensitive 7-day cache", async () => {
  const { searchSeeds, _resetQloo } = await import("../src/qloo.js");
  _resetQloo();
  let n = 0, inflight = 0, peak = 0; const f = globalThis.fetch;
  globalThis.fetch = async (u) => { n++; inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 20)); inflight--;
    const q = new URL(String(u)).searchParams.get("query"); return new Response(JSON.stringify({ results: [{ entity_id: "E-" + q, name: q, types: ["urn:entity:artist"] }] })); };
  try {
    const env = { QLOO_API_KEY: "Q", MOCK: "0" };
    const a = await searchSeeds(env, ["Prince", "Bowie", "Cher"]);
    assert.equal(peak, 3); assert.deepEqual(a.resolved.map((x) => x.seed), ["Prince", "Bowie", "Cher"]);
    await searchSeeds(env, ["prince", "BOWIE"]); assert.equal(n, 3);
  } finally { globalThis.fetch = f; }
});

test("two-step: fast plan makes no live Qloo calls; /api/picks returns personalized picks", async () => {
  const { handle } = await import("../src/index.js");
  const { _resetQloo } = await import("../src/qloo.js");
  _resetQloo();
  const urls = []; const f = globalThis.fetch;
  globalThis.fetch = async (u) => { u = String(u); urls.push(u); if (!u.includes("qloo")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(u.includes("/search") ? { results: [{ entity_id: "E1", name: "Prince", types: ["urn:entity:artist"] }] } : { results: { entities: [{ entity_id: "P1", name: "Cafe One", popularity: 0.3, query: { affinity: 0.9 } }] } })); };
  const req = (path) => handle(new Request("http://x" + path, { method: "POST", body: JSON.stringify({ seeds: ["Prince"], city: "Austin" }) }), { QLOO_API_KEY: "Q", MOCK: "0" });
  try {
    const a = await req("/api/plan?stage=fast"); const ab = await a.json();
    assert.equal(a.status, 200); assert.equal(ab.stage, "fast"); assert.ok(ab.days); assert.doesNotMatch(ab.summary, /loving ,/);
    assert.ok(!urls.some((u) => u.includes("/search")), "fast stage must not search Qloo");
    const b = await req("/api/picks"); const bb = await b.json();
    assert.equal(b.status, 200); assert.equal(bb.stage, "picks"); assert.equal(bb.degraded, undefined);
    assert.ok(urls.some((u) => u.includes("/search")));
  } finally { globalThis.fetch = f; }
});

import { safeTag } from "../src/logic.js";
import assert2 from "node:assert/strict";
import { test as t2 } from "node:test";
t2("safeTag skips offensive Qloo tags", () => {
  assert2.equal(safeTag([{ name: "Homophobic slur" }, { name: "Drama" }]), "Drama");
  assert2.equal(safeTag([{ name: "Homophobic slur" }]), undefined);
  assert2.equal(safeTag([{ name: "Comedy" }]), "Comedy");
  assert2.equal(safeTag(undefined), undefined);
});

import { blend as blend2 } from "../src/logic.js";
t2("blend output never carries an offensive tag", () => {
  const out = blend2([{ entity_id: "x", name: "Whiplash", query: { affinity: 0.9 }, popularity: 0.5, tags: [{ name: "Homophobic slur" }, { name: "Drama" }] },
                      { entity_id: "y", name: "Y", query: { affinity: 0.5 }, tags: [{ name: "Homophobic slur" }] },
                      { entity_id: "z", name: "Z", query: { affinity: 0.4 }, tags: [{ name: "Chateau" }] }]);
  assert2.ok(!/slur/i.test(JSON.stringify(out)));
  assert2.equal(out.find((p) => p.entity_id === "x").tag, "Drama");
  assert2.equal(out.find((p) => p.entity_id === "z").tag, "Chateau");
});
