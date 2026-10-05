import type { FunnelSettings } from "./settings";
import { db, selectAll } from "./supabase";

export type MetaRow = {
  date: string;
  spend: number;
  reach: number;
  unique_outbound_clicks: number;
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

export async function loadRange(from: string, to: string) {
  const meta = await selectAll<MetaRow>((a, b) =>
    db()
      .from("pd_meta_daily")
      .select("date,spend,reach,unique_outbound_clicks,lpv,meta_leads")
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .range(a, b),
  );
  const rows = await selectAll<Omit<Lead, "reached">>((a, b) =>
    db()
      .from("pd_leads")
      .select("contact_id,created_at,local_date,email,name,has_email,utm_content,stage_ids,won,won_value")
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
  const leads: Lead[] = rows.map((r) => ({
    ...r,
    reached: new Set([...(history.get(r.contact_id) ?? []), ...(r.stage_ids ?? [])]),
  }));
  return { meta, leads };
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

export type AdSummary = { ad: string; campaign: string | null; spend: number | null; leads: number; steps: number[]; sales: number; revenue: number };

const adKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Meta spend per ad, matched to GHL leads by ad name (the utm_content each lead arrived with). */
export async function summarizeAds(settings: FunnelSettings, from: string, to: string, leads: Lead[]): Promise<AdSummary[]> {
  const ads = await selectAll<{ ad_id: string; ad_name: string | null; campaign_name: string | null; spend: number }>((a, b) =>
    db().from("pd_meta_ad_daily").select("ad_id,ad_name,campaign_name,spend").gte("date", from).lte("date", to).range(a, b),
  );
  const empty = (ad: string, campaign: string | null, spend: number | null): AdSummary => ({
    ad, campaign, spend, leads: 0, steps: settings.steps.map(() => 0), sales: 0, revenue: 0,
  });
  const map = new Map<string, AdSummary>();
  for (const r of ads) {
    const k = adKey(r.ad_name) || r.ad_id;
    const g = map.get(k) ?? empty(r.ad_name || r.ad_id, r.campaign_name, 0);
    g.spend = (g.spend ?? 0) + Number(r.spend);
    map.set(k, g);
  }
  for (const l of leads) {
    let k = adKey(l.utm_content);
    if (!map.has(k)) {
      k = "__none__";
      if (!map.has(k)) map.set(k, empty("No matching ad (missing or unknown utm_content)", null, null));
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
