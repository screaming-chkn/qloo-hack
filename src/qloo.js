// Qloo client. Base https://hackathon.api.qloo.com, header X-Api-Key (server-side only).
//   Search:   GET /search?query=...&take=N           -> seed text to entity IDs
//   Insights: GET /v2/insights?filter.type=urn:entity:X&signal.interests.entities=ID1,ID2
// Every outbound call is recorded in `trace` (path + params, never the key).
import { mockSearch, mockInsights } from "../fixtures/qloo.js";

export class QlooError extends Error {
  constructor(status) { super(`qloo ${status}`); this.status = status; }
}

// Global override: MOCK="force" (or legacy "1") forces every source onto fixtures.
export function mockForced(env = {}) {
  const m = String(env.MOCK ?? "").trim().toLowerCase();
  return m === "force" || m === "1";
}

// Qloo is real only when its own key is set and mocks are not forced.
export function isMock(env = {}) {
  return mockForced(env) || !env.QLOO_API_KEY;
}

// Ticketmaster: "real" (key set, not forced), "mock" (forced, or no key while Qloo is mock),
// "off" (no key while Qloo is real: no fake events next to real picks; status no_key).
export function tmMode(env = {}) {
  if (mockForced(env)) return "mock";
  if (env.TICKETMASTER_API_KEY) return "real";
  return isMock(env) ? "mock" : "off";
}

