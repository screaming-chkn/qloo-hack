// Our logic: blend Qloo affinity (primary) + light novelty + live boost. Popularity is proof only.
import { dayKey, offWeekendLabel } from "./dates.js";
const BAD_TAG = /slur|offensive|racis|sexis|homophob|transphob|\bhate|nsfw|explicit|porn|\bsex|nudity|drug|violence|gore|profan|vulgar/i;
export function safeTag(tags) { const t = (tags || []).map((x) => x?.name).find((n) => n && !BAD_TAG.test(n)); return t || undefined; }
const W = { affinity: 0.8, novelty: 0.08, live: 0.15 };

export function blend(entities = [], { boosted = new Set() } = {}) {
  return entities.map((e) => {
    const affinity = Number(e?.query?.affinity ?? 0), popularity = Number(e?.popularity ?? 0);
    const live = boosted.has(e.entity_id);
    const score = +(W.affinity * affinity + W.novelty * (1 - popularity) + (live ? W.live : 0)).toFixed(4);
    const proof = [{ signal: "query.affinity", value: affinity, entity_id: e.entity_id }, { signal: "popularity", value: popularity, entity_id: e.entity_id }];
    const tag = safeTag(e.tags);
    if (tag) proof.push({ signal: "tags", value: tag, entity_id: e.entity_id });
    const { lat, lon } = coordsFrom(e);
    return { entity_id: e.entity_id, name: e.name, ...(lat != null ? { lat, lon } : {}), affinity, popularity, tag, live, score, proof };
  }).sort((a, b) => b.score - a.score || b.affinity - a.affinity);
}

const SLOTS = { fri: [["movie", "watch"], ["place", "eat"]], sat: [["artist", "hear"], ["place", "eat"], ["place", "visit"]], sun: [["movie", "watch"], ["artist", "hear"], ["place", "eat"]] };
const lc = (s) => String(s).toLowerCase();
export const HEAR_PLACEHOLDER = { title: "Live music pick coming soon", reason: "No artist match for your taste yet. Add an artist you love above and we'll tune this slot." };
const isMusic = (e) => lc(e.segment || "") === "music";
const evKey = (e) => `${lc(e.title)}|${lc(e.venue)}`;
const eventItem = (e, city, match) => ({ kind: "event", name: e.title, venue: e.venue, date: e.date, showtimes: e.showtimes || [{ date: e.date, time: e.time || "", url: e.source.url }], source: e.source,
  reason: `Happening ${(e.showtimes || [e]).map((x) => x.date + (x.time ? " " + x.time.slice(0, 5) : "")).join(", ")} near ${city}${match ? ` at ${e.venue}, a Qloo match for your taste` : ""}.` });

export function buildPlan({ seeds, ranked, live, weekend, city, wide = [] }) {
  const seedNames = seeds.map((s) => s.name).filter(Boolean).join(", ");
  const used = new Set(); const days = { fri: [], sat: [], sun: [] };
  const events = live.events || [], placeNames = new Set((ranked.place || []).map((p) => lc(p.name)));
  const pulled = new Set(); // events moved into an empty "hear" slot
  const take = (type) => { const p = (ranked[type] || []).find((x) => !used.has(x.entity_id)); if (p) used.add(p.entity_id); return p; };
  // Empty artist slot, in order: a this-weekend music event (same day first); a music event within 50 mi / 14 days
  // (dated label if off-weekend); the top Qloo artist pick again; else a placeholder with no source line.
  let topArtistUsed = false;
  const rank = (x, d) => (dayKey(x.date, weekend) === d ? 0 : dayKey(x.date, weekend) ? 1 : 2);
  const hearFallback = (d) => {
    const music = events.filter((e) => isMusic(e) && dayKey(e.date, weekend) && !pulled.has(evKey(e)));
    const e = music.find((x) => dayKey(x.date, weekend) === d) || music[0];
    if (e) { pulled.add(evKey(e)); return { ...eventItem(e, city, placeNames.has(lc(e.venue))), slot: "hear" }; }
    const w = wide.filter((x) => !pulled.has(evKey(x))).sort((a, b) => rank(a, d) - rank(b, d) || a.date.localeCompare(b.date))[0];
    if (w) {
      pulled.add(evKey(w));
      const label = offWeekendLabel(w.date, weekend);
      const item = { ...eventItem(w, city, placeNames.has(lc(w.venue))), slot: "hear", wide: true };
      return label ? { ...item, label, reason: `${label}. ${item.reason}` } : item;
    }
    const top = (ranked.artist || [])[0];
    if (top && !topArtistUsed) {
      topArtistUsed = true;
      return { kind: "pick", type: "artist", slot: "hear", name: `Your vibe: ${top.name}`, entity_id: top.entity_id, score: top.score, proof: top.proof, notes: [], repeat: true,
        reason: `Your top Qloo artist match (affinity ${top.affinity.toFixed(2)}). No show nearby this weekend, so put them on.` };
    }
    return { kind: "placeholder", type: "artist", slot: "hear", name: HEAR_PLACEHOLDER.title, reason: HEAR_PLACEHOLDER.reason };
  };
  for (const d of Object.keys(SLOTS)) for (const [type, slot] of SLOTS[d]) {
    const p = take(type);
    if (!p) { if (type === "artist") days[d].push(hearFallback(d)); continue; }
    const notes = type === "place" ? (live.notes || []).filter((r) => lc(r.for || r.place) === lc(p.name)) : [];
    const why = `Qloo affinity ${p.affinity.toFixed(2)}${p.tag ? ` (${p.tag})` : ""}${p.live ? "; something's on here this weekend" : ""}.`;
    const reason = seedNames ? `Because you love ${seedNames}: ${why}` : `Popular in ${city} this weekend.`;
    days[d].push({ kind: "pick", type, slot, name: p.name, entity_id: p.entity_id, score: p.score, reason, proof: p.proof, notes });
  }
  for (const e of events) {
    const k = dayKey(e.date, weekend); if (!k || pulled.has(evKey(e))) continue;
    days[k].push(eventItem(e, city, placeNames.has(lc(e.venue))));
  }
  return days;
}

// True when at least one hear slot carries a dated, sourced show (not the placeholder or the no-date "Your vibe").
export const hasDatedHear = (days) => Object.values(days).some((items) => items.some((i) => i.slot === "hear" && i.kind === "event" && i.date && i.source));
export const hasHearPlaceholder = (days) => Object.values(days).some((items) => items.some((i) => i.kind === "placeholder" && i.slot === "hear"));

export function boostedIds(placesRanked, events) {
  const venues = new Set(events.map((e) => lc(e.venue)));
  return new Set(placesRanked.filter((p) => venues.has(lc(p.name))).map((p) => p.entity_id));
}

// Qloo place entities carry coords in a few shapes; take the first finite pair.
export function coordsFrom(e) {
  const c = [e?.location, e?.properties?.geocode, e?.properties?.location, e?.geocode, e?.properties];
  for (const o of c) {
    if (!o || typeof o !== "object") continue;
    const lat = Number(o.lat ?? o.latitude), lon = Number(o.lon ?? o.lng ?? o.longitude);
    if (o && (o.lat ?? o.latitude) != null && Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return {};
}
