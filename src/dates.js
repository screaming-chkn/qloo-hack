// Date helpers (UTC calendar dates, YYYY-MM-DD).
const D = 86400000;
const parse = (s) => Date.parse(s + "T00:00:00Z");
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s, n) => fmt(parse(s) + n * D);
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / D);
export const todayStr = (now = new Date()) => now.toISOString().slice(0, 10);

// This weekend: if today is Fri/Sat/Sun use the current one, else the next Fri-Sun.
export function weekendOf(today) {
  const dow = new Date(parse(today)).getUTCDay(); // 0 Sun .. 6 Sat
  const back = { 5: 0, 6: 1, 0: 2 }[dow];
  const fri = back !== undefined ? addDays(today, -back) : addDays(today, 5 - dow);
  return { fri, sat: addDays(fri, 1), sun: addDays(fri, 2) };
}
export const inWindow = (d, w) => typeof d === "string" && d >= w.fri && d <= w.sun;
export const dayKey = (d, w) => (d === w.fri ? "fri" : d === w.sat ? "sat" : d === w.sun ? "sun" : null);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (s) => { const d = new Date(parse(s)); return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
// Card label for an event outside this weekend, so it never passes as a weekend pick. null if inside the weekend.
export function offWeekendLabel(d, w) {
  if (inWindow(d, w)) return null;
  const when = d < w.fri ? "This week" : d <= addDays(w.sun, 7) ? "Next week" : "Coming up";
  return `${when}: ${shortDate(d)}`;
}

// The city's own calendar date, so "this weekend" flips at local midnight, not UTC midnight.
const ZONES = { TX: "America/Chicago", IL: "America/Chicago", MN: "America/Chicago", LA: "America/Chicago", TN: "America/Chicago", MO: "America/Chicago", WI: "America/Chicago",
  NY: "America/New_York", MA: "America/New_York", GA: "America/New_York", FL: "America/New_York", DC: "America/New_York", PA: "America/New_York", NC: "America/New_York", MI: "America/Detroit",
  CO: "America/Denver", UT: "America/Denver", NM: "America/Denver", AZ: "America/Phoenix",
  CA: "America/Los_Angeles", WA: "America/Los_Angeles", OR: "America/Los_Angeles", NV: "America/Los_Angeles" };
const CITY_ZONES = { austin: "America/Chicago", chicago: "America/Chicago", houston: "America/Chicago", dallas: "America/Chicago", nashville: "America/Chicago", "new orleans": "America/Chicago", minneapolis: "America/Chicago",
  "new york": "America/New_York", brooklyn: "America/New_York", boston: "America/New_York", atlanta: "America/New_York", miami: "America/New_York", philadelphia: "America/New_York", washington: "America/New_York", detroit: "America/Detroit",
  denver: "America/Denver", phoenix: "America/Phoenix", "salt lake city": "America/Denver",
  "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles", seattle: "America/Los_Angeles", portland: "America/Los_Angeles", "las vegas": "America/Los_Angeles", "san diego": "America/Los_Angeles" };
const ZIP3 = [[0, 299, "America/New_York"], [300, 349, "America/New_York"], [350, 399, "America/Chicago"], [400, 499, "America/New_York"], [500, 799, "America/Chicago"], [800, 849, "America/Denver"], [850, 865, "America/Phoenix"], [870, 884, "America/Denver"], [889, 961, "America/Los_Angeles"], [970, 994, "America/Los_Angeles"]];
export const DEFAULT_ZONE = "America/Los_Angeles";
export function cityZone(city = "") {
  const s = String(city).trim(), zip = (s.match(/\b\d{5}\b/) || [])[0];
  if (zip) { const z = Number(zip.slice(0, 3)); const hit = ZIP3.find(([a, b]) => z >= a && z <= b); return hit ? hit[2] : DEFAULT_ZONE; }
  const [name, st] = s.split(",").map((x) => x.trim());
  return CITY_ZONES[(name || "").toLowerCase()] || ZONES[(st || "").toUpperCase()] || DEFAULT_ZONE;
}
export function localToday(city, now = new Date()) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: cityZone(city), year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
  catch { return todayStr(now); }
}
