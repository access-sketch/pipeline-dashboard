import type { FunnelSettings } from "./settings";
import { db, selectAll } from "./supabase";

export type View = "all" | "form" | "landing";

export type MetaRow = {
  date: string;
  spend: number;
  reach: number;
  unique_outbound_clicks: number;
  unique_link_clicks: number;
  lpv: number;
  meta_leads: number;
};

export type Lead = {
  contact_id: string;
  created_at: string;
  local_date: string;
  email: string | null;
  name: string | null;
  has_email: boolean;
  utm_content: string | null;
  source: string | null;
  ad_id: string | null;
  stage_ids: string[] | null;
  won: boolean;
  won_value: number | null;
  /** Every stage this lead has been seen in (history + current). */
  reached: Set<string>;
};

export type Totals = {
  spend: number;
  lpv: number;
  leads: number;
  /** Count per funnel step, in the order of settings.steps. */
  steps: number[];
  noShows: number;
  sales: number;
  revenue: number;
};

type AdRow = {
  date: string;
  ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  channel: string | null;
  spend: number;
  reach: number;
  unique_outbound_clicks: number;
  unique_link_clicks: number;
  lpv: number;
  meta_leads: number;
};

async function loadAds(from: string, to: string): Promise<AdRow[]> {
  return selectAll<AdRow>((a, b) =>
    db()
      .from("pd_meta_ad_daily")
      .select("date,ad_id,ad_name,campaign_name,channel,spend,reach,unique_outbound_clicks,unique_link_clicks,lpv,meta_leads")
      .gte("date", from)
      .lte("date", to)
      .range(a, b),
  );
}

/** Ids and names of every landing-page ad ever seen, to tell paid website leads from organic ones. */
async function landingAdKeys(): Promise<{ ids: Set<string>; names: Set<string> }> {
  const rows = await selectAll<{ ad_id: string; ad_name: string | null }>((a, b) =>
    db().from("pd_meta_ad_daily").select("ad_id,ad_name").eq("channel", "landing").range(a, b),
  );
  return { ids: new Set(rows.map((r) => r.ad_id)), names: new Set(rows.map((r) => adKey(r.ad_name)).filter(Boolean)) };
}

export type LeadChannel = "form" | "landing" | "unpaid";

export function leadChannel(l: Lead, landing: { ids: Set<string>; names: Set<string> }): LeadChannel {
  if (l.source === "form") return "form";
  if (l.source === "website" && ((l.ad_id && landing.ids.has(l.ad_id)) || landing.names.has(adKey(l.utm_content)))) return "landing";
  return "unpaid";
}

