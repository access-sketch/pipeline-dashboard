import { fetchWithRetry, safeText } from "./http";

const BASE = "https://services.leadconnectorhq.com";

export type GhlContact = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  dateAdded: string;
  tags: string[];
  customFields: { id: string; value: unknown }[];
  opportunities?: { id?: string; pipelineId: string; pipelineStageId: string; monetaryValue?: number; status?: string }[];
  attributionSource?: Attribution;
  lastAttributionSource?: Attribution;
  searchAfter?: unknown[];
};

export type Attribution = {
  utmContent?: string;
  campaign?: string;
  utmCampaign?: string;
  medium?: string;
  url?: string;
  adId?: string;
  adSource?: string;
  fbclid?: string;
};

type Filter = { field: string; operator: string; value: unknown };

export async function searchContacts(token: string, locationId: string, filters: Filter[]): Promise<GhlContact[]> {
  const out: GhlContact[] = [];
  let searchAfter: unknown[] | undefined;
  for (let page = 0; page < 200; page++) {
    const body: Record<string, unknown> = { locationId, pageLimit: 100, filters };
    if (searchAfter) body.searchAfter = searchAfter;
    const res = await fetchWithRetry(
      `${BASE}/contacts/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
      { label: "GHL" },
    );
    if (!res.ok) throw new Error(`GHL ${res.status}: ${await safeText(res)}`);
    const data = (await res.json()) as { contacts?: GhlContact[] };
    const contacts = data.contacts ?? [];
    out.push(...contacts);
    if (contacts.length < 100) break;
    searchAfter = contacts[contacts.length - 1].searchAfter;
    if (!searchAfter) break;
  }
  return out;
}

export type Pipeline = { id: string; name: string; stages: { id: string; name: string }[] };

export async function getPipelines(token: string, locationId: string): Promise<Pipeline[]> {
  const res = await fetchWithRetry(
    `${BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } },
    { label: "GHL pipelines" },
  );
  if (!res.ok) throw new Error(`GHL pipelines ${res.status}: ${await safeText(res)}`);
  const data = (await res.json()) as { pipelines?: Pipeline[] };
  return (data.pipelines ?? []).map((p) => ({ id: p.id, name: p.name, stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name })) }));
}

/** Mapa id de etapa → nombre, de todos los pipelines de la sub-account. */
export async function getStageNames(token: string, locationId: string): Promise<Map<string, string>> {
  const res = await fetchWithRetry(
    `${BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } },
    { label: "GHL pipelines" },
  );
  if (!res.ok) throw new Error(`GHL pipelines ${res.status}: ${await safeText(res)}`);
  const data = (await res.json()) as { pipelines?: { stages: { id: string; name: string }[] }[] };
  const map = new Map<string, string>();
  for (const p of data.pipelines ?? []) for (const st of p.stages ?? []) map.set(st.id, st.name);
  return map;
}

export type GhlOpportunity = {
  id: string;
  contactId: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue?: number;
  createdAt?: string;
  lastStageChangeAt?: string;
};

/** Every opportunity in the sub-account (all pipelines), paging through the whole list. */
export async function getAllOpportunities(token: string, locationId: string): Promise<GhlOpportunity[]> {
  const out: GhlOpportunity[] = [];
  let cursor: { startAfter: string; startAfterId: string } | null = null;
  for (let page = 0; page < 500; page++) {
    const params = new URLSearchParams({ location_id: locationId, limit: "100" });
    if (cursor) {
      params.set("startAfter", cursor.startAfter);
      params.set("startAfterId", cursor.startAfterId);
    }
    const res = await fetchWithRetry(
      `${BASE}/opportunities/search?${params}`,
      { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } },
      { label: "GHL opportunities" },
    );
    if (!res.ok) throw new Error(`GHL opportunities ${res.status}: ${await safeText(res)}`);
    const data = (await res.json()) as {
      opportunities?: GhlOpportunity[];
      meta?: { startAfter?: number | string; startAfterId?: string };
    };
    const opps = data.opportunities ?? [];
    out.push(...opps);
    if (opps.length < 100 || !data.meta?.startAfterId) break;
    cursor = { startAfter: String(data.meta.startAfter), startAfterId: data.meta.startAfterId };
  }
  return out;
}

/** Some funnels store utm_content in a custom field. Finds it by name; returns [] if the token can't read fields. */
export async function getUtmContentFieldIds(token: string, locationId: string): Promise<string[]> {
  try {
    const res = await fetchWithRetry(
      `${BASE}/locations/${encodeURIComponent(locationId)}/customFields?model=contact`,
      { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } },
      { label: "GHL custom fields", retries: 1 },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { customFields?: { id: string; name: string }[] };
    return (data.customFields ?? []).filter((f) => /^\s*utm[_ ]?content\s*$/i.test(f.name)).map((f) => f.id);
  } catch {
    return [];
  }
}
