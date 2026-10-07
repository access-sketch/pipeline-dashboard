import { fetchWithRetry, safeText } from "./http";

const VERSION = process.env.META_API_VERSION || "v23.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

import { config } from "@/config";

function token(): string {
  return config.metaToken();
}

async function graph(url: string): Promise<any> {
  const res = await fetchWithRetry(url, {}, { label: "Meta" });
  const body = await res.json().catch(async () => ({ raw: await safeText(res) }));
  if (!res.ok || body.error) {
    const e = body.error;
    throw new Error(`Meta ${res.status}: ${e?.message ?? JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

export async function getAccountInfo(accountId: string): Promise<{ timezone: string; currency: string }> {
  const url = `${BASE}/act_${accountId}?fields=timezone_name,currency&access_token=${encodeURIComponent(token())}`;
  const b = await graph(url);
  return { timezone: b.timezone_name, currency: b.currency };
}

export type MetaDay = {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  unique_outbound_clicks: number;
  unique_link_clicks: number;
  clicks: number;
  lpv: number;
  meta_leads: number;
  meta_schedules: number;
  /** Leads from Meta instant forms (filled in without leaving Facebook/Instagram). */
  form_leads: number;
};

// Se toma el primer tipo de acción presente para no contar dos veces el mismo evento.
const LEAD_TYPES = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"];
const SCHEDULE_TYPES = ["schedule_total", "schedule_website", "offsite_conversion.fb_pixel_schedule"];
const FORM_LEAD_TYPES = ["onsite_conversion.lead_grouped", "leadgen_grouped"];
const LPV_TYPES = ["landing_page_view", "omni_landing_page_view"];

function outbound(list: { action_type: string; value: string }[] | undefined): number {
  return pick(list, ["outbound_click"]);
}

function pick(actions: { action_type: string; value: string }[] | undefined, types: string[]): number {
  if (!actions) return 0;
  for (const t of types) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

export async function getDailyInsights(accountId: string, since: string, until: string): Promise<MetaDay[]> {
  const params = new URLSearchParams({
    level: "account",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "spend,impressions,reach,clicks,unique_outbound_clicks,unique_inline_link_clicks,actions",
    limit: "500",
    access_token: token(),
  });
  let url: string | undefined = `${BASE}/act_${accountId}/insights?${params}`;
  const out: MetaDay[] = [];
  while (url) {
    const b = await graph(url);
    for (const r of b.data ?? []) {
      out.push({
        date: r.date_start,
        spend: Number(r.spend) || 0,
        impressions: Number(r.impressions) || 0,
        reach: Number(r.reach) || 0,
        unique_outbound_clicks: outbound(r.unique_outbound_clicks),
        unique_link_clicks: Number(r.unique_inline_link_clicks) || 0,
        clicks: Number(r.clicks) || 0,
        lpv: pick(r.actions, LPV_TYPES),
        meta_leads: pick(r.actions, LEAD_TYPES),
        meta_schedules: pick(r.actions, SCHEDULE_TYPES),
        form_leads: pick(r.actions, FORM_LEAD_TYPES),
      });
    }
    url = b.paging?.next;
  }
  return out;
}

export type MetaAdDay = MetaDay & { ad_id: string; ad_name: string | null; adset_id: string | null; campaign_name: string | null };

/** Gasto diario por anuncio. Solo devuelve anuncios con entrega en el período. */
export async function getDailyAdInsights(accountId: string, since: string, until: string): Promise<MetaAdDay[]> {
  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "ad_id,ad_name,adset_id,campaign_name,spend,impressions,reach,clicks,unique_outbound_clicks,unique_inline_link_clicks,actions",
    limit: "500",
    access_token: token(),
  });
  let url: string | undefined = `${BASE}/act_${accountId}/insights?${params}`;
  const out: MetaAdDay[] = [];
  while (url) {
    const b = await graph(url);
    for (const r of b.data ?? []) {
      out.push({
        date: r.date_start,
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? null,
        adset_id: r.adset_id ?? null,
        campaign_name: r.campaign_name ?? null,
        spend: Number(r.spend) || 0,
        impressions: Number(r.impressions) || 0,
        reach: Number(r.reach) || 0,
        unique_outbound_clicks: outbound(r.unique_outbound_clicks),
        unique_link_clicks: Number(r.unique_inline_link_clicks) || 0,
        clicks: Number(r.clicks) || 0,
        lpv: pick(r.actions, LPV_TYPES),
        meta_leads: pick(r.actions, LEAD_TYPES),
        meta_schedules: pick(r.actions, SCHEDULE_TYPES),
        form_leads: pick(r.actions, FORM_LEAD_TYPES),
      });
    }
    url = b.paging?.next;
  }
  return out;
}

/** Fecha de vencimiento del token (null = no vence). */
export async function getTokenExpiry(): Promise<Date | null> {
  const t = token();
  const b = await graph(`${BASE}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`);
  const exp = b.data?.expires_at;
  return exp ? new Date(exp * 1000) : null;
}

/**
 * Totales exactos del período, deduplicados por Meta (como en Ads Manager).
 * Reach y clics únicos no se pueden sumar día por día, por eso se piden al vuelo.
 */
export async function getRangeUniques(
  accountId: string,
  since: string,
  until: string,
): Promise<{ reach: number; uniqueOutboundClicks: number; uniqueLinkClicks: number } | null> {
  const params = new URLSearchParams({
    level: "account",
    time_range: JSON.stringify({ since, until }),
    fields: "reach,unique_outbound_clicks,unique_inline_link_clicks",
    access_token: token(),
  });
  try {
    const res = await fetch(`${BASE}/act_${accountId}/insights?${params}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10_000),
    });
    const b = await res.json();
    if (!res.ok || b.error) return null;
    const r = b.data?.[0];
    if (!r) return { reach: 0, uniqueOutboundClicks: 0, uniqueLinkClicks: 0 };
    return {
      reach: Number(r.reach) || 0,
      uniqueOutboundClicks: outbound(r.unique_outbound_clicks),
      uniqueLinkClicks: Number(r.unique_inline_link_clicks) || 0,
    };
  } catch {
    return null;
  }
}

