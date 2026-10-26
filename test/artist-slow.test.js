import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { buildPlan, blend, HEAR_PLACEHOLDER } from "../src/logic.js";
import { mapTm } from "../src/live.js";
import { PAGE } from "../src/page.js";

const weekend = { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" };
const tmEv = (title, date, segment, id) => ({ kind: "event", title, venue: "Scoot Inn", date, time: "20:00:00", ...(segment ? { segment } : {}), source: { name: "Ticketmaster", url: `https://www.ticketmaster.com/event/${id}` } });
const place = (id, name, a = 0.5) => ({ entity_id: id, name, query: { affinity: a }, popularity: 0.3 });
const post = (path, body, headers = {}) => new Request(`http://x${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const BAD = /undefined|null|NaN|Because you love :|affinity 0\.00/;

test("empty seed list: reason is 'Popular in {city} this weekend.'", () => {
  const days = buildPlan({ seeds: [], ranked: { place: blend([place("p1", "Odd Duck")]) }, live: { events: [] }, weekend, city: "Austin" });
  const p = days.fri.find((i) => i.kind === "pick");
  assert.equal(p.reason, "Popular in Austin this weekend.");
  assert.doesNotMatch(JSON.stringify(days), /Because you love :/);
});

test("seeds resolved: reason keeps 'Because you love {seeds}: Qloo affinity x.xx'", () => {
  const days = buildPlan({ seeds: [{ name: "Prince" }], ranked: { place: blend([place("p1", "Odd Duck", 0.42)]) }, live: { events: [] }, weekend, city: "Austin" });
  assert.match(days.fri[0].reason, /^Because you love Prince: Qloo affinity 0\.42/);
});

test("no artist: hear slot falls back to a weekend Ticketmaster music event, with source + date, not duplicated", () => {
  const events = [tmEv("Deer Tick", weekend.sat, "Music", "a"), tmEv("Comedy Night", weekend.sun, "Arts & Theatre", "b")];
  const days = buildPlan({ seeds: [{ name: "Dune" }], ranked: {}, live: { events }, weekend, city: "Austin" });
  const satHear = days.sat.filter((i) => i.slot === "hear");
  assert.equal(satHear.length, 1); assert.equal(satHear[0].kind, "event"); assert.equal(satHear[0].name, "Deer Tick");
  assert.equal(satHear[0].source.name, "Ticketmaster"); assert.match(satHear[0].source.url, /^https:/); assert.equal(satHear[0].date, weekend.sat);
  const all = [...days.fri, ...days.sat, ...days.sun];
  assert.equal(all.filter((i) => i.name === "Deer Tick").length, 1, "music event not shown twice");
  // Sunday: the only music event is used, so placeholder; the non-music event stays a plain event.
  const sunHear = days.sun.find((i) => i.slot === "hear");
  assert.equal(sunHear.kind, "placeholder");
  assert.ok(days.sun.some((i) => i.name === "Comedy Night" && i.kind === "event"));
});

test("no artist and no music event: 'Live music pick coming soon' row with no source line", () => {
  const days = buildPlan({ seeds: [{ name: "Dune" }], ranked: {}, live: { events: [] }, weekend, city: "Austin" });
  for (const d of ["sat", "sun"]) {
    const h = days[d].find((i) => i.slot === "hear");
    assert.equal(h.name, "Live music pick coming soon"); assert.equal(h.reason, HEAR_PLACEHOLDER.reason);
    assert.equal(h.source, undefined); assert.equal(h.date, undefined);
  }
  assert.doesNotMatch(JSON.stringify(days), BAD);
  assert.match(PAGE, /i\.source\?'<div class="rcpt">Source:/); // receipt line only renders when a source exists
});

test("mapTm keeps the Ticketmaster segment so music events can be found", () => {
  const out = mapTm({ _embedded: { events: [{ name: "X", url: "https://www.ticketmaster.com/e/1", dates: { start: { localDate: weekend.sat } }, classifications: [{ segment: { name: "Music" } }] }] } });
  assert.equal(out[0].segment, "Music");
});

// An env whose BOOM getter throws: any code that copies env ({ ...env }) inside the try block blows up.
// That is a non-Qloo failure (no QlooError), after the Ticketmaster layer has already started.
const boomEnv = (extra = {}) => { const e = { MOCK: "1", ...extra }; Object.defineProperty(e, "BOOM", { enumerable: true, get() { throw new TypeError("forced non-Qloo failure"); } }); return e; };
const captureErrors = async (fn) => { const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.map(String).join(" ")); try { return { out: await fn(), logs }; } finally { console.error = orig; } };

test("forced non-Qloo error: 200 fallback plan, x-request-id = cf-ray, console.error carries the same id", async () => {
  const { out: r, logs } = await captureErrors(() => handle(post("/api/plan", { seeds: ["Prince"], city: "Austin", today: "2026-10-14" }, { "cf-ray": "8c1f-ray-123" }), boomEnv()));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-request-id"), "8c1f-ray-123");
  const b = await r.json();
  assert.equal(b.degraded, "error"); assert.ok(b.days.fri && b.days.sat && b.days.sun);
  assert.ok(b.days.sat.some((i) => i.slot === "hear") && b.days.sun.some((i) => i.slot === "hear"));
  assert.ok(Array.isArray(b.credits) && typeof b.summary === "string");
  assert.equal(logs.length, 1); assert.match(logs[0], /8c1f-ray-123/); assert.match(logs[0], /forced non-Qloo failure/);
  const text = JSON.stringify(b);
  assert.doesNotMatch(text, /forced non-Qloo failure|stack|at \w+ \(|upstream_error/); // real error only in logs
  assert.doesNotMatch(text, BAD);
});

test("forced non-Qloo error without cf-ray: generated id, same in header and log", async () => {
  const { out: r, logs } = await captureErrors(() => handle(post("/api/picks", { seeds: ["Prince"], city: "Austin" }), boomEnv()));
  assert.equal(r.status, 200);
  const id = r.headers.get("x-request-id"); assert.match(id, /^[0-9a-f-]{36}$/);
  assert.ok(logs[0].includes(id));
});

test("fallback plan keeps events if Ticketmaster responded, each with source + date", async () => {
  const { out: r } = await captureErrors(() => handle(post("/api/plan", { seeds: ["Prince"], city: "Austin", today: "2026-10-14" }), boomEnv()));
  const b = await r.json();
  const evs = Object.values(b.days).flat().filter((i) => i.kind === "event");
  assert.ok(evs.length > 0, "mock events included");
  for (const e of evs) { assert.ok(e.source.name); assert.match(e.source.url, /^https:\/\//); assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/); }
});

test("x-request-id on every /api response, not on the page", async () => {
  for (const req of [new Request("http://x/api/health"), new Request("http://x/api/nope"), new Request("http://x/api/plan"), post("/api/plan", { seeds: [], city: "Austin" }), post("/api/plan", { seeds: ["Prince"], city: "Austin" })]) {
    const r = await handle(req, { MOCK: "1" }); assert.ok(r.headers.get("x-request-id"), req.url);
  }
  const ray = await handle(new Request("http://x/api/health", { headers: { "cf-ray": "abc" } }), {});
  assert.equal(ray.headers.get("x-request-id"), "abc");
  assert.equal((await handle(new Request("http://x/"), {})).headers.get("x-request-id"), null);
});

test("real Qloo 429 still returns the 429 hold (not the fallback)", async () => {
  const f = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 429 });
  try {
    const r = await handle(post("/api/plan", { seeds: ["Zzqx unique 429"], city: "Austin" }), { QLOO_API_KEY: "Q", MOCK: "0" });
    assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60");
    assert.match((await r.json()).message, /Catching our breath/); assert.ok(r.headers.get("x-request-id"));
  } finally { globalThis.fetch = f; }
});

// --- Hook's acceptance checks (SPEC section 3) as unit tests where possible ---
test("acceptance 2: forced slow (PICKS_INSIGHTS_MS=1) -> 200 qloo_slow, slow copy in page, every day renders", async () => {
  const f = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (String(u).includes("/search")) return new Response(JSON.stringify({ results: [{ entity_id: "E1", name: "Prince", types: ["urn:entity:artist"] }] }), { status: 200 });
    // Insights never answer in time; reject on abort, or after 50 ms if no signal (AbortSignal.timeout is unref'd in Node).
    return new Promise((_, rej) => { const t = setTimeout(() => rej(new Error("timeout")), 50); o?.signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("timeout")); }); });
  };
  try {
    const r = await handle(post("/api/picks", { seeds: ["Slowcheck Artist"], city: "Austin" }), { QLOO_API_KEY: "Q", MOCK: "0", TM_MODE: "mock", PICKS_INSIGHTS_MS: "1" });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.ok(["qloo_slow", undefined].includes(b.degraded) || b.needsPick, JSON.stringify(b).slice(0, 200));
    if (!b.needsPick) { assert.equal(b.degraded, "qloo_slow"); for (const d of ["fri", "sat", "sun"]) assert.ok(Array.isArray(b.days[d])); assert.ok(b.days.sat.some((i) => i.slot === "hear")); assert.doesNotMatch(JSON.stringify(b.days), BAD); }
  } finally { globalThis.fetch = f; }
  assert.ok(PAGE.includes("Taste engine is slow right now, so here are city favorites. Hit Plan my weekend again in a minute to tune it."));
});

test("acceptance 3: movie-only seed in mock -> Sat and Sun each have a hear row; no bad text", async () => {
  const ask = { seeds: ["Dune"], city: "Austin", today: "2026-10-14" };
  let b = await (await handle(post("/api/plan", ask), { MOCK: "1" })).json();
  if (b.needsPick) { // mock asks which Dune: take the movie
    const picks = Object.fromEntries(b.needsPick.map((n) => [n.i, (n.options.find((o) => /movie/.test(o.type)) || n.options[0]).entity_id]));
    b = await (await handle(post("/api/plan", { ...ask, picks }), { MOCK: "1" })).json();
  }
  assert.ok(b.days, JSON.stringify(b).slice(0, 200));
  for (const d of ["sat", "sun"]) assert.ok(b.days[d].some((i) => i.slot === "hear"), d);
  assert.doesNotMatch(JSON.stringify(b.days), BAD);
});

test("acceptance 4: thrown error in the try block -> 200, never 502", async () => {
  const { out: r } = await captureErrors(() => handle(post("/api/plan?stage=fast", { seeds: ["Prince"], city: "Chicago" }), boomEnv()));
  assert.notEqual(r.status, 502); assert.equal(r.status, 200);
});

test("acceptance 5: rate limit -> 429 hold, retry works once the window clears", async () => {
  let allow = false; const env = { MOCK: "1", RATE_LIMITER: { limit: async () => ({ success: allow }) } };
  const r1 = await handle(post("/api/plan", { seeds: ["Prince"], city: "Austin" }), env);
  assert.equal(r1.status, 429); assert.match((await r1.json()).message, /Catching our breath, try again in a minute\./);
  allow = true; assert.equal((await handle(post("/api/plan", { seeds: ["Prince"], city: "Austin" }), env)).status, 200);
});

test("acceptance 6: every kind:event item has source.name, https source.url and date", async () => {
  const b = await (await handle(post("/api/plan", { seeds: ["Prince"], city: "Austin", today: "2026-10-14" }), { MOCK: "1" })).json();
  const evs = Object.values(b.days).flat().filter((i) => i.kind === "event");
  assert.ok(evs.length);
  for (const e of evs) { assert.ok(e.source?.name); assert.match(e.source.url, /^https:\/\//); assert.ok(e.date); }
});

test("a throw in plan setup (outside plan's try) still returns a 200 fallback with x-request-id", async () => {
  const { handle } = await import("../src/index.js");
  const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(" "));
  try {
    const env = { MOCK: "1", RATE_LIMITER: { limit: async () => { throw new Error("limiter boom"); } } };
    const res = await handle(new Request("http://x/api/plan", { method: "POST", headers: { "cf-ray": "ray-setup-1" }, body: JSON.stringify({ seeds: ["Prince"], city: "Austin" }) }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-request-id"), "ray-setup-1");
    const b = await res.json();
    assert.equal(b.degraded, "error");
    assert.ok(!JSON.stringify(b).includes("limiter boom"));
    assert.ok(errs.some((l) => l.includes("ray-setup-1") && l.includes("limiter boom")));
  } finally { console.error = orig; }
});
