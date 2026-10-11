# Screaming Chicken: Qloo Agentic Hackathon entry (skeleton)

A Cloudflare Worker: Qloo taste data plus our own ranking logic at the core, with SI phrasing on top. Every claim in a result carries a proof (Qloo entity id + signal). The SI layer only rewords proven facts.

## Layout
- `src/index.js`: router (`GET /`, `GET /api/health`, `POST /api/recommend`)
- `src/qloo.js`: Qloo client (Insights + Search), with mock mode
- `src/logic.js`: scoring, ranking, `why` + `proof`
- `src/ai.js`: Workers SI phrasing (`@cf/meta/llama-3.1-8b-instruct`)
- `src/limit.js`: per-visitor limit hook (placeholder)
- `fixtures/`: mock Qloo JSON

## Run
    npm test                     # node:test, no deps
    npx wrangler dev --local     # local Worker

## Mock mode
On when `MOCK=1` or when no `QLOO_API_KEY` is set. Qloo returns fixtures and SI phrasing is stubbed, so everything runs offline with no key.

## Env / secrets
| Name | Kind | Notes |
|---|---|---|
| `QLOO_API_KEY` | secret | Set with `wrangler secret put`. Never in the repo. |
| `QLOO_BASE` | var | Default `https://hackathon.api.qloo.com` |
| `MOCK` | var | `1` forces mock mode |
| `AI` | binding | Workers SI binding |

Local secrets go in `.dev.vars` (gitignored).

## License
MIT
