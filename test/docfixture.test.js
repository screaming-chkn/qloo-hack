// Real-mode Qloo and Ticketmaster adapters against test/fixtures. fetch is stubbed.
import { beforeEach as __be } from "node:test"; import { _resetQloo as __rq } from "../src/qloo.js"; __be(() => __rq());
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handle } from "../src/index.js";
import { searchSeeds, insightsFor } from "../src/qloo.js";
import { tmEvents, mapTm, _reset, TM_GAP_MS, TM_CACHE_MS } from "../src/live.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const SEARCH = load("qloo-search.json");
const EMPTY = load("qloo-search-empty.json");
const INSIGHTS = load("qloo-insights-movie.json");
const TM = load("ticketmaster-events-austin.json");

// Recorded events fall on 2026-10-12 and 2026-10-13. inWindow is an inclusive date range.
const WIN = { fri: "2026-10-12", sat: "2026-10-13", sun: "2026-10-14" };
const QLOO = { QLOO_API_KEY: "K", MOCK: "0" };
const TMENV = { TICKETMASTER_API_KEY: "K" };
const nap = () => Promise.resolve();
const ok = (j) => new Response(JSON.stringify(j), { status: 200 });

beforeEach(() => _reset());

async function stub(impl, fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init) => {
    calls.push({ url: String(u), init });
    return impl(String(u), init);
  };
  try { return { out: await fn(), calls }; }
  finally { globalThis.fetch = orig; }
}

test("Qloo search fixture: real mode parses the exact-name movie", async () => {
  const trace = [];
  const { out, calls } = await stub(() => ok(SEARCH), () => searchSeeds(QLOO, ["Blade Runner"], {}, trace));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hackathon.api.qloo.com/search?query=Blade+Runner&take=5");
  assert.equal(calls[0].init.headers["X-Api-Key"], "K");
  assert.deepEqual(out, {
    resolved: [{ seed: "Blade Runner", entity_id: "636E1B95-6232-43E1-BDFE-37CD209C2CE3", name: "Blade Runner", type: "movie", year: 1982 }],
    needsPick: [],
    unresolved: [],
  });
  assert.deepEqual(trace, [{ path: "/search", params: { query: "Blade Runner", take: "5" }, write: "ok" }]);
  assert.equal(SEARCH._source.url, "https://docs.qloo.com/reference/search-entities");
  assert.match(SEARCH._source.kind, /not live/);
});

test("Qloo insights fixture: real mode parses filter.type movie entities", async () => {
  const id = "636E1B95-6232-43E1-BDFE-37CD209C2CE3";
  const trace = [];
  const { out, calls } = await stub(
    () => ok(INSIGHTS),
    () => insightsFor(QLOO, { type: "movie", entityIds: [id], take: 2 }, trace),
  );
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://hackathon.api.qloo.com/v2/insights");
  assert.equal(u.searchParams.get("filter.type"), "urn:entity:movie");
  assert.equal(u.searchParams.get("signal.interests.entities"), id);
  assert.equal(u.searchParams.get("take"), "2");
  assert.equal(calls[0].init.headers["X-Api-Key"], "K");
  assert.deepEqual(out, INSIGHTS.results.entities);
  assert.deepEqual(out.map((e) => [e.name, e.query.affinity, e.properties.release_year]), [
    ["Thief", 0.93, 1981],
    ["Streets of Fire", 0.88, 1984],
  ]);
  assert.equal(trace[0].params["filter.type"], "urn:entity:movie");
  assert.equal(INSIGHTS._source.url, "https://docs.qloo.com/reference/insights-api-deep-dive");
});

test("empty Qloo search fixture: real mode returns unresolved and does not throw", async () => {
  const { out, calls } = await stub(() => ok(EMPTY), () => searchSeeds(QLOO, ["Blade Runner"], {}, []));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/search\?query=Blade\+Runner&take=5$/);
  assert.deepEqual(out, { resolved: [], needsPick: [], unresolved: ["Blade Runner"] });
  assert.equal(EMPTY._source.url, "https://docs.qloo.com/reference/search-entities");
  assert.match(EMPTY._source.kind, /empty result/);
});