async function qget(env, path, params, trace) {
  const tr = { path, params: { ...params } }; trace.push(tr);
  if (isMock(env)) return path === "/search" ? mockSearch(params.query) : mockInsights(params);
  const base = (env.QLOO_BASE || "https://hackathon.api.qloo.com").replace(/\/$/, "");
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  // Seed lookups never change: key them case-insensitively and keep them fresh for 7 days.
  const isSearch = path === "/search", fresh = isSearch ? SEARCH_FRESH_MS : QLOO_FRESH_MS;
  const now = Date.now(), key = await ckey(isSearch ? url.toLowerCase() : url), hit = await cget(env, key);
  if (hit && !(env.QLOO_REFRESH && !isSearch) && now - hit.t < fresh) { tr.cache = "hit"; return hit.v; }
  console.log("qloo", path, JSON.stringify(params)); // request log for `wrangler tail`
  try {
    const res = await fetch(url, { headers: { "X-Api-Key": env.QLOO_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(Number(env.QLOO_TIMEOUT_MS ?? 4500)) });
    if (!res.ok) throw new QlooError(res.status);
    const v = await res.json();
    tr.write = (await cput(env, key, { t: now, v }, isSearch ? SEARCH_FRESH_MS + QLOO_STALE_MS : QLOO_STALE_MS)) ? "ok" : "fail";
    return v;
  } catch (e) {
    if (hit && now - hit.t < QLOO_STALE_MS) { tr.cache = "stale"; return hit.v; }
    throw e instanceof QlooError ? e : new QlooError(503);
  }
}
// Qloo cache: shared Workers KV (QLOO_CACHE) when bound, per-isolate Map otherwise.
// Fresh 25 min (longer than the 20-min cron); on failure serve the last good copy up to 6 h.
const QCACHE = new Map();
export const QLOO_FRESH_MS = 25 * 60e3, QLOO_STALE_MS = 6 * 3600e3, SEARCH_FRESH_MS = 7 * 86400e3;
export const _resetQloo = () => QCACHE.clear();
async function ckey(url) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.replace(/^https?:\/\/[^/]+/, "")));
  return "q:" + [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function cget(env, k) {
  if (env.QLOO_CACHE) { try { return await env.QLOO_CACHE.get(k, "json"); } catch { return null; } }
  return QCACHE.get(k) || null;
}
async function cput(env, k, val, ttlMs = QLOO_STALE_MS) {
  if (env.QLOO_CACHE) { try { await env.QLOO_CACHE.put(k, JSON.stringify(val), { expirationTtl: Math.round(ttlMs / 1000) }); return true; } catch (e) { console.log("kv put fail", String(e)); return false; } }
  if (QCACHE.size > 300) QCACHE.clear();
  QCACHE.set(k, val); return true;
}

// Seed-free venue list for a city, cached by city + category so any seeds reuse it.
export async function cityPlaces(env, city, trace = []) {
  const params = { "filter.type": "urn:entity:place", ...PLACE_FILTERS, "filter.location.query": city, "filter.location.radius": String(PLACE_RADIUS_M), take: "6" };
  const data = await qget(env, "/v2/insights", params, trace);
  return (data?.results?.entities || []).filter(isVenue);
}

const norm = (s) => String(s || "").toLowerCase().trim();
const shortType = (t) => String(t || "").replace("urn:entity:", "");

// Resolve each seed. Ambiguous -> options for the user to pick from.
export async function searchSeeds(env, seeds, picks = {}, trace = []) {
  const resolved = [], needsPick = [], unresolved = [];
  // All seeds resolve in parallel; results are processed in input order.
  const all = await Promise.all(seeds.map((seed) => qget(env, "/search", { query: seed, take: "5" }, trace)));
  seeds.forEach((seed, i) => {
    const results = (all[i]?.results || []).filter((r) => r?.entity_id);
    const chosen = picks[seed] && results.find((r) => r.entity_id === picks[seed]);
    if (chosen) { resolved.push(entityOf(seed, chosen)); return; }
    if (!results.length) { unresolved.push(seed); return; }
    const exact = results.filter((r) => norm(r.name) === norm(seed));
    const ambiguous = results.length > 1 && (exact.length !== 1);
    if (ambiguous) needsPick.push({ seed, options: results.slice(0, 5).map((r) => entityOf(seed, r)) });
    else resolved.push(entityOf(seed, exact[0] || results[0]));
  });
  return { resolved, needsPick, unresolved };
}
const entityOf = (seed, r) => ({ seed, entity_id: r.entity_id, name: r.name, type: shortType(r.types?.[0]), year: r.properties?.release_year ?? r.year });

export async function insightsFor(env, { type, entityIds, city, take = 6 }, trace = []) {
  const params = { "filter.type": `urn:entity:${type}`, "signal.interests.entities": entityIds.join(","), take: String(take) };
  if (type === "place") Object.assign(params, PLACE_FILTERS);
  if (type === "place" && city) { params["filter.location.query"] = city; params["filter.location.radius"] = String(PLACE_RADIUS_M); }
  const data = await qget(env, "/v2/insights", params, trace);
  const ents = data?.results?.entities || [];
  return type === "place" ? ents.filter(isVenue) : ents;
}

// Places: only real venues (restaurants, bars, music venues), OR-ed via operator.filter.tags=union.
// Tag IDs per docs.qloo.com Insights parameters (filter.tags / operator.filter.tags).
export const PLACE_TAGS = ["urn:tag:genre:place:restaurant", "urn:tag:genre:place:bar", "urn:tag:genre:place:music_venue"];
export const PLACE_FILTERS = { "filter.tags": PLACE_TAGS.join(","), "operator.filter.tags": "union" };
export const PLACE_RADIUS_M = 15000; // meters around the city; keeps picks drivable on a weekend
// Belt and braces: drop campus/Greek-life/civic results that slip through the tag filter.
const GREEK = "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega";
const NON_VENUE = /fraternit|sororit|greek life|panhellenic|chapter house|dormitor|residence hall|apartment|university|college|school|church|campus/i;
export function isVenue(e) {
  const text = [e?.name, ...(e?.tags || []).map((t) => `${t?.name || ""} ${t?.id || t?.tag_id || ""}`)].join(" ");
  if (NON_VENUE.test(text)) return false;
  return !new RegExp(`^(${GREEK})(\\s+(${GREEK})){1,2}$`, "i").test(String(e?.name || "").trim());
}
