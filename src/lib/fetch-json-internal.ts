/**
 * Typed fetch for internal API calls; treats non-OK HTTP and invalid JSON as failure.
 */
export async function fetchJson<T>(
  url: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, error: `Invalid JSON (HTTP ${res.status})` };
    }
    if (!res.ok) {
      const err = (data as { error?: string })?.error;
      return { ok: false, error: err ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
