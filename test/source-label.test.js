import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTm, hostLabel } from "../src/live.js";

test("event links are labeled by their real host", () => {
  assert.equal(hostLabel("https://www.ticketmaster.com/event/Z7r9"), "Ticketmaster");
  assert.equal(hostLabel("https://concerts.livenation.ticketmaster.com/x"), "Ticketmaster");
  assert.equal(hostLabel("https://www.ticketweb.com/event/x/1"), "TicketWeb");
  assert.equal(hostLabel("https://stubbsaustin.com/gospel-brunch/"), "stubbsaustin.com");
  assert.equal(hostLabel("https://www.example-venue.com/a"), "example-venue.com");
  assert.equal(hostLabel("https://faketicketmaster.com/a"), "faketicketmaster.com");
});

test("mapTm keeps Ticketmaster as the data source but labels the link by host", () => {
  const ev = (url) => ({ name: "Gospel Brunch", url, dates: { start: { localDate: "2026-10-31" } }, _embedded: { venues: [{ name: "Stubb's" }] } });
  const [a, b] = mapTm({ _embedded: { events: [ev("https://stubbsaustin.com/gospel-brunch/"), ev("https://www.ticketmaster.com/event/X")] } });
  assert.deepEqual(a.source, { name: "stubbsaustin.com", via: "Ticketmaster", url: "https://stubbsaustin.com/gospel-brunch/" });
  assert.equal(b.source.name, "Ticketmaster");
});
