/**
 * Base URL for server-side fetch() to this app's own API routes.
 * Prefer INTERNAL_BASE_URL / NEXT_PUBLIC_APP_URL, then VERCEL_URL, then request origin.
 */
export function getInternalAppBaseUrl(request: Request): string {
  const explicit =
    process.env.INTERNAL_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, '');
    return `https://${host}`;
  }
  return new URL(request.url).origin;
}
