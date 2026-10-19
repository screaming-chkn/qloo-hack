import test from "node:test";
import assert from "node:assert/strict";
import { cityZone, localToday, weekendOf, offWeekendLabel, DEFAULT_ZONE } from "../src/dates.js";
import { tmUrl, tmEvents, _reset } from "../src/live.js";

// Sun Oct 18 2026, 5:30 PM PDT == Mon Oct 19, 00:30 UTC.
const SUN_530_PT = new Date("2026-10-19T00:30:00Z");

test("Sunday 5:30 PM PT is still this weekend for a PT city (UTC already says Monday)", () => {
  for (const city of ["Los Angeles", "San Francisco, CA", "94110", "Nowhereville"]) {
    const today = localToday(city, SUN_530_PT);
    assert.equal(today, "2026-10-18", city);
    assert.deepEqual(weekendOf(today), { fri: "2026-10-16", sat: "2026-10-17", sun: "2026-10-18" });
  }
  assert.equal(weekendOf("2026-10-19").fri, "2026-10-23"); // what the old UTC calc gave
});

test("Chicago/Central: flips at Central midnight", () => {
  assert.equal(cityZone("Chicago"), "America/Chicago"); assert.equal(cityZone("Austin, TX"), "America/Chicago"); assert.equal(cityZone("60614"), "America/Chicago");
  assert.equal(localToday("Chicago", new Date("2026-10-19T04:30:00Z")), "2026-10-18"); // Sun 11:30 PM CDT
  assert.equal(localToday("Chicago", new Date("2026-10-19T05:30:00Z")), "2026-10-19"); // Mon 12:30 AM CDT
  assert.equal(weekendOf(localToday("Chicago", SUN_530_PT)).sun, "2026-10-18");
});

test("zone map: known cities, state codes, ZIPs, default PT", () => {
  assert.equal(cityZone("Brooklyn"), "America/New_York"); assert.equal(cityZone("Denver, CO"), "America/Denver"); assert.equal(cityZone("10001"), "America/New_York");
  assert.equal(cityZone("Springfield, IL"), "America/Chicago"); assert.equal(cityZone(""), DEFAULT_ZONE); assert.equal(cityZone("Atlantis"), DEFAULT_ZONE);
});

test("TM window, cache key and labels follow the local weekend", async () => {
  const w = weekendOf(localToday("Los Angeles", SUN_530_PT));
  assert.match(tmUrl("K", "Los Angeles, CA", w), /startDateTime=2026-10-16T00/);
  assert.equal(offWeekendLabel("2026-10-24", w), "Next week: Sat Oct 24");
  _reset(); const o = globalThis.fetch; let n = 0;
  globalThis.fetch = async () => { n++; return new Response(JSON.stringify({})); };
  try {
    const sleep = async () => {};
    await tmEvents({ TICKETMASTER_API_KEY: "K" }, "Los Angeles", w, { sleep, now: 1 });
    await tmEvents({ TICKETMASTER_API_KEY: "K" }, "Los Angeles", weekendOf("2026-10-18"), { sleep, now: 2 });
    assert.equal(n, 1, "same local weekend -> same cache key");
  } finally { globalThis.fetch = o; }
});
