import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { _reset } from "../src/live.js";
import { _resetQloo } from "../src/qloo.js";
import { buildPlan, hasDatedHear } from "../src/logic.js";

const ok = (j) => new Response(JSON.stringify(j));
const typeOf = (u) => (decodeURIComponent(u).match(/urn:entity:(\w+)/) || [])[1];
// Relative date (inside the 14-day wide window) so this test does not expire.
const gigDate = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
const gig = { _embedded: { events: [{ name: "Far Gig", url: "https://www.ticketmaster.com/e/9", dates: { start: { localDate: gigDate } }, _embedded: { venues: [{ name: "Joliet" }] } }] } };
async function run(insights, { wide = gig, path = "/api/picks" } = {}) {
  _reset(); _resetQloo(); const o = globalThis.fetch; const log = [];
  globalThis.fetch = async (u) => { u = String(u);
    if (u.includes("ticketmaster")) { log.push({ k: u.includes("classificationName") ? "wide" : "tm", at: Date.now() }); return ok(u.includes("classificationName") ? wide : { _embedded: { events: [] } }); }
    if (u.includes("overpass")) return ok({ elements: [] });
    if (u.includes("/search")) return ok({ results: [{ entity_id: "E1", name: "Dune", types: ["urn:entity:movie"] }] });
    const t = typeOf(u); log.push({ k: t, at: Date.now() }); return insights(t); };
  try {
    const env = { QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T", QLOO_STAGGER_MS: "0" };
    const r = await handle(new Request("http://x" + path, { method: "POST", body: JSON.stringify({ seeds: ["Dune"], city: "Chicago, IL" }) }), env);
    return { r, b: await r.json(), log };
  } finally { globalThis.fetch = o; }
}
const good = (t) => ok({ results: { entities: [{ entity_id: t + "1", name: t + " one", query: { affinity: 0.6 }, popularity: 0.2 }] } });
const hears = (b) => Object.values(b.days).flat().filter((i) => i.slot === "hear");

test("artist insights fail (non-429), wide music exists -> dated hear pick, no qloo_slow", async () => {
  const { r, b } = await run((t) => (t === "artist" ? new Response("{}", { status: 500 }) : good(t)));
  assert.equal(r.status, 200); assert.equal(b.degraded, undefined);
  const far = hears(b).find((i) => i.name === "Far Gig");
  assert.ok(far && far.date && far.source?.url); assert.ok(!hears(b).some((i) => i.repeat));
});

test("artist insights fail and no music anywhere -> still qloo_slow (honest)", async () => {
  const { b } = await run((t) => (t === "artist" ? new Response("{}", { status: 500 }) : good(t)), { wide: { _embedded: { events: [] } } });
  assert.equal(b.degraded, "qloo_slow");
});

test("movie/place insights fail -> still qloo_slow even when wide music exists", async () => {
  const { b } = await run((t) => (t === "place" ? new Response("{}", { status: 500 }) : good(t)));
  assert.equal(b.degraded, "qloo_slow");
});

test("wide call starts alongside Qloo (not after it), exactly once", async () => {
  // Qloo takes 900ms; the wide call (behind the 500ms TM gap) must go out before Qloo answers.
  const slow = (t) => new Promise((res) => setTimeout(() => res(good(t)), 900));
  const { b, log } = await run(slow);
  const w = log.filter((x) => x.k === "wide"); assert.equal(w.length, 1);
  const firstAnswer = Math.min(...log.filter((x) => ["movie", "artist", "place"].includes(x.k)).map((x) => x.at)) + 900;
  assert.ok(w[0].at < firstAnswer, "wide fired before Qloo answered");
  assert.ok(b.days);
});

test("'Your vibe' no-date repeat loses to a wide dated music event", () => {
  const weekend = { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" };
  const art = [{ entity_id: "a1", name: "Prince", affinity: 0.7, score: 1 }];
  const wide = [{ kind: "event", title: "Far Gig", venue: "Joliet", date: "2026-10-24", segment: "Music", source: { name: "Ticketmaster", url: "https://www.ticketmaster.com/e/9" } }];
  const without = buildPlan({ seeds: [], ranked: { artist: art }, live: { events: [] }, weekend, city: "Chicago" });
  assert.ok(!hasDatedHear(without));
  const withW = buildPlan({ seeds: [], ranked: { artist: art }, live: { events: [] }, weekend, city: "Chicago", wide });
  assert.ok(Object.values(withW).flat().some((i) => i.slot === "hear" && i.name === "Far Gig" && i.date));
});

test("fast plan never makes the wide call", async () => {
  const { log } = await run(good, { path: "/api/plan?stage=fast" });
  assert.equal(log.filter((x) => x.k === "wide").length, 0);
});
