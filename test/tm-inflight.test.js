import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { _reset } from "../src/live.js";
import { _resetQloo } from "../src/qloo.js";

test("concurrent identical plans share one in-flight TM call per key (weekend + wide = 2)", async () => {
  _reset(); _resetQloo(); const o = globalThis.fetch; let tm = 0;
  const ok = (j) => new Response(JSON.stringify(j));
  globalThis.fetch = async (u) => { u = String(u);
    if (u.includes("ticketmaster")) { tm++; await new Promise((r) => setTimeout(r, 50)); return ok({ _embedded: { events: [] } }); }
    if (u.includes("overpass")) return ok({ elements: [] });
    return u.includes("/search") ? ok({ results: [{ entity_id: "E1", name: "Dune", types: ["urn:entity:movie"] }] }) : ok({ results: { entities: [] } }); };
  try {
    const env = { QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T", QLOO_STAGGER_MS: "0" };
    const req = (p) => handle(new Request("http://x" + p, { method: "POST", body: JSON.stringify({ seeds: ["Dune"], city: "Chicago, IL" }) }), env);
    const rs = await Promise.all([...Array(5)].flatMap(() => [req("/api/picks"), req("/api/plan?stage=fast")]));
    assert.ok(rs.every((r) => r.status === 200)); assert.equal(tm, 2);
  } finally { globalThis.fetch = o; }
});
