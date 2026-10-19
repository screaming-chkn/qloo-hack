import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { _reset, tmWideMusic } from "../src/live.js";
import { _resetQloo } from "../src/qloo.js";

const ok = (j) => new Response(JSON.stringify(j));
const qloo = (u) => u.includes("/search") ? ok({ results: [{ entity_id: "E1", name: "Dune", types: ["urn:entity:movie"] }] }) : ok({ results: { entities: [] } });

test("TM fetch that never settles (ignores abort): plan returns within timeout+margin, entry cleared, next call refetches", async () => {
  _reset(); _resetQloo(); const o = globalThis.fetch; let tm = 0;
  globalThis.fetch = async (u) => { u = String(u);
    if (u.includes("ticketmaster")) { tm++; return new Promise(() => {}); }
    if (u.includes("overpass")) return ok({ elements: [] });
    return qloo(u); };
  try {
    const env = { QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T", QLOO_STAGGER_MS: "0", TM_TIMEOUT_MS: "200" };
    const req = () => handle(new Request("http://x/api/picks", { method: "POST", body: JSON.stringify({ seeds: ["Dune"], city: "Chicago, IL" }) }), env);
    const t0 = Date.now(); const r = await req(); const dt = Date.now() - t0;
    assert.equal(r.status, 200); assert.ok(dt < 200 + 500 + 1500, `took ${dt}ms`);
    const n = tm;
    await new Promise((s) => setTimeout(s, 750)); // past the age guard (ms + 500)
    const sleep = async () => {};
    const p = tmWideMusic(env, "Chicago, IL", { sleep });
    await new Promise((s) => setTimeout(s, 20));
    assert.equal(tm, n + 1, "stale entry replaced by a fresh fetch");
    assert.deepEqual(await p, []);
  } finally { globalThis.fetch = o; }
});

test("TM fetch aborted by timeout goes into failure memory (no refetch inside 30s)", async () => {
  _reset(); const o = globalThis.fetch; let tm = 0;
  globalThis.fetch = (u, init) => { tm++; return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason))); };
  try {
    const env = { TICKETMASTER_API_KEY: "T", TM_TIMEOUT_MS: "50" }, sleep = async () => {};
    assert.deepEqual(await tmWideMusic(env, "Austin, TX", { sleep }), []);
    assert.deepEqual(await tmWideMusic(env, "Austin, TX", { sleep }), []);
    assert.equal(tm, 1);
  } finally { globalThis.fetch = o; }
});

test("shared TM promise is registered with ctx.waitUntil by the request that started it (once per key)", async () => {
  _reset(); _resetQloo(); const o = globalThis.fetch; const held = [];
  globalThis.fetch = async (u) => { u = String(u);
    if (u.includes("ticketmaster")) { await new Promise((r) => setTimeout(r, 30)); return ok({ _embedded: { events: [] } }); }
    if (u.includes("overpass")) return ok({ elements: [] });
    return qloo(u); };
  try {
    const sleep = async () => {}, ctx = { waitUntil: (p) => held.push(p) };
    const env = { TICKETMASTER_API_KEY: "T" };
    const a = tmWideMusic(env, "Boise, ID", { sleep, ctx }), b = tmWideMusic(env, "Boise, ID", { sleep, ctx });
    assert.equal(held.length, 1); assert.ok(held[0] instanceof Promise);
    await Promise.all([a, b, held[0]]);
    const ctx2 = { waitUntil: (p) => held.push(p) };
    const r = await handle(new Request("http://x/api/picks", { method: "POST", body: JSON.stringify({ seeds: ["Dune"], city: "Reno, NV" }) }), { QLOO_API_KEY: "Q", TICKETMASTER_API_KEY: "T", QLOO_STAGGER_MS: "0" }, ctx2);
    assert.equal(r.status, 200); assert.ok(held.length >= 3, "weekend + wide both registered");
  } finally { globalThis.fetch = o; }
});
