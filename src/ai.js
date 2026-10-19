// SI phrasing in the Screaming Chicken voice. Only rewords proven facts; never adds new ones.
export const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const facts = (days) => Object.entries(days).map(([d, items]) => `${d.toUpperCase()}: ` + items.map((i) => i.name).join(", "));

export function template(seeds, days) {
  return (seeds.length ? `OHHH YEAH! You came in loving ${seeds.map((s) => s.name).join(", ")}, so here's your weekend main event. ` : "OHHH YEAH! Here's your weekend main event while we tune it to your taste. ") + facts(days).join(". ") + ". Every pick's got its receipts. Ring the bell!";
}

export async function phrase(env, seeds, days, { mock } = {}) {
  if (mock || !env.AI) return template(seeds, days);
  try {
    const out = await Promise.race([new Promise((r) => setTimeout(() => r(null), env.AI_TIMEOUT_MS ?? 4000)), env.AI.run(MODEL, { messages: [
      { role: "system", content: "You are Screaming Chicken, a clean, family-friendly late-80s glam wrestler announcer. In 2-3 punchy sentences, hype this weekend plan. Use ONLY the names given. Add no new facts, places, dates or claims." },
      { role: "user", content: facts(days).join("\n") },
    ] })]);
    return out?.response || template(seeds, days);
  } catch { return template(seeds, days); }
}
