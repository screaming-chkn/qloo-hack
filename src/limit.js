// Placeholder per-visitor limit hook. Real limits are owned by hosting/security.
export async function checkLimit(_request, _env) {
  return { ok: true };
}
