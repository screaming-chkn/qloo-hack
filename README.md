# Screaming Chicken's Weekend Main Event

A taste-based weekend planner for the Qloo Agentic Hackathon. Name a few things you love (a movie, an artist, a place) plus your city, and get a Friday-to-Sunday plan (watch / eat / hear / visit) with receipts on every pick.

**Live app:** https://qloo-hack.screamingchicken.workers.dev

## How Qloo powers it
Qloo's Taste API is the core of the app, not decoration:
1. **Seed resolution:** each thing you type goes to `GET /search`. If a name is ambiguous (say "Dune": 1984 film, 2021 film, or the book), you pick the right one from a short list.
2. **Taste graph:** the resolved entity IDs go to `GET /v2/insights` as `signal.interests.entities`, once per output type (`filter.type` = `urn:entity:movie`, `urn:entity:artist`, `urn:entity:place`). Place requests add `filter.location.query` with your city, `filter.location.radius=15000` (meters), and `filter.tags` = restaurant, bar and music venue (`urn:tag:genre:place:*`) with `operator.filter.tags=union`; campus/Greek-life results that slip through are dropped.
3. **Ranking:** Qloo affinity is the main ranking signal (80%). We add a little novelty (favoring less-mainstream picks) and a boost when a place has a dated event this weekend. Popularity is shown as supporting proof but never decides the order.
4. **Receipts:** every pick shows its Qloo affinity and tag inline. Every live claim (an event or a venue note) shows its source link and date, and anything missing a source or date is dropped.

The live local layer (this weekend's events and venue notes) makes the plan timely. A clean glam-wrestler announcer voice sums it up, rewording only facts already in the plan.

## Privacy and safety
- Seeds are stripped of emails, phone numbers, handles and URLs before anything leaves the Worker. Location is a city or 5-digit ZIP only.
- The Qloo key lives only as a Worker secret and is sent in the `X-Api-Key` header to `https://hackathon.api.qloo.com`. It never reaches the browser.
- Qloo rate limits (429), the per-visitor limit, and upstream errors all show a friendly message ("Catching our breath, try again in a minute"), never a stack trace.
- Only free sources are used.

## API
- `GET /`: the app
- `GET /api/health`: `{ ok, mock }`
- `POST /api/plan` `{ seeds: string[1..5], city: string, picks?: { [seed]: entity_id } }` returns `{ weekend, seeds, summary, days: { fri, sat, sun }, events, credits, trace }`, or `{ needsPick }` when a seed is ambiguous. `trace` lists every Qloo call (path and params, never the key).

## Run
    npm test                     # node:test, no runtime dependencies (no install needed)
    npm install                  # installs the pinned wrangler (dev only)
    cp .dev.vars.example .dev.vars   # optional: add your own keys for live mode; blank = mock
    npx wrangler dev --local     # local Worker; check http://localhost:8787/api/health

## Fork / redeploy
Tests and local mock mode need none of this. To deploy your own copy, edit `wrangler.toml`:
- **KV namespace `QLOO_CACHE`** (shared Qloo cache): create one with `npx wrangler kv namespace create QLOO_CACHE` and replace the `id` under `[[kv_namespaces]]` with yours (the committed id belongs to the original account).
- **Rate limits `RATE_LIMITER` (namespace_id 1001, 10 req/60s per IP) and `RATE_LIMITER_PICKS` (namespace_id 1002, 20 req/60s per IP)**: nothing to create; pick any integer ids unique within your account.
- **Durable Object `AI_BUDGET` (class `AiBudget`)**: created on first deploy by the `v1` migration; nothing to do by hand.
- **Workers AI binding `AI`**: needs Workers AI enabled on your account.
- **Secrets**: `npx wrangler secret put QLOO_API_KEY` and (optional) `npx wrangler secret put TICKETMASTER_API_KEY`.
- **Cron**: `[triggers]` re-warms the demo cache every 20 min; remove it if you don't want it.

Then `npx wrangler deploy` and check `GET /api/health` returns `{ "ok": true, "mock": false }` once keys are set.

## Mock mode
Each source picks real or mock on its own: Qloo is live only when `QLOO_API_KEY` is set; Ticketmaster is live only when `TICKETMASTER_API_KEY` is set (with no TM key, events use fixtures while Qloo is mocked, and are left empty beside live Qloo picks). `MOCK=force` (or `1`) forces every source onto fixtures. With everything mocked, Qloo, events and venue notes return fixtures (`fixtures/`), so the app runs fully offline with no network calls. In mock mode, the seed `!429` forces a rate-limit response and `!500` forces an upstream error, for testing.

## Live layer
Free sources only: no paid API, no trial, nothing that needs a card.
- **Events: Ticketmaster Discovery API** (`TICKETMASTER_API_KEY`, free key). One request per city per weekend, filtered to this Fri-Sun by city (or `postalCode` for a ZIP). Each event links to its own Ticketmaster `url`, where tickets are sold; we never sell or resell anything. Event results are cached in memory for 10 minutes only, and calls are spaced to about 2 per second.
- **Venue notes: OpenStreetMap via Overpass** (no key). For the top Qloo place picks we search within 250 m of Qloo's coordinates for a fuzzy name match (case, accents, "the", "&"/"and") and look up the venue's OSM tags (type, cuisine, hours, outdoor seating, live music) and show them next to Qloo's reason. Each note links to the OSM element and carries its last-edit date. Map data © OpenStreetMap contributors, under the ODbL (https://www.openstreetmap.org/copyright). Overpass results are cached per city for 1 hour (fair use).
- We don't show user reviews: no free source allows them in a public demo without a card or a trial.
- Repeat shows of the same act at the same venue are collapsed into one event with a list of showtimes.
- Overpass, Ticketmaster, Qloo and the announcer voice each have a time limit, so one slow source can't stall the plan (venue notes are skipped, the summary falls back to a template).
- `src/live.js` drops anything without an https source link and a date, and events outside this Fri-Sun.
- Without a Ticketmaster key (or if Ticketmaster errors or rate-limits), the plan still renders with Qloo picks and venue notes, and the response says `events: "no_key" | "rate_limited" | "error"`.
- The page footer carries the privacy note and the Qloo, Ticketmaster and OpenStreetMap credits.

## Env / secrets
| Name | Kind | Notes |
|---|---|---|
| `QLOO_API_KEY` | secret | Set with `wrangler secret put QLOO_API_KEY`. Never in the repo. |
| `QLOO_BASE` | var | `https://hackathon.api.qloo.com` |
| `TICKETMASTER_API_KEY` | secret | `wrangler secret put TICKETMASTER_API_KEY`. Optional; without it there are no live events. |
| `MOCK` | var | `force` (or `1`) forces all sources onto fixtures; anything else lets each source go live when its own key is set |
| `AI_DAILY_CAP` | var | daily cap on narration calls |
| `AI`, `RATE_LIMITER`, `RATE_LIMITER_PICKS`, `AI_BUDGET`, `QLOO_CACHE` | bindings | narration, per-visitor limits, daily cap counter, shared Qloo cache (see Fork / redeploy) |

## License
MIT (see LICENSE)
