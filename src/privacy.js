// Strip anything personal before it leaves the Worker (Qloo or live sources).
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const HANDLE = /(^|\s)@\w+/g;
const URLS = /https?:\/\/\S+/gi;
const clean = (s) => String(s ?? "").replace(EMAIL, " ").replace(URLS, " ").replace(PHONE, " ").replace(HANDLE, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
export const sanitizeSeed = (s) => clean(s).slice(0, 80);
// City or "City, ST" or ZIP; ZIP+4 trimmed to 5 so location stays coarse.
export const sanitizeCity = (s) => String(s ?? "").replace(EMAIL, " ").replace(/(\d{5})-\d{4}/g, "$1").replace(/[^\p{L}\p{N} ,.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
