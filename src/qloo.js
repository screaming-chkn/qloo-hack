// Qloo client. Sources (checked 2026-10-11):
//   https://docs.qloo.com/  (Insights API, Search Entities, auth via X-Api-Key header)
//   https://github.com/manasseh-zw/qloo-ts-sdk  (hackathon base https://hackathon.api.qloo.com/v2)
//   https://gist.github.com/manasseh-zw/9eb39212f316d3615813b0e090f6911a  (filter.type required + one primary signal)
// Insights: GET {base}/v2/insights/?filter.type=urn:entity:...&signal.interests.entities=ID1,ID2
// Search:   GET {base}/search?query=...  (shape to confirm with a live key)
import insightsFixture from "../fixtures/insights.js";
import searchFixture from "../fixtures/search.js";

export function isMock(env = {}) {
  return env.MOCK === "1" || env.MOCK === 1 || !env.QLOO_API_KEY;
}

async function qget(env, path, params) {
  const base = (env.QLOO_BASE || "https://hackathon.api.qloo.com").replace(/\/$/, "");
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { "X-Api-Key": env.QLOO_API_KEY, Accept: "application/json" } });
  if (!res.ok) throw new Error(`qloo ${res.status}`);
  return res.json();
}

export async function searchEntity(env, query) {
  if (isMock(env)) return structuredClone(searchFixture);
  return qget(env, "/search", { query, take: "1" });
}

export async function insights(env, { type = "urn:entity:place", entityIds = [], take = 10 }) {
  if (isMock(env)) return structuredClone(insightsFixture);
  return qget(env, "/v2/insights/", {
    "filter.type": type,
    "signal.interests.entities": entityIds.join(","),
    take: String(take),
  });
}
