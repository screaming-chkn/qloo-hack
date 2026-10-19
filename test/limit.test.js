import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLimit, takeAiCall, aiCap, AiBudget, clientKey } from "../src/limit.js";

const mem = () => { const m = new Map(); return { get: async k => m.get(k), put: async (k, v) => m.set(k, v), delete: async k => m.delete(k), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) }; };
const ns = () => { const o = new AiBudget({ storage: mem() }); return { idFromName: n => n, get: () => ({ fetch: u => o.fetch(new Request(u)) }) }; };

test("limit fails open without binding", async () => assert.equal((await checkLimit(new Request("http://x"), {})).ok, true));
test("limit keys by IP and blocks", async () => {
  const seen = []; const env = { RATE_LIMITER: { limit: async ({ key }) => (seen.push(key), { success: seen.length <= 1 }) } };
  const r = new Request("http://x", { headers: { "cf-connecting-ip": "1.2.3.4" } });
  assert.equal(clientKey(r), "1.2.3.4");
  assert.equal((await checkLimit(r, env)).ok, true);
  assert.equal((await checkLimit(r, env)).ok, false);
});
test("ai cap default and var", () => { assert.equal(aiCap({}), 200); assert.equal(aiCap({ AI_DAILY_CAP: "5" }), 5); });
test("daily ai cap enforced and resets next day", async () => {
  const env = { AI_DAILY_CAP: "2", AI_BUDGET: ns() }; const d1 = new Date("2026-10-12T10:00:00Z");
  assert.equal((await takeAiCall(env, d1)).ok, true);
  assert.equal((await takeAiCall(env, d1)).ok, true);
  assert.equal((await takeAiCall(env, d1)).ok, false);
  assert.equal((await takeAiCall(env, new Date("2026-10-13T00:00:01Z"))).ok, true);
});

test("fast plan and /picks use separate per-IP buckets", async () => {
  const { handle } = await import("../src/index.js");
  const keys = []; const RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: true }; } };
  const req = (p) => handle(new Request("http://x" + p, { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify({ seeds: ["Prince"], city: "Austin" }) }), { MOCK: "1", RATE_LIMITER });
  await req("/api/plan?stage=fast"); await req("/api/picks");
  assert.deepEqual(keys, ["fast:1.2.3.4", "picks:1.2.3.4"]);
});

test("/picks uses its own 20/min binding when bound", async () => {
  const { handle } = await import("../src/index.js");
  const hits = []; const mk = (n) => ({ limit: async () => { hits.push(n); return { success: true }; } });
  await handle(new Request("http://x/api/picks", { method: "POST", body: JSON.stringify({ seeds: ["Prince"], city: "Austin" }) }), { MOCK: "1", RATE_LIMITER: mk("main"), RATE_LIMITER_PICKS: mk("picks") });
  assert.deepEqual(hits, ["picks"]);
});
