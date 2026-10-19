import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { weekendOf, inWindow, daysBetween } from "../src/dates.js";
import { sanitizeSeed, sanitizeCity } from "../src/privacy.js";
import { liveLayer, keepSourced } from "../src/live.js";
import { blend } from "../src/logic.js";
import { searchSeeds, QlooError } from "../src/qloo.js";

const TODAY = "2026-10-12";
const post = (b, env = {}) => handle(new Request("http://x/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ today: TODAY, ...b }) }), env);
const plan = async (b, env) => { const r = await post(b, env); return { r, b: await r.json() }; };
const SEEDS = ["Blade Runner", "Prince", "Waffle House"];

test("weekend window: Mon -> upcoming Fri-Sun; Sat -> current", () => {
  assert.deepEqual(weekendOf("2026-10-12"), { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" });
  assert.deepEqual(weekendOf("2026-10-17"), { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" });
  assert.equal(inWindow("2026-10-18", weekendOf(TODAY)), true);
  assert.equal(inWindow("2026-10-19", weekendOf(TODAY)), false);
  assert.equal(daysBetween("2026-10-01", "2026-10-12"), 11);
});

test("privacy: emails/phones/handles stripped; city coarse", () => {
  assert.equal(sanitizeSeed("Prince me@x.com 555-123-4567 @bob"), "Prince");
  assert.equal(sanitizeSeed("x".repeat(500)).length, 80);
  assert.equal(sanitizeCity("Austin, TX 78701-1234"), "Austin, TX 78701");
});

test("end to end: 3 seeds -> Fri/Sat/Sun plan with >=3 types", async () => {
  const { r, b } = await plan({ seeds: SEEDS, city: "Austin" });
  assert.equal(r.status, 200);
  assert.equal(b.mock, true);
  assert.deepEqual(Object.keys(b.days), ["fri", "sat", "sun"]);
  const types = new Set(Object.values(b.days).flat().filter(p => p.kind === "pick").map(p => p.type));
  assert.ok(types.size >= 3, [...types].join());
  for (const d of ["fri", "sat", "sun"]) assert.ok(b.days[d].length > 0);
  assert.ok(b.summary.length > 0);
});

test("every pick has an inline reason; every live claim has source link + date", async () => {
  const { b } = await plan({ seeds: SEEDS, city: "Austin" });
  const all = Object.values(b.days).flat();
  assert.ok(all.length >= 10);
  for (const p of all) {
    assert.ok(p.reason && p.reason.length > 0, p.name);
    if (p.kind === "pick") assert.ok(p.proof.some(x => x.signal === "query.affinity"));
    for (const c of [p, ...(p.notes || [])].filter(x => x.kind !== "pick")) {
      assert.match(c.source.url, /^https:\/\//); assert.ok(c.source.name); assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test("live layer: >=3 events in window, >=2 venue notes with source + date", async () => {
  const { b } = await plan({ seeds: SEEDS, city: "Austin" });
  const all = Object.values(b.days).flat();
  const w = b.weekend;
  const ev = all.filter(p => p.kind === "event");
  assert.ok(ev.length >= 3);
  for (const e of ev) assert.ok(inWindow(e.date, w));
  const nt = all.flatMap(p => p.notes || []);
  assert.ok(nt.length >= 2);
  for (const x of nt) { assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/); assert.match(x.source.url, /^https:\/\//); }
  assert.ok(!nt.some(x => x.text === "undated decoy"));
  assert.ok(b.credits.some(c => c.url === "https://www.openstreetmap.org/copyright"));
});

test("keepSourced drops unsourced, undated, out-of-window and empty notes", () => {
  const w = weekendOf(TODAY);
  const items = [
    { kind: "event", title: "ok", date: "2026-10-17", source: { name: "S", url: "https://s" } },
    { kind: "event", title: "nosrc", date: "2026-10-17", source: { name: "S" } },
    { kind: "event", title: "nodate", source: { name: "S", url: "https://s" } },
    { kind: "event", title: "late", date: "2026-10-20", source: { name: "S", url: "https://s" } },
    { kind: "note", place: "P", text: "ok", date: "2025-01-01", source: { name: "S", url: "https://s" } },
    { kind: "note", place: "P", text: "", date: "2025-01-01", source: { name: "S", url: "https://s" } },
    { kind: "review", text: "reviews are gone", date: "2026-10-01", source: { name: "S", url: "https://s" } },
    { kind: "event", title: "http", date: "2026-10-17", source: { name: "S", url: "javascript:alert(1)" } },
  ];
  assert.deepEqual(keepSourced(items, w).map(i => i.title || i.text), ["ok", "ok"]);
});

test("changing city changes place and event results", async () => {
  const a = (await plan({ seeds: SEEDS, city: "Austin" })).b;
  const c = (await plan({ seeds: SEEDS, city: "Chicago" })).b;
  const names = (p) => Object.values(p.days).flat().filter(x => x.type === "place" || x.kind === "event").map(x => x.name).sort().join("|");
  assert.notEqual(names(a), names(c));
});

test("trace: /search per seed, /v2/insights with filter.type, no key, no PII", async () => {
  const { b } = await plan({ seeds: ["Prince me@x.com", "Blade Runner", "Waffle House"], city: "Austin" }, { QLOO_API_KEY: "SECRETKEY", MOCK: "1" });
  const s = b.trace.filter(t => t.path === "/search"); const i = b.trace.filter(t => t.path === "/v2/insights");
  assert.equal(s.length, 3);
  assert.ok(i.length >= 3);
  for (const t of i) assert.match(t.params["filter.type"], /^urn:entity:/);
  const txt = JSON.stringify(b);
  assert.doesNotMatch(txt, /SECRETKEY|me@x\.com/);
});

test("real mode sends X-Api-Key header to hackathon base, never in URL", async () => {
  const calls = []; const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), h: init.headers }); return new Response(JSON.stringify({ results: [{ entity_id: "E1", name: "Prince", types: ["urn:entity:artist"] }] })); };
  try { const r = await searchSeeds({ QLOO_API_KEY: "K", MOCK: "0" }, ["Prince"], {}, []); assert.equal(r.resolved[0].entity_id, "E1"); }
  finally { globalThis.fetch = orig; }
  assert.match(calls[0].url, /^https:\/\/hackathon\.api\.qloo\.com\/search\?/);
  assert.doesNotMatch(calls[0].url, /K(&|$)/);
  assert.equal(calls[0].h["X-Api-Key"], "K");
});

test("ambiguous seed returns pick list; pick resolves it", async () => {
  const { r, b } = await plan({ seeds: ["Dune", "Prince", "Waffle House"], city: "Austin" });
  assert.equal(r.status, 200);
  assert.equal(b.needsPick.length, 1);
  assert.equal(b.needsPick[0].seed, "Dune");
  assert.ok(b.needsPick[0].options.length >= 2);
  const id = b.needsPick[0].options[1].entity_id;
  const two = (await plan({ seeds: ["Dune", "Prince", "Waffle House"], city: "Austin", picks: { Dune: id } })).b;
  assert.ok(!two.needsPick); assert.ok(two.seeds.some(s => s.entity_id === id));
});

test("validation: need 1-5 seeds and a city", async () => {
  assert.equal((await post({ seeds: [], city: "Austin" })).status, 400);
  assert.equal((await post({ seeds: ["a"] })).status, 400);
  assert.equal((await post({ seeds: Array(6).fill("a"), city: "Austin" })).status, 400);
  assert.equal((await handle(new Request("http://x/api/plan"))).status, 405);
});

test("forced Qloo 429 -> friendly hold, no stack, no key", async () => {
  const { r, b } = await plan({ seeds: ["!429", "Prince", "x"], city: "Austin" }, { QLOO_API_KEY: "SECRETKEY", MOCK: "1" });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "60");
  assert.match(b.message, /Catching our breath, try again in a minute/);
  assert.doesNotMatch(JSON.stringify(b), /SECRETKEY|at \w+ \(|Error/);
});

test("per-visitor limit -> same friendly hold", async () => {
  const env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const { r, b } = await plan({ seeds: SEEDS, city: "Austin" }, env);
  assert.equal(r.status, 429); assert.match(b.message, /Catching our breath/);
});

test("Qloo upstream 500 -> degraded plan (events only), no 502, no stack", async () => {
  const { r, b } = await plan({ seeds: ["!500", "Prince", "x"], city: "Austin" });
  assert.equal(r.status, 200); assert.equal(b.degraded, "qloo_slow"); assert.ok(b.days); assert.doesNotMatch(JSON.stringify(b), /at \w+ \(|stack/);
  assert.ok(new QlooError(500) instanceof Error);
});

test("blend: affinity leads, popularity never ranks, live boost bumps", () => {
  const e = [
    { entity_id: "a", name: "A", popularity: 0.99, query: { affinity: 0.5 } },
    { entity_id: "b", name: "B", popularity: 0.01, query: { affinity: 0.9 } },
    { entity_id: "c", name: "C", popularity: 0.5, query: { affinity: 0.85 } },
  ];
  assert.deepEqual(blend(e).map(x => x.entity_id), ["b", "c", "a"]);
  assert.equal(blend(e, { boosted: new Set(["c"]) })[0].entity_id, "c");
});

test("page: weekend card UI, hold message, no key, no 'AI' word", async () => {
  const t = await (await handle(new Request("http://x/"))).text();
  assert.match(t, /id="city"/); assert.match(t, /Catching our breath/);
  assert.doesNotMatch(t, /\bAI\b|X-Api-Key/);
});

test("no paid/card-gated hosts in source", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const txt = ["src", "fixtures"].flatMap(d => readdirSync(d).map(f => readFileSync(`${d}/${f}`, "utf8"))).join("\n") + readFileSync("wrangler.toml", "utf8");
  assert.doesNotMatch(txt, /api\.yelp\.com|maps\.googleapis|api\.foursquare|tripadvisor|predicthq|serpapi|eventbriteapi/i);
});
