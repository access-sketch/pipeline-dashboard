/** fetch con reintentos para errores temporales (429 y 5xx). */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { retries = 4, label = "request" }: { retries?: number; label?: string } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (res.status !== 429 && res.status < 500) return res;
      lastError = new Error(`${label}: HTTP ${res.status} ${await safeText(res)}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt + Math.random() * 500);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ejecuta tareas con un límite de concurrencia. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
