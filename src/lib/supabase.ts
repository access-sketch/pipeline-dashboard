import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
  client = createClient(normalizeUrl(url), key.trim(), { auth: { persistSession: false } });
  return client;
}

/** Trae todas las filas de una consulta, paginando de a 1000. */
export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

export async function upsertChunks(table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/**
 * Accepts the URL in any of the forms people usually paste:
 * "https://ref.supabase.co", ".../rest/v1/", or the dashboard link
 * "https://supabase.com/dashboard/project/ref". Always returns "https://ref.supabase.co".
 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  const dash = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1]}.supabase.co`;
  try {
    return new URL(s.startsWith("http") ? s : `https://${s}`).origin;
  } catch {
    return s;
  }
}
