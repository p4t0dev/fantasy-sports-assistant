// Single source of truth for the functions base URL. This string used to be
// duplicated in five components, so a missing NEXT_PUBLIC_API_URL silently
// compiled localhost into the production bundle in five places at once.
const FALLBACK = "http://127.0.0.1:5001/demo-no-project/us-central1";

export function apiUrl(path: string, params?: Record<string, string | undefined>): string {
  const base = process.env.NEXT_PUBLIC_API_URL || FALLBACK;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return `${base}/${path}${qs ? `?${qs}` : ""}`;
}

export async function apiGet<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const response = await fetch(apiUrl(path, params));
  if (!response.ok) {
    // Every endpoint now answers with JSON {error: "..."}, so surface the real
    // reason instead of a generic "request failed".
    let message = `Request fehlgeschlagen (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }
  return response.json();
}
