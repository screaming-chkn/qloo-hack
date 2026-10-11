// Workers AI phrasing. Only rephrases proven facts; never adds new ones.
export const MODEL = "@cf/meta/llama-3.1-8b-instruct";

export async function phrase(env, query, ranked, { mock } = {}) {
  const facts = ranked.slice(0, 3).map((r) => `${r.name}: ${r.why.map((w) => w.claim).join("; ")}`);
  if (mock || !env.AI) return `For "${query}": ` + facts.join(" | ");
  const out = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: "Rewrite the facts as one short friendly paragraph. Use ONLY these facts. Add nothing." },
      { role: "user", content: facts.join("\n") },
    ],
  });
  return out?.response ?? facts.join(" | ");
}