test("429 backoff: one Qloo try then retry-after; TM 429 is rate_limited and not retried", async () => {
  const q = await stub(
    () => new Response("", { status: 429 }),
    async () => {
      const r = await handle(new Request("http://x/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seeds: ["Blade Runner"], city: "Austin" }),
      }), QLOO);
      return { status: r.status, retry: r.headers.get("retry-after"), body: await r.json() };
    },
  );
  assert.equal(q.calls.length, 1);
  assert.match(q.calls[0].url, /^https:\/\/hackathon\.api\.qloo\.com\/search\?/);
  assert.equal(q.out.status, 429);
  assert.equal(q.out.retry, "60");
  assert.equal(q.out.body.retryAfter, 60);
  assert.equal(q.out.body.error, "rate_limited");
  assert.match(q.out.body.message, /Catching our breath, try again in a minute/);
  assert.doesNotMatch(JSON.stringify(q.out.body), /"K"|stack/);

  _reset();
  const tm = await stub(
    () => new Response(JSON.stringify(TM), { status: 429 }),
    () => tmEvents(TMENV, "Austin, TX", WIN, { sleep: nap }),
  );
  assert.equal(tm.calls.length, 1);
  assert.match(tm.calls[0].url, /^https:\/\/app\.ticketmaster\.com\/discovery\/v2\/events\.json\?/);
  assert.deepEqual(tm.out, { events: [], status: "rate_limited" });
});

test("recorded Ticketmaster fixture parses on the real tmEvents path", async () => {
  const mapped = mapTm(TM);
  assert.equal(mapped.length, TM._embedded.events.length);
  TM._embedded.events.forEach((src, i) => {
    assert.equal(mapped[i].title, src.name);
    assert.equal(mapped[i].venue, src._embedded.venues[0].name);
    assert.equal(mapped[i].date, src.dates.start.localDate);
    assert.deepEqual(mapped[i].source, { name: "Ticketmaster", url: src.url });
    assert.match(src.url, /^https:\/\/www\.ticketmaster\.com\//);
  });
  const { out, calls } = await stub(() => ok(TM), () => tmEvents(TMENV, "Austin, TX", WIN, { sleep: nap }));
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://app.ticketmaster.com/discovery/v2/events.json");
  assert.equal(u.searchParams.get("city"), "Austin");
  assert.equal(u.searchParams.get("stateCode"), "TX");
  assert.equal(out.status, "ok");
  assert.deepEqual(out.events, mapped);
  assert.equal(TM._source.url, "https://app.ticketmaster.com/discovery/v2/events.json?city=Austin&stateCode=TX&countryCode=US&size=5&sort=date,asc");
  assert.match(TM._source.note, /not a doc sample/);
});

test("TM 2/sec limit: back-to-back fixture calls wait out the gap", async () => {
  const waits = [];
  const sleep = (ms) => (waits.push(ms), Promise.resolve());
  const { calls } = await stub(() => ok(TM), async () => {
    for (const city of ["Austin, TX", "Dallas, TX", "Houston, TX"]) await tmEvents(TMENV, city, WIN, { sleep });
  });
  assert.equal(calls.length, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] > 0 && waits[0] <= TM_GAP_MS);
  assert.ok(waits[1] > TM_GAP_MS && waits[1] <= 2 * TM_GAP_MS);
});

test("TM 10-min cache hit: fixture response is reused inside the TTL", async () => {
  const t0 = 1_700_000_000_000;
  const seen = [];
  const { calls } = await stub(() => ok(TM), async () => {
    seen.push(await tmEvents(TMENV, "Austin, TX", WIN, { sleep: nap, now: t0 }));
    seen.push(await tmEvents(TMENV, "Austin, TX", WIN, { sleep: nap, now: t0 + TM_CACHE_MS - 1 }));
    seen.push(await tmEvents(TMENV, "Austin, TX", WIN, { sleep: nap, now: t0 + TM_CACHE_MS }));
  });
  assert.equal(calls.length, 2);
  assert.equal(seen[0].status, "ok");
  assert.equal(seen[0].events.length, 5);
  assert.deepEqual(seen[1], seen[0]);
  assert.deepEqual(seen[2].events.map((e) => e.title), seen[0].events.map((e) => e.title));
});
