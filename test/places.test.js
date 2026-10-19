import test from "node:test";
import assert from "node:assert/strict";
import { insightsFor, isVenue, PLACE_TAGS, PLACE_RADIUS_M } from "../src/qloo.js";
import { venueNotes, nameSimilar, matchNear, overpassNearQuery, metersBetween, _reset } from "../src/live.js";
import { blend, buildPlan } from "../src/logic.js";

const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
async function stub(impl, fn) {
  const orig = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return impl(String(url), init); };
  try { return { out: await fn(), calls }; } finally { globalThis.fetch = orig; }
}
// Doc-shaped place entities (docs.qloo.com Insights response: entity_id, name, location.lat/lon, tags).
const ENT = (name, lat, lon, tags = []) => ({ entity_id: name.toUpperCase().replace(/\W+/g, "-"), name, location: { lat, lon }, query: { affinity: 0.8 }, popularity: 0.5, tags });
const QLOO_PLACES = { success: true, results: { entities: [
  ENT("The Continental Club", 30.2499, -97.7494, [{ id: "urn:tag:genre:place:music_venue", name: "Music Venue" }]),
  ENT("Delta Gamma", 30.2880, -97.7440), ENT("Zeta Tau Alpha", 30.2890, -97.7450),
  ENT("Kappa Sigma House", 30.29, -97.74, [{ name: "Fraternity" }]),
  ENT("Joe's Bar & Grill", 30.2672, -97.7431, [{ id: "urn:tag:genre:place:bar", name: "Bar" }]),
] } };

test("place insights ask Qloo for restaurants/bars/music venues (union) within a radius, and drop Greek life", async () => {
  const trace = [];
  const { out, calls } = await stub(() => ok(QLOO_PLACES), () => insightsFor({ QLOO_API_KEY: "Q" }, { type: "place", entityIds: ["A"], city: "Austin" }, trace));
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/v2/insights");
  assert.equal(u.searchParams.get("filter.type"), "urn:entity:place");
  assert.equal(u.searchParams.get("filter.tags"), PLACE_TAGS.join(","));
  assert.match(u.searchParams.get("filter.tags"), /place:restaurant.*place:bar.*place:music_venue/);
  assert.equal(u.searchParams.get("operator.filter.tags"), "union");
  assert.equal(u.searchParams.get("filter.location.query"), "Austin");
  assert.equal(u.searchParams.get("filter.location.radius"), String(PLACE_RADIUS_M));
  assert.deepEqual(out.map((e) => e.name), ["The Continental Club", "Joe's Bar & Grill"]);
  assert.equal(trace[0].params["filter.tags"], PLACE_TAGS.join(","));
});

test("movie/artist insights carry no place filters", async () => {
  const { calls } = await stub(() => ok({ results: { entities: [] } }), () => insightsFor({ QLOO_API_KEY: "Q" }, { type: "movie", entityIds: ["A"], city: "Austin" }));
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("filter.tags"), null); assert.equal(u.searchParams.get("filter.location.radius"), null);
});

test("isVenue keeps real venues with Greek-ish words", () => {
  assert.ok(isVenue({ name: "Alpha Bar" })); assert.ok(isVenue({ name: "Pi Pizzeria" })); assert.ok(isVenue({ name: "Delta Diner" }));
  assert.ok(!isVenue({ name: "Phi Kappa Psi" })); assert.ok(!isVenue({ name: "Hall", tags: [{ name: "Sorority" }] }));
});

test("fuzzy names", () => {
  assert.ok(nameSimilar("The Continental Club", "Continental Club"));
  assert.ok(nameSimilar("Joe's Bar & Grill", "Joes Bar and Grill"));
  assert.ok(nameSimilar("Café Mueller", "Cafe Mueller"));
  assert.ok(!nameSimilar("Continental Club", "Continental Gallery Parking"));
});

test("near match: fuzzy name within 250 m wins; same name far away or wrong name nearby is ignored", () => {
  const p = { name: "The Continental Club", lat: 30.2499, lon: -97.7494 };
  const osm = { elements: [
    { type: "node", id: 1, lat: 30.2500, lon: -97.7495, tags: { name: "Continental Club", amenity: "bar", live_music: "yes" } },
    { type: "node", id: 2, lat: 30.2600, lon: -97.7494, tags: { name: "Continental Club", amenity: "bar" } },
    { type: "way", id: 3, center: { lat: 30.2499, lon: -97.7493 }, tags: { name: "Allens Boots", shop: "shoes" } },
  ] };
  assert.ok(metersBetween(p, { lat: 30.26, lon: -97.7494 }) > 1000);
  const m = matchNear(osm, [p]);
  assert.deepEqual(m.map((e) => e.id), [1]); assert.equal(m[0]._for, "The Continental Club");
  assert.match(overpassNearQuery([p]), /nwr\(around:250,30\.249900,-97\.749400\)\["name"\]/);
});

test("venue notes by coordinates attach to the Qloo pick even when OSM spells it differently", async () => {
  _reset();
  const osm = { elements: [{ type: "node", id: 77, lat: 30.25, lon: -97.7495, timestamp: "2026-03-01T00:00:00Z", tags: { name: "Continental Club", amenity: "bar", live_music: "yes" } }] };
  const { out: notes, calls } = await stub(() => ok(osm), () => venueNotes({}, { city: "Austin", names: [{ name: "The Continental Club", lat: 30.2499, lon: -97.7494 }], mock: false }));
  assert.equal(calls.length, 1); assert.match(decodeURIComponent(calls[0].init.body), /around:250/);
  assert.equal(notes.length, 1); assert.equal(notes[0].for, "The Continental Club");
  assert.equal(notes[0].source.url, "https://www.openstreetmap.org/node/77"); assert.equal(notes[0].date, "2026-03-01");
  const ranked = { place: blend([ENT("The Continental Club", 30.2499, -97.7494)]) };
  assert.equal(ranked.place[0].lat, 30.2499);
  const days = buildPlan({ seeds: [{ name: "X" }], ranked, live: { events: [], notes }, weekend: { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" }, city: "Austin" });
  assert.match(days.fri.find((i) => i.type === "place").notes[0].text, /bar · live music: yes/);
});

import { coordsFrom } from "../src/logic.js";
test("coordsFrom reads location, geocode and latitude/longitude shapes", () => {
  assert.deepEqual(coordsFrom({ location: { lat: 1, lon: 2 } }), { lat: 1, lon: 2 });
  assert.deepEqual(coordsFrom({ properties: { geocode: { latitude: 3, longitude: 4 } } }), { lat: 3, lon: 4 });
  assert.deepEqual(coordsFrom({ location: { lat: 5, lng: 6 } }), { lat: 5, lon: 6 });
  assert.deepEqual(coordsFrom({ name: "x" }), {});
});
