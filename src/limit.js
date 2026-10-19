// Per-visitor limit + daily Workers AI cap.
// - RATE_LIMITER: native Workers rate limit binding (per client IP).
// - AI_BUDGET: Durable Object holding a per-UTC-day counter (atomic, single instance).
// Missing bindings fail open so local tests/dev run without Cloudflare.

export const DEFAULT_AI_DAILY_CAP = 200;

export function clientKey(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anon";
}

// bucket keeps the fast plan and /picks in separate per-IP counters, so one page load costs one slot in each.
export async function checkLimit(request, env = {}, bucket = "") {
  const rl = bucket === "picks:" ? env.RATE_LIMITER_PICKS || env.RATE_LIMITER : env.RATE_LIMITER;
  if (!rl?.limit) return { ok: true };
  const { success } = await rl.limit({ key: bucket + clientKey(request) });
  return { ok: !!success };
}

export function aiCap(env = {}) {
  const n = parseInt(env.AI_DAILY_CAP, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AI_DAILY_CAP;
}

// Reserve one AI call for today. Returns { ok, used, cap }.
export async function takeAiCall(env = {}, now = new Date()) {
  const cap = aiCap(env);
  if (!env.AI_BUDGET) return { ok: cap > 0, used: 0, cap };
  const stub = env.AI_BUDGET.get(env.AI_BUDGET.idFromName("global"));
  const day = now.toISOString().slice(0, 10);
  const r = await stub.fetch(`https://budget/take?day=${day}&cap=${cap}`);
  return await r.json();
}

export class AiBudget {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const u = new URL(request.url);
    const day = u.searchParams.get("day");
    const cap = parseInt(u.searchParams.get("cap"), 10) || 0;
    const key = "d:" + day;
    const used = (await this.state.storage.get(key)) || 0;
    if (used >= cap) return Response.json({ ok: false, used, cap });
    await this.state.storage.put(key, used + 1);
    // drop older days
    const all = await this.state.storage.list({ prefix: "d:" });
    for (const k of all.keys()) if (k !== key) await this.state.storage.delete(k);
    return Response.json({ ok: true, used: used + 1, cap });
  }
}
