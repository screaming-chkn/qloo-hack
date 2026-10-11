import { PAGE } from "./page.js";
import { isMock, searchEntity, insights } from "./qloo.js";
import { rank } from "./logic.js";
import { phrase } from "./ai.js";
import { checkLimit } from "./limit.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handle(request, env = {}) {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (m === "GET" && pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (m === "GET" && pathname === "/api/health") return json({ ok: true, mock: isMock(env) });
  if (pathname === "/api/recommend") {
    if (m !== "POST") return json({ error: "method not allowed" }, 405);
    const lim = await checkLimit(request, env);
    if (!lim.ok) return json({ error: "rate limited" }, 429);
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) return json({ error: "query is required" }, 400);
    const mock = isMock(env);
    try {
      const found = await searchEntity(env, query);
      const seed = found?.results?.[0]?.entity_id;
      const data = await insights(env, { type: body.type, entityIds: seed ? [seed] : [] });
      const results = rank(data?.results?.entities, { seed });
      const summary = await phrase(env, query, results, { mock });
      return json({ query, mock, seed, summary, results });
    } catch (e) {
      return json({ error: "upstream error" }, 502);
    }
  }
  return json({ error: "not found" }, 404);
}

export default { fetch: handle };
