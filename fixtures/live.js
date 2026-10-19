// MOCK live-layer fixtures: events dated relative to the requested weekend, plus venue notes.
// URLs are example.org placeholders so nothing here pretends to be a real listing.
import { addDays } from "../src/dates.js";
const EV = {
  austin: [["Night Drive Synthwave Showcase", "Continental Club", "fri"], ["Cult Movie Marathon: 80s Edition", "Alamo Drafthouse South Lamar", "sat"], ["Sunday Honky Tonk + Chicken Dance", "Ginny's Little Longhorn", "sun"], ["Classic Car Cruise-In", "South Congress", "sat"]],
  chicago: [["Late Set: Uptown Jazz", "Green Mill", "fri"], ["Midnight Movie: Thief (35mm)", "Music Box Theatre", "sat"], ["Power Pop Sunday", "Metro", "sun"], ["Lakefront Hot Rod Meet", "Montrose Harbor", "sun"]],
  default: [["Downtown Night Market", "Main St", "fri"], ["Retro Arcade Night", "City Arcade", "sat"], ["Sunday Drive-In Double Feature", "Drive-In", "sun"]],
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
export function mockLive(city, w) {
  const k = String(city || "").toLowerCase().split(/[ ,]/)[0];
  const ev = EV[k] || EV.default;
  const events = ev.map(([title, venue, d]) => ({ kind: "event", title, venue, date: w[d], source: { name: "Mock local listings (fixture)", url: `https://example.org/mock/events/${slug(k || "x")}/${slug(title)}` } }));
  // undated / unsourced decoys: must be filtered out
  events.push({ kind: "event", title: "Unsourced rumor", venue: "?", date: w.sat, source: { name: "?" } });
  events.push({ kind: "event", title: "Next week thing", venue: "?", date: addDays(w.sun, 3), source: { name: "Mock", url: "https://example.org/mock/late" } });
  return { events };
}
export function mockNotes(names, now) {
  const date = new Date(now).toISOString().slice(0, 10);
  const notes = names.map((place, i) => ({ kind: "note", place, text: ["restaurant · hours: 24/7", "bar · live music: yes", "cafe · outdoor seating: yes"][i % 3], date, source: { name: "Mock venue notes (fixture)", url: `https://example.org/mock/notes/${slug(place)}` } }));
  notes.push({ kind: "note", place: names[0], text: "undated decoy", source: { name: "Mock", url: "https://example.org/x" } });
  return notes;
}
