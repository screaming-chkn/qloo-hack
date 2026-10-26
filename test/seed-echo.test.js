import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, pubPick, pubSeeds, pubTrace } from "../src/index.js";

const post = (b) => handle(new Request("http://x/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ today: "2026-10-12", ...b }) }), {});
const NAME = "Zorblat Quenwick";

test("needsPick never echoes the raw seed text; picks by position resolve it", async () => {
  const seeds = ["Dune", "Prince", "Waffle House"];
  const r = await post({ seeds, city: "Austin" }); const txt = await r.text(); const b = JSON.parse(txt);
  assert.equal(r.status, 200); assert.equal(b.needsPick.length, 1);
  assert.deepEqual(Object.keys(b.needsPick[0]).sort(), ["i", "label", "options"]);
  for (const o of b.needsPick[0].options) assert.ok(!("seed" in o));
  assert.ok(!b.trace.some((t) => t.params?.query && t.params.query !== "[seed]"));
  const two = JSON.parse(await (await post({ seeds, city: "Austin", picks: { [b.needsPick[0].i]: b.needsPick[0].options[1].entity_id } })).text());
  assert.ok(!two.needsPick); assert.ok(two.days);
  assert.ok(two.seeds.every((s) => !("seed" in s))); assert.equal(typeof two.unresolved, "number");
});

test("public shapers drop the raw seed text (needsPick, seeds, trace)", () => {
  const seed = `${NAME} likes tacos, Springfield, Saturday`;
  const opt = { seed, entity_id: "E1", name: "Tinga Tacos", type: "place" };
  const out = JSON.stringify({ p: pubPick([{ seed, options: [opt, { ...opt, entity_id: "E2" }] }], ["x", seed]), s: pubSeeds([opt]), t: pubTrace([{ path: "/search", params: { query: seed, take: "5" } }]) });
  assert.doesNotMatch(out, /Zorblat|Quenwick|Springfield/);
  assert.match(out, /Tinga Tacos/); assert.match(out, /"i":1/);
});

test("old clients that key picks by seed text still work", async () => {
  const b = JSON.parse(await (await post({ seeds: ["Dune"], city: "Austin" })).text());
  const id = b.needsPick[0].options[0].entity_id;
  const two = JSON.parse(await (await post({ seeds: ["Dune"], city: "Austin", picks: { Dune: id } })).text());
  assert.ok(!two.needsPick); assert.ok(two.seeds.some((s) => s.entity_id === id));
});
