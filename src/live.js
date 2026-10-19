// Live local layer: this weekend's events (Ticketmaster Discovery) + venue notes (OpenStreetMap/Overpass).
// Every item must carry a source (https link) + date, or it is dropped.
import { mockLive, mockNotes } from "../fixtures/live.js";
import { inWindow, addDays, localToday } from "./dates.js";

export const TM_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
export const OVERPASS = "https://overpass-api.de/api/interpreter";
export const OSM_CREDIT = { name: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };
export const TM_CACHE_MS = 10 * 60 * 1000;   // TM terms: cache event content only for reasonable periods
export const OSM_CACHE_MS = 60 * 60 * 1000;  // Overpass is fair-use: cache per city/name set
export const TM_GAP_MS = 500;
export const TM_NEG_429_MS = 60 * 1000, TM_NEG_ERR_MS = 30 * 1000; // remember a failed call briefly so we don't hammer TM                // design for 2 requests/second
export const OSM_TIMEOUT_MS = 4000;          // Overpass is slow for big cities: skip notes rather than stall the plan

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function keepSourced(items, w) {
  return (items || []).filter((i) => {
    if (!i?.source?.name || !/^https:\/\//.test(i?.source?.url || "")) return false;
    if (!DATE.test(i.date || "")) return false;
    if (i.kind === "event") return inWindow(i.date, w);
    if (i.kind === "note") return !!i.place && !!i.text;
    return false;
  });
}

// Tiny per-isolate TTL cache + 2 rps throttle for Ticketmaster.
const cache = new Map();
export function _reset() { cache.clear(); inflight.clear(); lastTm = 0; }
// Concurrent identical TM requests (same cache key) share one in-flight call.
const inflight = new Map();
// Guards against a shared promise that never settles (on Workers a subrequest can be cancelled once the
// request that started it has ended). The throttle slot is reserved up front, so its wait is known; the fetch
// timeout and the waiter cap both start only after that wait: deadline = start + queue wait + ms + 500.
// A slot further out than TM_MAX_QUEUE_MS (wide: TM_WIDE_MAX_QUEUE_MS) is not taken (fallback now), so total wait stays <= maxQueue + ms + 500.
// The starting request keeps the call alive with ctx.waitUntil when ctx is available.
export const tmTimeout = (env) => Number(env?.TM_TIMEOUT_MS ?? 3000);
// Weekend events (shown on every plan) may queue up to 10s (bound 13.5s total); the optional wide music search
// gives way after 2s so it doesn't push weekend calls back in a multi-city burst.
export const tmMaxQueue = (env) => Number(env?.TM_MAX_QUEUE_MS ?? 10000);
export const tmWideMaxQueue = (env) => Number(env?.TM_WIDE_MAX_QUEUE_MS ?? 2000);
const once = (k, f, { ctx, ms = 3000, maxQueue = 8000, fallback } = {}) => {
  const e = inflight.get(k);
  let p, deadline;
  if (e && Date.now() <= e.deadline) ({ p, deadline } = e);
  else {
    const wait = reserveTm();
    if (wait > maxQueue) { lastTm -= TM_GAP_MS; return Promise.resolve(fallback()); }
    deadline = Date.now() + wait + ms + 500;
    const q = f(wait).finally(() => { if (inflight.get(k)?.p === q) inflight.delete(k); });
    inflight.set(k, { p: q, deadline }); p = q;
    try { ctx?.waitUntil?.(q); } catch {}
  }
  let timer;
  const guard = new Promise((r) => { timer = setTimeout(() => r(fallback()), Math.max(0, deadline - Date.now())); });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
};
const getC = (k, now) => { const h = cache.get(k); if (h && h.exp > now) return h.v; cache.delete(k); };
const putC = (k, v, ttl, now) => { cache.set(k, { v, exp: now + ttl }); if (cache.size > 200) cache.delete(cache.keys().next().value); };
const negGet = (ck, now) => getC("neg|" + ck, now);
const negPut = (ck, status, now) => { putC("neg|" + ck, status, status === "rate_limited" ? TM_NEG_429_MS : TM_NEG_ERR_MS, now); return status; };
let lastTm = 0;
// Reserve the next 2/s Ticketmaster slot synchronously; returns how long to wait for it.
function reserveTm() {
  const now = Date.now(), wait = Math.max(0, lastTm + TM_GAP_MS - now);
  lastTm = Math.max(now, lastTm + TM_GAP_MS);
  return wait;
}
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function tmUrl(key, city, w) {
  const q = new URLSearchParams({ apikey: key, startDateTime: `${w.fri}T00:00:00Z`, endDateTime: `${addDays(w.sun, 1)}T11:59:59Z`, size: "40", sort: "date,asc" });
  const zip = (city.match(/\b\d{5}\b/) || [])[0];
  if (zip) q.set("postalCode", zip);
  else {
    const [name, st] = city.split(",").map((s) => s.trim());
    q.set("city", name);
    if (/^[A-Za-z]{2}$/.test(st || "")) q.set("stateCode", st.toUpperCase());
  }
  return `${TM_BASE}?${q}`;
}

export function mapTm(json) {
  return (json?._embedded?.events || []).map((e) => ({
    kind: "event", title: e.name, venue: e._embedded?.venues?.[0]?.name || "", date: e.dates?.start?.localDate, time: e.dates?.start?.localTime || "",
    source: { name: "Ticketmaster", url: e.url },
    ...(e.classifications?.[0]?.segment?.name ? { segment: e.classifications[0].segment.name } : {}),
  }));
}

export async function tmEvents(env, city, w, { sleep = realSleep, now = Date.now(), ctx } = {}) {
  const ms = tmTimeout(env);
  const key = env.TICKETMASTER_API_KEY;
  if (!key) return { events: [], status: "no_key" };
  const ck = `tm|${city.toLowerCase()}|${w.fri}`;
  const hit = getC(ck, now); if (hit) return { events: hit, status: "ok" };
  const neg = negGet(ck, now); if (neg) return { events: [], status: neg };
  return once(ck, async (wait) => { try {
    if (wait > 0) await sleep(wait);
    const r = await fetch(tmUrl(key, city, w), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return { events: [], status: negPut(ck, r.status === 429 ? "rate_limited" : "error", now) };
    const events = keepSourced(mapTm(await r.json()), w);
    putC(ck, events, TM_CACHE_MS, now);
    return { events, status: "ok" };
  } catch { return { events: [], status: negPut(ck, "error", now) }; } }, { ctx, ms, maxQueue: tmMaxQueue(env), fallback: () => ({ events: [], status: "error" }) });
}

// Wider music search for an empty "hear" slot: 50 miles, today + 14 days, music only.
// At most one extra Ticketmaster call per request; cached per city/day like the weekend call.
export const WIDE_RADIUS_MI = 50, WIDE_DAYS = 14;
export function tmWideUrl(key, city, today) {
  const q = new URLSearchParams({ apikey: key, classificationName: "music", radius: String(WIDE_RADIUS_MI), unit: "miles", startDateTime: `${today}T00:00:00Z`, endDateTime: `${addDays(today, WIDE_DAYS)}T23:59:59Z`, size: "20", sort: "date,asc" });
  const zip = (city.match(/\b\d{5}\b/) || [])[0];
  if (zip) q.set("postalCode", zip);
  else {
    const [name, st] = city.split(",").map((s) => s.trim());
    q.set("city", name);
    if (/^[A-Za-z]{2}$/.test(st || "")) q.set("stateCode", st.toUpperCase());
  }
  return `${TM_BASE}?${q}`;
}
// Dates are the city's local calendar date (its own zone), never the UTC date.
export async function tmWideMusic(env, city, { sleep = realSleep, now = Date.now(), ctx } = {}) {
  const ms = tmTimeout(env);
  const key = env.TICKETMASTER_API_KEY;
  if (!key) return [];
  const today = localToday(city, new Date(now));
  const ck = `tmw|${city.toLowerCase()}|${today}`;
  const hit = getC(ck, now); if (hit) return hit;
  if (negGet(ck, now)) return [];
  const win = { fri: today, sun: addDays(today, WIDE_DAYS) };
  return once(ck, async (wait) => { try {
    if (wait > 0) await sleep(wait);
    const r = await fetch(tmWideUrl(key, city, today), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) { negPut(ck, r.status === 429 ? "rate_limited" : "error", now); return []; }
    const events = collapseEvents(keepSourced(mapTm(await r.json()), win).map((e) => ({ segment: "Music", ...e })));
    putC(ck, events, TM_CACHE_MS, now);
    return events;
  } catch { negPut(ck, "error", now); return []; } }, { ctx, ms, maxQueue: tmWideMaxQueue(env), fallback: () => [] });
}

const reEsc = (s) => s.replace(/[\\^$.*+?()[\]{}|"]/g, "\\$&");
export function overpassQuery(city, names) {
  const area = city.split(",")[0].replace(/["\\]/g, "").trim();
  const rx = names.map((n) => reEsc(n)).join("|");
  return `[out:json][timeout:10];area["name"="${area}"]["boundary"="administrative"]->.a;nwr(area.a)["name"~"^(${rx})$",i];out tags meta 20;`;
}

const LABEL = { cuisine: "cuisine", opening_hours: "hours", outdoor_seating: "outdoor seating", wheelchair: "wheelchair", live_music: "live music", diet_vegetarian: "vegetarian" };
export function mapOsm(json) {
  const seen = new Set(); const out = [];
  for (const el of json?.elements || []) {
    const t = el.tags || {}; const k = String(t.name || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    const kind = t.amenity || t.shop || t.tourism || t.leisure || t.historic;
    const bits = [kind && kind.replace(/_/g, " "), ...Object.entries(LABEL).filter(([f]) => t[f]).map(([f, l]) => `${l}: ${t[f].replace(/_/g, " ").replace(/;/g, ", ")}`)].filter(Boolean);
    if (!bits.length) continue;
    seen.add(k);
    out.push({ kind: "note", place: t.name, text: bits.join(" · "), date: String(el.timestamp || "").slice(0, 10),
      source: { name: OSM_CREDIT.name, url: `https://www.openstreetmap.org/${el.type}/${el.id}` } });
  }
  return out;
}

// Fuzzy name match: "The Continental Club" ~ "Continental Club", "Joe's Bar & Grill" ~ "Joes Bar and Grill".
export const NEAR_M = 250;
export const normName = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
export function nameSimilar(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))) return true;
  const A = new Set(x.split(" ")), B = new Set(y.split(" "));
  const common = [...A].filter((t) => B.has(t)).length;
  return common / Math.max(A.size, B.size) >= 0.6;
}
export function metersBetween(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const coordsOf = (el) => (el.lat != null ? { lat: el.lat, lon: el.lon } : el.center ? { lat: el.center.lat, lon: el.center.lon } : null);
export function overpassNearQuery(places) {
  const f = (n) => Number(n).toFixed(6);
  return `[out:json][timeout:8];(${places.map((p) => `nwr(around:${NEAR_M},${f(p.lat)},${f(p.lon)})["name"];`).join("")});out tags meta center 200;`;
}
// Keep only OSM elements whose name fuzzily matches a Qloo place within NEAR_M of its coordinates.
export function matchNear(json, places) {
  const els = [];
  for (const p of places) {
    const hits = (json?.elements || []).map((el) => ({ el, c: coordsOf(el) }))
      .filter(({ el, c }) => c && nameSimilar(el.tags?.name, p.name) && metersBetween(p, c) <= NEAR_M)
      .sort((u, v) => metersBetween(p, u.c) - metersBetween(p, v.c));
    for (const h of hits) els.push({ ...h.el, _for: p.name });
  }
  return els;
}

export async function venueNotes(env, { city, names, mock, cacheOnly = false, now = Date.now() }) {
  const all = (names || []).filter(Boolean).map((n) => (typeof n === "string" ? { name: n } : n));
  const seenN = new Set(); const items = all.filter((p) => p.name && !seenN.has(p.name) && seenN.add(p.name)).slice(0, 6);
  const list = items.map((p) => p.name);
  if (!list.length) return [];
  if (mock) return keepSourced(mockNotes(list, now), null);
  const near = items.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (near.length) return nearNotes(env, city, near, now, cacheOnly);
  // Name-only Overpass is ~30s live; keep it off the request path unless opted in.
  if (!env.OSM_NAME_FALLBACK && !cacheOnly) return [];
  const ck = `osm|${city.toLowerCase()}|${list.join("|").toLowerCase()}`;
  const hit = getC(ck, now); if (hit) return hit;
  if (cacheOnly) return [];
  try {
    const r = await fetch(env.OVERPASS_URL || OVERPASS, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "screaming-chicken-weekend (hackathon demo)" }, body: "data=" + encodeURIComponent(overpassQuery(city, list)), signal: AbortSignal.timeout(env.OSM_TIMEOUT_MS ?? OSM_TIMEOUT_MS) });
    if (!r.ok) return [];
    const notes = keepSourced(mapOsm(await r.json()), null);
    putC(ck, notes, OSM_CACHE_MS, now);
    return notes;
  } catch { return []; }
}

async function nearNotes(env, city, places, now, cacheOnly = false) {
  const ck = `osmnear|${places.map((p) => `${p.name}@${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join("|").toLowerCase()}`;
  const hit = getC(ck, now); if (hit) return hit;
  if (cacheOnly) return [];
  try {
    const r = await fetch(env.OVERPASS_URL || OVERPASS, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "screaming-chicken-weekend (hackathon demo)" }, body: "data=" + encodeURIComponent(overpassNearQuery(places)), signal: AbortSignal.timeout(env.OSM_TIMEOUT_MS ?? OSM_TIMEOUT_MS) });
    if (!r.ok) return [];
    const els = matchNear(await r.json(), places);
    const out = []; const done = new Set();
    for (const el of els) {
      if (done.has(el._for)) continue;
      const [n] = mapOsm({ elements: [el] });
      if (n) { done.add(el._for); out.push({ ...n, for: el._for }); }
    }
    const notes = keepSourced(out, null);
    putC(ck, notes, OSM_CACHE_MS, now);
    return notes;
  } catch { return []; }
}

// Events: fixtures in mock mode; Ticketmaster otherwise (no key -> empty + status, plan still renders).
export async function liveLayer(env, { city, weekend, today, mock, ctx }, opts) {
  if (mock) return { events: collapseEvents(keepSourced(mockLive(city, weekend, today).events, weekend)), status: "mock" };
  const { events, status } = await tmEvents(env, city, weekend, { ...opts, ctx });
  return { events: collapseEvents(events), status };
}

// One entry per (name, venue): repeat shows of the same act at the same venue become a showtimes list.
export function collapseEvents(events) {
  const by = new Map();
  for (const e of [...events].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))) {
    const k = `${String(e.title).toLowerCase().trim()}|${String(e.venue).toLowerCase().trim()}`;
    const st = { date: e.date, time: e.time || "", url: e.source.url };
    const hit = by.get(k);
    if (hit) { if (!hit.showtimes.some((x) => x.date === st.date && x.time === st.time)) hit.showtimes.push(st); }
    else by.set(k, { ...e, showtimes: [st] });
  }
  return [...by.values()];
}