export type Channel = "form" | "landing" | "other";

/** Where each ad set sends people (ON_AD = instant form, WEBSITE = landing page, ...). */
export async function getAdsetDestinations(accountId: string): Promise<Record<string, string>> {
  const params = new URLSearchParams({
    fields: "id,destination_type",
    limit: "500",
    filtering: JSON.stringify([
      { field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"] },
    ]),
    access_token: token(),
  });
  let url: string | undefined = `${BASE}/act_${accountId}/adsets?${params}`;
  const out: Record<string, string> = {};
  while (url) {
    const b = await graph(url);
    for (const a of b.data ?? []) out[a.id] = a.destination_type ?? "UNDEFINED";
    url = b.paging?.next;
  }
  return out;
}

/**
 * Instant form, landing page, or other (Messenger, Instagram DM, ...).
 * What the ad actually produced decides first (instant-form leads vs. website leads and page views);
 * the ad set's destination is only used when there are no results yet.
 * "WEBSITE_AND_LEAD_FORM" ad sets show an instant form, so they count as forms unless they bring website leads.
 */
export function channelOf(destination: string | undefined, r: { lpv: number; form_leads: number; meta_leads: number; unique_outbound_clicks: number }): Channel {
  const d = (destination ?? "UNDEFINED").toUpperCase();
  if (d === "ON_AD") return "form";
  const websiteLeads = Math.max(0, r.meta_leads - r.form_leads);
  if (r.form_leads > 0 && r.form_leads >= websiteLeads) return "form";
  if (websiteLeads > 0 || r.lpv > 0) return "landing";
  if (d.includes("LEAD_FORM")) return "form";
  if (d.includes("WEBSITE") || r.unique_outbound_clicks > 0 || d === "UNDEFINED") return "landing";
  return "other";
}

/** True when an ad has produced anything that tells us its channel. */
export function hasChannelEvidence(r: { lpv: number; form_leads: number; meta_leads: number }): boolean {
  return r.form_leads > 0 || r.meta_leads > 0 || r.lpv > 0;
}

export type ChannelUniques = Record<Channel, { reach: number; uniqueOutboundClicks: number; uniqueLinkClicks: number }>;

/**
 * Reach and unique clicks per channel for a date range, from ad set totals
 * (Meta de-duplicates people within each ad set; across ad sets they are added up).
 */
export async function getRangeUniquesByChannel(
  accountId: string,
  since: string,
  until: string,
  destinations: Record<string, string>,
): Promise<ChannelUniques | null> {
  const params = new URLSearchParams({
    level: "adset",
    time_range: JSON.stringify({ since, until }),
    fields: "adset_id,reach,unique_outbound_clicks,unique_inline_link_clicks,actions",
    limit: "500",
    access_token: token(),
  });
  const out: ChannelUniques = {
    form: { reach: 0, uniqueOutboundClicks: 0, uniqueLinkClicks: 0 },
    landing: { reach: 0, uniqueOutboundClicks: 0, uniqueLinkClicks: 0 },
    other: { reach: 0, uniqueOutboundClicks: 0, uniqueLinkClicks: 0 },
  };
  try {
    let url: string | undefined = `${BASE}/act_${accountId}/insights?${params}`;
    while (url) {
      const res: Response = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(15_000) });
      const b: any = await res.json();
      if (!res.ok || b.error) return null;
      for (const r of b.data ?? []) {
        const ch = channelOf(destinations[r.adset_id], {
          lpv: pick(r.actions, LPV_TYPES),
          form_leads: pick(r.actions, FORM_LEAD_TYPES),
          meta_leads: pick(r.actions, LEAD_TYPES),
          unique_outbound_clicks: outbound(r.unique_outbound_clicks),
        });
        out[ch].reach += Number(r.reach) || 0;
        out[ch].uniqueOutboundClicks += outbound(r.unique_outbound_clicks);
        out[ch].uniqueLinkClicks += Number(r.unique_inline_link_clicks) || 0;
      }
      url = b.paging?.next;
    }
    return out;
  } catch {
    return null;
  }
}
