// MOCK Qloo fixtures (no key yet). Shapes follow Qloo /search and /v2/insights docs.
import { QlooError } from "../src/qloo.js";

const S = {
  "blade runner": [{ entity_id: "MOCK-MOV-BR", name: "Blade Runner", types: ["urn:entity:movie"], properties: { release_year: 1982 } },
                   { entity_id: "MOCK-MOV-BR49", name: "Blade Runner 2049", types: ["urn:entity:movie"], properties: { release_year: 2017 } }],
  "prince": [{ entity_id: "MOCK-ART-PR", name: "Prince", types: ["urn:entity:artist"] }],
  "waffle house": [{ entity_id: "MOCK-PLC-WH", name: "Waffle House", types: ["urn:entity:place"] }],
  "dune": [{ entity_id: "MOCK-MOV-DU84", name: "Dune", types: ["urn:entity:movie"], properties: { release_year: 1984 } },
           { entity_id: "MOCK-MOV-DU21", name: "Dune", types: ["urn:entity:movie"], properties: { release_year: 2021 } },
           { entity_id: "MOCK-BK-DU", name: "Dune", types: ["urn:entity:book"], properties: { release_year: 1965 } }],
};

export function mockSearch(query) {
  const q = String(query || "").toLowerCase().trim();
  if (q === "!429") throw new QlooError(429); // forced rate-limit check
  if (q === "!500") throw new QlooError(500);
  if (S[q]) return { results: structuredClone(S[q]) };
  const slug = q.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase() || "X";
  return { results: [{ entity_id: `MOCK-${slug}`, name: query, types: ["urn:entity:movie"] }] };
}

const POOL = {
  movie: [["Thief", 0.93, 0.41, "Neo-Noir"], ["Streets of Fire", 0.9, 0.22, "Rock Musical"], ["Road House", 0.86, 0.71, "Action"], ["Purple Rain", 0.84, 0.66, "Music"], ["Repo Man", 0.8, 0.3, "Cult"], ["Top Gun", 0.72, 0.95, "Action"]],
  artist: [["Bruce Springsteen", 0.91, 0.88, "Heartland Rock"], ["The Time", 0.89, 0.35, "Minneapolis Sound"], ["ZZ Top", 0.85, 0.7, "Blues Rock"], ["Joan Jett", 0.83, 0.6, "Rock"], ["Sheila E.", 0.8, 0.4, "Funk"], ["Bon Jovi", 0.7, 0.9, "Arena Rock"]],
  tv_show: [["Miami Vice", 0.88, 0.6, "Crime"], ["Knight Rider", 0.84, 0.55, "Action"]],
};
const PLACES = {
  austin: [["Magnolia Cafe", 0.92, 0.7, "Diner"], ["Continental Club", 0.9, 0.5, "Live Music Venue"], ["Alamo Drafthouse South Lamar", 0.87, 0.8, "Cinema"], ["Barton Springs Pool", 0.8, 0.85, "Swimming"], ["Ginny's Little Longhorn", 0.78, 0.3, "Honky Tonk"], ["Franklin Barbecue", 0.7, 0.97, "Barbecue"]],
  chicago: [["Green Mill", 0.93, 0.55, "Jazz Club"], ["Lou Mitchell's", 0.9, 0.6, "Diner"], ["Music Box Theatre", 0.86, 0.5, "Cinema"], ["Metro", 0.82, 0.62, "Live Music Venue"], ["Superdawg", 0.79, 0.58, "Drive-In"], ["Navy Pier", 0.6, 0.97, "Attraction"]],
};
export const placesFor = (city) => {
  const k = String(city || "").toLowerCase().split(/[ ,]/)[0];
  return PLACES[k] || PLACES[Object.keys(PLACES)[[...k].reduce((a, c) => a + c.charCodeAt(0), 0) % 2]];
};
export const cityKey = (city) => (PLACES[String(city || "").toLowerCase().split(/[ ,]/)[0]] ? String(city).toLowerCase().split(/[ ,]/)[0] : "default");

export function mockInsights(params) {
  const type = String(params["filter.type"]).replace("urn:entity:", "");
  const rows = type === "place" ? placesFor(params["filter.location.query"]) : POOL[type] || [];
  const slug = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  return {
    success: true,
    results: {
      entities: rows.slice(0, Number(params.take) || 6).map(([name, affinity, popularity, tag]) => ({
        entity_id: `MOCK-${type.toUpperCase()}-${slug(name)}`, name, types: [`urn:entity:${type}`], popularity,
        query: { affinity }, tags: [{ id: `urn:tag:genre:${slug(tag).toLowerCase()}`, name: tag }],
      })),
    },
  };
}