export async function loadRange(from: string, to: string, view: View = "all") {
  const [daily, ads, landing] = await Promise.all([
    view === "all"
      ? selectAll<MetaRow>((a, b) =>
          db()
            .from("pd_meta_daily")
            .select("date,spend,reach,unique_outbound_clicks,unique_link_clicks,lpv,meta_leads")
            .gte("date", from)
            .lte("date", to)
            .order("date")
            .range(a, b),
        )
      : Promise.resolve([] as MetaRow[]),
    loadAds(from, to),
    landingAdKeys(),
  ]);

  // Per channel, the daily numbers are the sum of that channel's ads.
  let meta = daily;
  if (view !== "all") {
    const byDate = new Map<string, MetaRow>();
    for (const r of ads.filter((x) => x.channel === view)) {
      const d = byDate.get(r.date) ?? { date: r.date, spend: 0, reach: 0, unique_outbound_clicks: 0, unique_link_clicks: 0, lpv: 0, meta_leads: 0 };
      d.spend += Number(r.spend);
      d.reach += r.reach;
      d.unique_outbound_clicks += r.unique_outbound_clicks;
      d.unique_link_clicks += r.unique_link_clicks;
      d.lpv += r.lpv;
      d.meta_leads += r.meta_leads;
      byDate.set(r.date, d);
    }
    meta = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  const rows = await selectAll<Omit<Lead, "reached">>((a, b) =>
    db()
      .from("pd_leads")
      .select("contact_id,created_at,local_date,email,name,has_email,utm_content,source,ad_id,stage_ids,won,won_value")
      .gte("local_date", from)
      .lte("local_date", to)
      .eq("is_test", false)
      .eq("has_email", true)
      .order("created_at", { ascending: false })
      .range(a, b),
  );
  const history = new Map<string, Set<string>>();
  const ids = rows.map((r) => r.contact_id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db().from("pd_stage_history").select("contact_id,stage_id").in("contact_id", ids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const h of data ?? []) {
      const set = history.get(h.contact_id) ?? new Set<string>();
      set.add(h.stage_id);
      history.set(h.contact_id, set);
    }
  }
  const allLeads: Lead[] = rows.map((r) => ({
    ...r,
    reached: new Set([...(history.get(r.contact_id) ?? []), ...(r.stage_ids ?? [])]),
  }));
  const leads = view === "all" ? allLeads : allLeads.filter((l) => leadChannel(l, landing) === view);
  return { meta, leads, allLeads, ads, landing };
}

export type ChannelRow = { key: LeadChannel; label: string; spend: number | null; totals: Totals };

/** Instant forms vs landing pages vs leads that didn't come from an ad, side by side. */
export function channelBreakdown(settings: FunnelSettings, allLeads: Lead[], ads: AdRow[], landing: { ids: Set<string>; names: Set<string> }): ChannelRow[] {
  const spendOf = (ch: string) => sum(ads.filter((a) => a.channel === ch).map((a) => Number(a.spend)));
  const metaOf = (ch: string): MetaRow[] =>
    ads
      .filter((a) => a.channel === ch)
      .map((a) => ({ date: a.date, spend: Number(a.spend), reach: a.reach, unique_outbound_clicks: a.unique_outbound_clicks, unique_link_clicks: a.unique_link_clicks, lpv: a.lpv, meta_leads: a.meta_leads }));
  const of = (ch: LeadChannel) => allLeads.filter((l) => leadChannel(l, landing) === ch);
  return [
    { key: "form", label: "Instant forms", spend: spendOf("form"), totals: computeTotals(settings, metaOf("form"), of("form")) },
    { key: "landing", label: "Landing pages", spend: spendOf("landing"), totals: computeTotals(settings, metaOf("landing"), of("landing")) },
    { key: "unpaid", label: "Not from an ad (organic, direct, manual)", spend: null, totals: computeTotals(settings, [], of("unpaid")) },
  ];
}

export function inStep(lead: Lead, step: FunnelSettings["steps"][number]): boolean {
  if (step.includeWon && lead.won) return true;
  return step.stageIds.some((id) => lead.reached.has(id));
}

export function computeTotals(settings: FunnelSettings, meta: MetaRow[], leads: Lead[]): Totals {
  const won = leads.filter((l) => l.won);
  return {
    spend: sum(meta.map((m) => Number(m.spend))),
    lpv: sum(meta.map((m) => m.lpv)),
    leads: leads.length,
    steps: settings.steps.map((s) => leads.filter((l) => inStep(l, s)).length),
    noShows: leads.filter((l) => settings.noShowStageIds.some((id) => l.reached.has(id))).length,
    sales: won.length,
    revenue: sum(won.map((l) => Number(l.won_value) || 0)),
  };
}

export type AdSummary = {
  ad: string;
  campaign: string | null;
  channel: string | null;
  spend: number | null;
  leads: number;
  steps: number[];
  sales: number;
  revenue: number;
};

const adKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Meta spend per ad, matched to GHL leads by ad ID (instant forms) or ad name (utm_content on landing pages). */
export function summarizeAds(settings: FunnelSettings, ads: AdRow[], leads: Lead[], view: View): AdSummary[] {
  const empty = (ad: string, campaign: string | null, channel: string | null, spend: number | null): AdSummary => ({
    ad, campaign, channel, spend, leads: 0, steps: settings.steps.map(() => 0), sales: 0, revenue: 0,
  });
  const map = new Map<string, AdSummary>();
  const idToKey = new Map<string, string>();
  for (const r of ads.filter((a) => view === "all" || a.channel === view)) {
    const k = adKey(r.ad_name) || r.ad_id;
    idToKey.set(r.ad_id, k);
    const g = map.get(k) ?? empty(r.ad_name || r.ad_id, r.campaign_name, r.channel, 0);
    g.spend = (g.spend ?? 0) + Number(r.spend);
    map.set(k, g);
  }
  for (const l of leads) {
    let k = (l.ad_id && idToKey.get(l.ad_id)) || adKey(l.utm_content);
    if (!map.has(k)) {
      k = "__none__";
      if (!map.has(k)) map.set(k, empty("No matching ad (organic, or ad outside this period)", null, null, null));
    }
    const g = map.get(k)!;
    g.leads++;
    settings.steps.forEach((s, i) => {
      if (inStep(l, s)) g.steps[i]++;
    });
    if (l.won) {
      g.sales++;
      g.revenue += Number(l.won_value) || 0;
    }
  }
  return [...map.values()].filter((g) => (g.spend ?? 0) > 0 || g.leads > 0).sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
}

export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const prevTo = new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(from) - days * 86_400_000).toISOString().slice(0, 10);
  return { from: prevFrom, to: prevTo };
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
export const ratio = (cost: number, n: number | null) => (n && n > 0 ? cost / n : null);
