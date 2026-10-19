import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, blend, hasHearPlaceholder } from "../src/logic.js";
import { tmWideMusic, tmWideUrl, _reset, TM_CACHE_MS } from "../src/live.js";
import { offWeekendLabel, shortDate } from "../src/dates.js";
import { handle } from "../src/index.js";
import { _resetQloo } from "../src/qloo.js";
import { PAGE } from "../src/page.js";

const weekend = { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" };
const ev = (title, date, segment, id, venue = "Metro") => ({ kind: "event", title, venue, date, time: "20:00:00", ...(segment ? { segment } : {}), source: { name: "Ticketmaster", url: `https://www.ticketmaster.com/event/${id}` } });
const art = (id, name, a) => ({ entity_id: id, name, query: { affinity: a }, popularity: 0.2 });
const hear = (days) => ["sat", "sun"].map((d) => days[d].find((i) => i.slot === "hear"));
const base = { seeds: [{ name: "Bowie" }], weekend, city: "Chicago" };

test("tier 1: weekend music event beats wide events", () => {
  const days = buildPlan({ ...base, ranked: {}, live: { events: [ev("Weekend Band", weekend.sat, "Music", "w")] }, wide: [ev("Later Band", "2026-10-24", "Music", "l")] });
  const [sat, sun] = hear(days);
  assert.equal(sat.name, "Weekend Band"); assert.equal(sat.label, undefined);
  assert.equal(sun.name, "Later Band"); assert.equal(sun.label, "Next week: Sat Oct 24");
});

test("tier 2: wide (50 mi / 14 day) event carries a date label on card and reason; weekend-dated wide event has none", () => {
  const days = buildPlan({ ...base, ranked: {}, live: { events: [ev("Comedy", weekend.sat, "Comedy", "c")] }, wide: [ev("Suburb Show", weekend.sun, "Music", "s", "Joliet Hall"), ev("Next Wk", "2026-10-24", "Music", "n")] });
  const [sat, sun] = hear(days);
  assert.equal(sat.name, "Suburb Show"); assert.equal(sat.label, undefined); // weekend-dated wide pick beats off-weekend
  assert.equal(sun.name, "Next Wk"); assert.equal(sun.label, "Next week: Sat Oct 24"); assert.match(sun.reason, /^Next week: Sat Oct 24\. /);
  assert.equal(sun.source.name, "Ticketmaster");
  assert.match(PAGE, /i\.label\?'<span class="tag">'/);
});

test("tier 3: top Qloo artist reads 'Your vibe: {artist}' with no venue, date or source line", () => {
  const ranked = { artist: blend([art("a1", "David Bowie", 0.9)]) };
  const days = buildPlan({ ...base, ranked, live: { events: [] } });
  const [sat, sun] = hear(days);
  assert.equal(sat.name, "David Bowie"); // the regular pick
  assert.equal(sun.name, "Your vibe: David Bowie"); assert.equal(sun.kind, "pick");
  for (const k of ["venue", "date", "source", "showtimes", "label"]) assert.equal(sun[k], undefined, k);
  assert.doesNotMatch(sun.reason, /ticket|20\d\d-/i);
});

test("tier 4: nothing anywhere -> placeholder (and hasHearPlaceholder sees it)", () => {
  const days = buildPlan({ ...base, ranked: {}, live: { events: [] } });
  assert.ok(hear(days).every((h) => h.kind === "placeholder"));
  assert.ok(hasHearPlaceholder(days));
});

test("date labels", () => {
  assert.equal(shortDate("2026-10-24"), "Sat Oct 24");
  assert.equal(offWeekendLabel("2026-10-17", weekend), null);
  assert.equal(offWeekendLabel("2026-10-15", weekend), "This week: Thu Oct 15");
  assert.equal(offWeekendLabel("2026-10-28", weekend), "Coming up: Wed Oct 28");
});

test("wide URL: music, 50 miles, 14 days", () => {
  const u = new URL(tmWideUrl("K", "Chicago, IL", "2026-10-14"));
  assert.equal(u.searchParams.get("classificationName"), "music"); assert.equal(u.searchParams.get("radius"), "50"); assert.equal(u.searchParams.get("unit"), "miles");
  assert.equal(u.searchParams.get("endDateTime"), "2026-10-28T23:59:59Z"); assert.equal(u.searchParams.get("stateCode"), "IL");
});

test("wide call is cached for TM_CACHE_MS, then refetched (no stale results)", async () => {
  _reset(); const o = globalThis.fetch; let n = 0;
  globalThis.fetch = async () => { n++; return new Response(JSON.stringify({ _embedded: { events: [{ name: "X", url: "https://www.ticketmaster.com/e/1", dates: { start: { localDate: "2026-10-20" } } }] } })); };
  try {
    const T0 = Date.parse("2026-10-14T18:00:00Z"), env = { TICKETMASTER_API_KEY: "K" }, sleep = async () => {};
    const a = await tmWideMusic(env, "Chicago", { sleep, now: T0 });
    await tmWideMusic(env, "Chicago", { sleep, now: T0 + TM_CACHE_MS - 1 });
    assert.equal(n, 1); assert.equal(a[0].segment, "Music");
    await tmWideMusic(env, "Chicago", { sleep, now: T0 + TM_CACHE_MS + 1 });
    assert.equal(n, 2);
  } finally { globalThis.fetch = o; }
});

test("plan: at most one extra (wide) TM call per request, started alongside Qloo", async () => {
  // Date relative to today (past this weekend, inside 14 days) so the test does not expire.
  const farDate = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
  _reset(); _resetQloo(); const o = globalThis.fetch; const tm = [];
  const ok = (j) => new Response(JSON.stringify(j));
  globalThis.fetch = async (u) => { u = String(u);
    if (u.includes("ticketmaster")) { tm.push(u); return ok(u.includes("classificationName") ? { _embedded: { events: [{ name: "Far Gig", url: "https://www.ticketmaster.com/e/9", dates: { start: { localDate: farDate } }, _embedded: { venues: [{ name: "Joliet" }] } }] } } : { _embedded: { events: [] } }); }
    if (u.includes("overpass")) return ok({ elements: [] });
    return u.includes("/search") ? ok({ results: [{ entity_id: "E1", name: "Dune", types: ["urn:entity:movie"] }] }) : ok({ results: { entities: [] } }); };
  try {
    const r = await handle(new Request("http://x/api/plan", { method: "POST", body: JSON.stringify({ seeds: ["Dune"], city: "Chicago, IL" }) }), { QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T" });
    const b = await r.json();
    assert.equal(r.status, 200); assert.equal(tm.length, 2); assert.equal(tm.filter((u) => u.includes("classificationName")).length, 1);
    const all = Object.values(b.days).flat();
    const far = all.find((i) => i.name === "Far Gig"); assert.ok(far); assert.match(far.label, /^Next week: |^Coming up: /);
  } finally { globalThis.fetch = o; }
});
