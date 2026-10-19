import { test, beforeEach } from "node:test";
import { beforeEach as __be } from "node:test"; import { _resetQloo as __rq } from "../src/qloo.js"; __be(() => __rq());
import assert from "node:assert/strict";
import { isMock, tmMode, mockForced } from "../src/qloo.js";
import { handle } from "../src/index.js";
import { _reset } from "../src/live.js";

beforeEach(() => _reset());
const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
const TMJ = { _embedded: { events: [{ name: "Sat Show", url: "https://www.ticketmaster.com/event/Z1", dates: { start: { localDate: "2026-10-17" } }, _embedded: { venues: [{ name: "V" }] } }] } };
const QJ = (u) => u.includes("/search") ? ok({ results: [{ entity_id: "E1", name: "Prince", types: ["urn:entity:artist"] }] })
  : ok({ results: { entities: [{ entity_id: "P1", name: "Magnolia Cafe", popularity: 0.3, query: { affinity: 0.9 } }] } });
async function run(env) {
  const o = globalThis.fetch; const calls = [];
  globalThis.fetch = async (u) => { u = String(u); calls.push(u); return u.includes("ticketmaster") ? ok(TMJ) : u.includes("overpass") ? ok({ elements: [] }) : QJ(u); };
  try {
    const r = await handle(new Request("http://x/api/plan", { method: "POST", body: JSON.stringify({ seeds: ["Prince"], city: "Austin, TX", today: "2026-10-12" }) }), env);
    return { b: await r.json(), tm: calls.filter((c) => c.includes("ticketmaster")).length, qloo: calls.filter((c) => c.includes("qloo")).length };
  } finally { globalThis.fetch = o; }
}

test("mode table", () => {
  const T = "T", Q = "Q";
  const rows = [
    [{}, true, "mock"], [{ TICKETMASTER_API_KEY: T }, true, "real"], [{ QLOO_API_KEY: Q }, false, "off"],
    [{ QLOO_API_KEY: Q, TICKETMASTER_API_KEY: T }, false, "real"], [{ QLOO_API_KEY: Q, TICKETMASTER_API_KEY: T, MOCK: "force" }, true, "mock"],
    [{ QLOO_API_KEY: Q, TICKETMASTER_API_KEY: T, MOCK: "1" }, true, "mock"], [{ TICKETMASTER_API_KEY: T, MOCK: "0" }, true, "real"],
    [{ QLOO_API_KEY: Q, TICKETMASTER_API_KEY: T, MOCK: " FORCE " }, true, "mock"],
  ];
  for (const [env, q, t] of rows) { assert.equal(isMock(env), q, JSON.stringify(env)); assert.equal(tmMode(env), t, JSON.stringify(env)); }
  assert.equal(mockForced({ MOCK: "0" }), false);
});

test("TM key only: TM live, Qloo on fixtures", async () => {
  const r = await run({ TICKETMASTER_API_KEY: "T", MOCK: "0" });
  assert.equal(r.tm, 1); assert.equal(r.qloo, 0); assert.equal(r.b.mock, true); assert.equal(r.b.events, "ok");
});
test("Qloo key only: Qloo live, TM off (no fake events beside real picks)", async () => {
  const r = await run({ QLOO_API_KEY: "Q" });
  assert.equal(r.tm, 0); assert.ok(r.qloo > 0); assert.equal(r.b.events, "no_key");
});
test("both keys: both live", async () => {
  const r = await run({ QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T" });
  assert.ok(r.tm >= 1 && r.tm <= 2, "weekend call + at most one wide music call"); assert.ok(r.qloo > 0); assert.equal(r.b.mock, false); assert.equal(r.b.events, "ok");
});
test("no keys: both mock, zero network", async () => {
  const r = await run({});
  assert.equal(r.tm + r.qloo, 0); assert.equal(r.b.events, "mock");
});
test("MOCK=force with both keys: all mock, zero network", async () => {
  const r = await run({ QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T", MOCK: "force" });
  assert.equal(r.tm + r.qloo, 0); assert.equal(r.b.mock, true); assert.equal(r.b.events, "mock");
});
test("health reports Qloo mock state per source key", async () => {
  assert.equal((await (await handle(new Request("http://x/api/health"), { TICKETMASTER_API_KEY: "T" })).json()).mock, true);
  assert.equal((await (await handle(new Request("http://x/api/health"), { QLOO_API_KEY: "Q" })).json()).mock, false);
});
