import { PAGE } from "./page.js";
import { isMock, tmMode, searchSeeds, insightsFor, cityPlaces, QlooError } from "./qloo.js";
import { blend, buildPlan, boostedIds, hasDatedHear } from "./logic.js";
import { phrase, template } from "./ai.js";
import { liveLayer, venueNotes, tmWideMusic, OSM_CREDIT } from "./live.js";
import { weekendOf, localToday } from "./dates.js";
import { sanitizeSeed, sanitizeCity } from "./privacy.js";
import { checkLimit, takeAiCall, AiBudget } from "./limit.js";
export { AiBudget };

export const HOLD = "Catching our breath, try again in a minute.";
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
// source says whose limit it was: "limiter" (our per-IP binding) or "qloo" (upstream 429). Same message either way.
const hold = (source = "limiter", extra = {}) => json({ error: "rate_limited", message: HOLD, retryAfter: 60, source }, 429, { "retry-after": "60", "x-hold-source": source, ...extra });
const TYPES = ["movie", "artist", "place"];
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export async function plan(request, env, ctx, stage = "full") {
  const lim = await checkLimit(request, env, stage === "fast" ? "fast:" : stage === "picks" ? "picks:" : "");
  if (!lim.ok) return hold("limiter");
  let body; try { body = await request.json(); } catch { body = {}; }
  const seeds = (Array.isArray(body?.seeds) ? body.seeds : []).map(sanitizeSeed).filter(Boolean);
  const city = sanitizeCity(body?.city);
  if (seeds.length < 1 || seeds.length > 5) return json({ error: "Give us 1 to 5 things you love." }, 400);
  if (!city) return json({ error: "Tell us your city or ZIP." }, 400);
  const rawPicks = body?.picks && typeof body.picks === "object" ? body.picks : {};
  // Picks may be keyed by seed position ("0".."4", what the page sends) or by seed text (older clients).
  const picks = { ...rawPicks }; seeds.forEach((sd, i) => { if (typeof rawPicks[String(i)] === "string") picks[sd] = rawPicks[String(i)]; });
  const mock = isMock(env);
  const today = mock && /^\d{4}-\d{2}-\d{2}$/.test(body?.today || "") ? body.today : localToday(city);
  const weekend = weekendOf(today);
  const trace = [];
  const T = {}, t0 = Date.now();
  const tm = async (k, p) => { const a = Date.now(); try { return await p; } finally { T[k] = Date.now() - a; } };
  const st = () => { T.total = Date.now() - t0; T.qloo_cache = trace.filter((x) => x.cache).map((x) => x.cache).join("+") || "miss"; return { "server-timing": Object.entries(T).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k};dur=${v}`).join(", "), "x-qloo-cache": T.qloo_cache, "x-cache-write": `ok=${trace.filter((x) => x.write === "ok").length} fail=${trace.filter((x) => x.write === "fail").length} kv=${env.QLOO_CACHE ? 1 : 0}` }; };
  let liveP = null;
  try {
    // Qloo gets a shared budget so search + insights can't stack past ~4.3s; Ticketmaster runs alongside.
    // Separate budgets: seed search (mostly cached for 7 days) and insights each get their own cap.
    const left = (ms) => ({ ...env, QLOO_TIMEOUT_MS: ms });
    // stage "fast": no live Qloo calls (events + cached city places); "picks": personalized Qloo with roomy caps.
    const roomy = stage === "picks";
    const SEARCH_MS = Number(roomy ? env.PICKS_SEARCH_MS ?? 5000 : env.QLOO_SEARCH_MS ?? 1500), INSIGHTS_MS = Number(roomy ? env.PICKS_INSIGHTS_MS ?? 9000 : env.QLOO_INSIGHTS_MS ?? 3000);
    liveP = tm("ticketmaster", liveLayer(env, { city, weekend, today, mock: tmMode(env) === "mock", ctx }));
    // Wider music search (50 mi / 14 days) starts alongside Qloo, so the hear slot never waits on Qloo latency.
    // One call, cached 10 min per city + local day; never on the fast plan.
    const wideP = stage !== "fast" && !mock && tmMode(env) !== "mock" ? tm("ticketmaster_wide", tmWideMusic(env, city, { ctx })).catch(() => []) : null;
    let s, degraded = null;
    if (stage === "fast") { degraded = "fast"; s = { resolved: [], needsPick: [], unresolved: [] }; }
    else try { s = await tm("qloo_search", searchSeeds(left(SEARCH_MS), seeds, picks, trace)); }
    catch (e) { if (e instanceof QlooError && e.status === 429) throw e; degraded = "qloo_slow"; s = { resolved: [], needsPick: [], unresolved: seeds }; }
    if (s.needsPick.length) return json({ mock, needsPick: pubPick(s.needsPick, seeds), seeds: pubSeeds(s.resolved), trace: pubTrace(trace) }, 200, st());
    if (!s.resolved.length && !degraded) return json({ error: "Couldn't find any of those. Try a movie, artist or place by name." }, 422, st());
    const ids = s.resolved.map((x) => x.entity_id);
    const fallbackPlaces = () => cityPlaces({ ...env, QLOO_TIMEOUT_MS: 1 }, city, trace).catch(() => []);
    // Picks stage: stagger the 3 insight calls so Qloo doesn't see a burst, and retry a Qloo 429 once.
    // Per-call added wait (stagger + retry delay) is capped at QLOO_BURST_CAP_MS; past the cap the 429 stands (hold).
    const burst = roomy ? { stagger: Number(env.QLOO_STAGGER_MS ?? 200), retry: Number(env.QLOO_RETRY_MS ?? 300), jitter: Number(env.QLOO_RETRY_JITTER_MS ?? 100), cap: Number(env.QLOO_BURST_CAP_MS ?? 1000) } : null;
    const insightsSpaced = async (type) => {
      const call = () => insightsFor(left(INSIGHTS_MS), { type, entityIds: ids, city }, trace);
      if (!burst) return call();
      let waited = Math.min(TYPES.indexOf(type) * burst.stagger, burst.cap);
      if (waited) await sleepMs(waited);
      try { return await call(); }
      catch (e) {
        if (!(e instanceof QlooError && e.status === 429)) throw e;
        const d = burst.retry + Math.floor(Math.random() * (burst.jitter + 1));
        if (waited + d > burst.cap) throw e;
        await sleepMs(d); trace.push({ retry: type, after_ms: d });
        return await call();
      }
    };
    // A slow/failed artist call alone doesn't degrade the plan: the hear slot is filled from Ticketmaster music instead.
    let artistMiss = false;
    const one = (type) => (degraded ? (type === "place" ? fallbackPlaces() : Promise.resolve([]))
      : insightsSpaced(type).catch((e) => { if (e instanceof QlooError && e.status === 429) throw e; if (type === "artist") artistMiss = true; else degraded = "qloo_slow"; return type === "place" ? fallbackPlaces() : []; }));
    const [raw, live] = await Promise.all([tm("qloo_insights", Promise.all(TYPES.map(one))), liveP]);
    if (!mock && ctx?.waitUntil) ctx.waitUntil(cityPlaces(env, city).catch(() => {}));
    const ranked = {};
    TYPES.forEach((t, i) => { ranked[t] = blend(raw[i]); });
    ranked.place = blend(raw[TYPES.indexOf("place")], { boosted: boostedIds(ranked.place, live.events) });
    const noteArgs = { city, names: ranked.place.slice(0, 3).map((p) => (p.lat != null ? { name: p.name, lat: p.lat, lon: p.lon } : p.name)), mock };
    // OSM never blocks the plan: serve cached notes now, warm the cache in the background.
    live.notes = mock ? await venueNotes(env, noteArgs) : await venueNotes(env, { ...noteArgs, cacheOnly: true });
    if (!mock && ctx?.waitUntil) ctx.waitUntil(venueNotes(env, noteArgs).catch(() => {}));
    // Artist-slot order stays: weekend music event, wide music event (dated label), "Your vibe", placeholder.
    const wide = wideP && live.status === "ok" ? await wideP : [];
    const days = buildPlan({ seeds: s.resolved, ranked, live, weekend, city, wide });
    if (artistMiss && !degraded && !hasDatedHear(days)) degraded = "qloo_slow";
    const credits = [OSM_CREDIT, ...([...live.events, ...Object.values(days).flat()].some((e) => (e.source?.via || e.source?.name) === "Ticketmaster") ? [{ name: "Event data: Ticketmaster", url: "https://www.ticketmaster.com/" }] : [])];
    // Template summary by default; the generated one only if it lands within 1.5s.
    let useAi = !mock && !!env.AI;
    if (useAi) useAi = (await takeAiCall(env)).ok;
    const summary = useAi ? await tm("summary", phrase({ ...env, AI_TIMEOUT_MS: Number(env.AI_FAST_MS ?? 1500) }, s.resolved, days, { mock: false })) : await tm("summary", Promise.resolve(template(s.resolved, days)));
    return json({ mock, city, weekend, seeds: pubSeeds(s.resolved), unresolved: s.unresolved.length, summary, days, events: live.status, credits, stage, ...(degraded ? { degraded } : {}), trace: pubTrace(trace) }, 200, st());
  } catch (e) {
    if (e instanceof QlooError && e.status === 429) { let h = {}; try { h = st(); } catch {} return hold("qloo", h); }
    // Never a 502: log the real error with the request id, then serve a cache-only fallback plan.
    const requestId = rid(request);
    console.error(JSON.stringify({ requestId, error: String(e?.name || "Error"), message: String(e?.message || e) }));
    return fallbackPlan({ env, city, weekend, mock, liveP, stage, st, requestId });
  }
}

export const rid = (request) => request.headers.get("cf-ray") || crypto.randomUUID();

// Built without live Qloo: Ticketmaster events if they came back, cached city places (1 ms cap), template summary.
async function fallbackPlan({ env, city, weekend, mock, liveP, stage, st, requestId }) {
  const safeHeaders = () => { let h = {}; try { h = st(); } catch {} return { ...h, "x-request-id": requestId }; };
  try {
    const live = await Promise.resolve(liveP).then((l) => l || { events: [], status: "error" }).catch(() => ({ events: [], status: "error" }));
    const places = await Promise.resolve().then(() => cityPlaces({ ...env, QLOO_TIMEOUT_MS: 1 }, city)).catch(() => []);
    const ranked = { place: blend(places, { boosted: boostedIds(blend(places), live.events) }) };
    const days = buildPlan({ seeds: [], ranked, live: { ...live, notes: [] }, weekend, city });
    const credits = [OSM_CREDIT, ...(live.events.some((e) => (e.source?.via || e.source?.name) === "Ticketmaster") ? [{ name: "Event data: Ticketmaster", url: "https://www.ticketmaster.com/" }] : [])];
    return json({ mock, city, weekend, seeds: [], unresolved: 0, summary: template([], days), days, events: live.status, credits, stage, degraded: "error", trace: [] }, 200, safeHeaders());
  } catch {
    const days = buildPlan({ seeds: [], ranked: {}, live: { events: [] }, weekend, city });
    return json({ mock, city, weekend, seeds: [], unresolved: 0, summary: template([], days), days, events: "error", credits: [OSM_CREDIT], stage, degraded: "error", trace: [] }, 200, safeHeaders());
  }
}

export async function handle(request, env = {}, ctx) {
  const { pathname } = new URL(request.url);
  let res;
  try { res = await route(request, env, ctx); }
  catch (e) {
    const requestId = rid(request);
    try { console.error(JSON.stringify({ requestId, where: "handle", name: e?.name, message: String(e?.message ?? e) })); } catch {}
    if (pathname !== "/api/plan" && pathname !== "/api/picks") return json({ error: "server_error", message: "Something broke. Try again shortly." }, 500, { "x-request-id": requestId });
    let weekend = {}, days = { fri: [], sat: [], sun: [] };
    try { weekend = weekendOf(localToday("")); days = buildPlan({ seeds: [], ranked: {}, live: { events: [] }, weekend, city: "your city" }); } catch {}
    let summary = ""; try { summary = template([], days); } catch {}
    return json({ mock: false, city: "", weekend, seeds: [], unresolved: 0, summary, days, events: "error", credits: [OSM_CREDIT], stage: "full", degraded: "error", trace: [] }, 200, { "x-request-id": requestId });
  }
  if (!pathname.startsWith("/api/")) return res;
  const id = res.headers.get("x-request-id") || rid(request);
  const h = new Headers(res.headers); h.set("x-request-id", id);
  return new Response(res.body, { status: res.status, headers: h });
}

async function route(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (m === "GET" && pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (m === "GET" && pathname === "/api/health") return json({ ok: true, mock: isMock(env) });
  if (pathname === "/api/plan") return m === "POST" ? plan(request, env, ctx, new URL(request.url).searchParams.get("stage") === "fast" ? "fast" : "full") : json({ error: "method not allowed" }, 405);
  if (pathname === "/api/picks") return m === "POST" ? plan(request, env, ctx, "picks") : json({ error: "method not allowed" }, 405);
  return json({ error: "not found" }, 404);
}

// Cron: keep the demo pairs warm in the shared cache (wrangler.toml [triggers]).
export const DEMO_PAIRS = [{ seeds: ["Prince"], city: "Austin" }, { seeds: ["Prince"], city: "Chicago" }];
// Popular seeds pre-resolved by the cron, 5 per run (search results are cached 7 days).
export const TOP_SEEDS = ["Taylor Swift","Beyonce","Drake","Prince","David Bowie","The Beatles","Kendrick Lamar","Billie Eilish","Bad Bunny","Radiohead","Fleetwood Mac","Daft Punk","Nirvana","Metallica","Madonna","Michael Jackson","Rihanna","Frank Ocean","SZA","Dolly Parton","Johnny Cash","Bruce Springsteen","Queen","Led Zeppelin","Ariana Grande","The Weeknd","Kanye West","Adele","Coldplay","Lady Gaga","The Matrix","Blade Runner","Star Wars","The Godfather","Pulp Fiction","Inception","The Dark Knight","Jurassic Park","Back to the Future","Barbie","Oppenheimer","Dune","Interstellar","Titanic","Spirited Away","The Lord of the Rings","Top Gun","Mad Max: Fury Road","Everything Everywhere All at Once","Get Out"];
export async function warmSeeds(env, slot = Math.floor(Date.now() / (20 * 60e3))) {
  const n = 5, start = (slot * n) % TOP_SEEDS.length;
  await searchSeeds({ ...env, QLOO_TIMEOUT_MS: 8000 }, TOP_SEEDS.slice(start, start + n)).catch(() => {});
}
export async function warm(env) {
  await warmSeeds(env);
  const pairs = (() => { try { return env.DEMO_PAIRS ? JSON.parse(env.DEMO_PAIRS) : DEMO_PAIRS; } catch { return DEMO_PAIRS; } })();
  const e = { ...env, RATE_LIMITER: undefined, QLOO_REFRESH: "1", QLOO_SEARCH_MS: "8000", QLOO_INSIGHTS_MS: "8000", AI: undefined };
  for (const p of pairs.slice(0, 2)) {
    await plan(new Request("https://cron/api/plan", { method: "POST", body: JSON.stringify(p) }), e).catch(() => {});
    await cityPlaces({ ...e, QLOO_TIMEOUT_MS: 8000 }, p.city).catch(() => {});
  }
}
export default { fetch: handle, scheduled: (_ev, env, ctx) => ctx.waitUntil(warm(env)) };

// Never echo the raw seed text back: users may type names or other personal words.
// Public output carries only Qloo's matched entity names, the seed's position, and a generic label.
const strip = ({ seed, ...e }) => e;
export const pubSeeds = (list) => (list || []).map(strip);
export const pubPick = (list, seeds) => (list || []).map((n) => ({ i: seeds.indexOf(n.seed), label: "Which one did you mean?", options: n.options.map(strip) }));
export const pubTrace = (trace) => (trace || []).map((t) => (t.path === "/search" ? { ...t, params: { ...t.params, query: "[seed]" } } : t));
