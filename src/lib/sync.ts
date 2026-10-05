import { config, excluded, TEST_NAME_PATTERN } from "@/config";
import { addDays, localDate, todayIn } from "./dates";
import { getAllOpportunities, getPipelines, getUtmContentFieldIds, GhlContact, searchContacts } from "./ghl";
import { mapLimit } from "./http";
import { channelOf, getAccountInfo, getAdsetDestinations, getDailyAdInsights, getDailyInsights } from "./meta";
import { ensureSchema } from "./migrate";
import { setValue } from "./settings";
import { db, upsertChunks } from "./supabase";

export type StepResult = { step: string; ok: boolean; count?: number; error?: string };
export type SyncResult = { ok: boolean; startedAt: string; finishedAt: string; steps: StepResult[] };

/**
 * Pulls Meta spend for the last `days` days and GHL leads for the last `leadDays` days,
 * plus every opportunity in the account (so stage changes on older leads are never missed).
 * Every write is an upsert, so running it twice never duplicates anything.
 */
export async function syncAll(opts: { days: number; trigger: string }): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const steps: StepResult[] = [];
  const run = async (step: string, fn: () => Promise<number | void>) => {
    try {
      const count = await fn();
      steps.push({ step, ok: true, count: typeof count === "number" ? count : undefined });
    } catch (err) {
      steps.push({ step, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  await run("database", ensureSchema);
  if (!steps[0].ok) return finish(startedAt, steps, opts.trigger);

  let tz = "UTC";
  await run("meta", async () => {
    const id = config.metaAdAccountId();
    const info = await getAccountInfo(id);
    tz = info.timezone || "UTC";
    await setValue("account", { timezone: tz, currency: info.currency });
    const until = todayIn(tz);
    const since = addDays(until, -(opts.days - 1));
    const [daily, ads, destinations] = await Promise.all([
      getDailyInsights(id, since, until),
      getDailyAdInsights(id, since, until),
      getAdsetDestinations(id).catch(() => ({}) as Record<string, string>),
    ]);
    await setValue("adsets", destinations);
    const now = new Date().toISOString();
    await upsertChunks(
      "pd_meta_daily",
      daily.map((r) => ({
        date: r.date, spend: r.spend, impressions: r.impressions, reach: r.reach, clicks: r.clicks,
        unique_outbound_clicks: r.unique_outbound_clicks, unique_link_clicks: r.unique_link_clicks, lpv: r.lpv,
        meta_leads: r.meta_leads, form_leads: r.form_leads, currency: info.currency, updated_at: now,
      })),
      "date",
    );
    await upsertChunks(
      "pd_meta_ad_daily",
      ads.map((r) => ({
        date: r.date, ad_id: r.ad_id, ad_name: r.ad_name, adset_id: r.adset_id, campaign_name: r.campaign_name,
        channel: channelOf(r.adset_id ? destinations[r.adset_id] : undefined, r),
        spend: r.spend, impressions: r.impressions, reach: r.reach, clicks: r.clicks,
        unique_outbound_clicks: r.unique_outbound_clicks, unique_link_clicks: r.unique_link_clicks,
        lpv: r.lpv, meta_leads: r.meta_leads, form_leads: r.form_leads, updated_at: now,
      })),
      "date,ad_id",
    );
    return daily.length;
  });

  const token = safe(() => config.ghlToken());
  const locationId = safe(() => config.ghlLocationId());

  await run("ghl pipelines", async () => {
    if (!token || !locationId) throw new Error("GHL_TOKEN or GHL_LOCATION_ID is not set");
    const pipelines = await getPipelines(token, locationId);
    await setValue("pipelines", pipelines);
    return pipelines.length;
  });

  // Leads: contacts created in the period (with their UTMs).
  await run("ghl leads", async () => {
    if (!token || !locationId) throw new Error("GHL_TOKEN or GHL_LOCATION_ID is not set");
    const leadDays = Math.max(opts.days, 45);
    const sinceIso = new Date(Date.now() - leadDays * 86_400_000).toISOString();
    const [contacts, utmIds] = await Promise.all([
      searchContacts(token, locationId, [
        { field: "dateAdded", operator: "range", value: { gte: sinceIso, lte: new Date().toISOString() } },
      ]),
      getUtmContentFieldIds(token, locationId),
    ]);
    await upsertChunks("pd_leads", contacts.map((c) => leadRow(c, tz, utmIds)), "contact_id");
    return contacts.length;
  });

  // Opportunities: current stage of every deal, and the history of stages we have seen.
  await run("ghl pipeline stages", async () => {
    if (!token || !locationId) throw new Error("GHL_TOKEN or GHL_LOCATION_ID is not set");
    const opps = await getAllOpportunities(token, locationId);
    const byContact = new Map<string, { stages: Set<string>; won: boolean; value: number }>();
    for (const o of opps) {
      if (!o.contactId) continue;
      const e = byContact.get(o.contactId) ?? { stages: new Set<string>(), won: false, value: 0 };
      if (o.pipelineStageId) e.stages.add(o.pipelineStageId);
      if (o.status === "won") {
        e.won = true;
        e.value += Number(o.monetaryValue) || 0;
      }
      byContact.set(o.contactId, e);
    }
    const history = opps
      .filter((o) => o.contactId && o.pipelineStageId)
      .map((o) => ({ contact_id: o.contactId, stage_id: o.pipelineStageId }));
    // ignoreDuplicates keeps the first time we saw each stage.
    for (let i = 0; i < history.length; i += 500) {
      const { error } = await db()
        .from("pd_stage_history")
        .upsert(history.slice(i, i + 500), { onConflict: "contact_id,stage_id", ignoreDuplicates: true });
      if (error) throw new Error(`pd_stage_history: ${error.message}`);
    }
    // Current stage and Won status on the lead rows we have.
    const ids = [...byContact.keys()];
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await db().from("pd_leads").select("contact_id").in("contact_id", ids.slice(i, i + 300));
      if (error) throw new Error(`pd_leads: ${error.message}`);
      for (const r of data ?? []) known.add(r.contact_id);
    }
    await mapLimit([...known], 10, async (id) => {
      const e = byContact.get(id)!;
      const { error } = await db()
        .from("pd_leads")
        .update({ stage_ids: [...e.stages], won: e.won, won_value: e.won ? e.value : null })
        .eq("contact_id", id);
      if (error) throw new Error(`pd_leads: ${error.message}`);
    });
    return opps.length;
  });

  return finish(startedAt, steps, opts.trigger);
}

async function finish(startedAt: string, steps: StepResult[], trigger: string): Promise<SyncResult> {
  const finishedAt = new Date().toISOString();
  const ok = steps.every((s) => s.ok);
  try {
    await db().from("pd_sync_runs").insert({ started_at: startedAt, finished_at: finishedAt, ok, trigger, details: steps });
  } catch {
    // If the database itself is the problem, the response still reports it.
  }
  return { ok, startedAt, finishedAt, steps };
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function leadRow(c: GhlContact, tz: string, utmIds: string[]) {
  const email = c.email?.trim().toLowerCase() || null;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || null;
  const tags = (c.tags ?? []).map((t) => t.toLowerCase());
  const fields = Object.fromEntries((c.customFields ?? []).map((f) => [f.id, f.value]));
  return {
    contact_id: c.id,
    created_at: c.dateAdded,
    local_date: localDate(c.dateAdded, tz),
    email,
    name,
    has_email: !!email,
    is_test: isTest(email, `${name ?? ""} ${c.companyName ?? ""}`),
    utm_campaign: c.attributionSource?.campaign ?? c.attributionSource?.utmCampaign ?? c.lastAttributionSource?.utmCampaign ?? null,
    utm_content: c.attributionSource?.utmContent ?? firstField(fields, utmIds) ?? c.lastAttributionSource?.utmContent ?? null,
    tags,
    source: leadSource(c),
    ad_id: c.attributionSource?.adId ?? c.lastAttributionSource?.adId ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * "form" = Meta instant form (arrives through GHL's Facebook lead ads integration),
 * "website" = a form, survey or calendar on a page, "other" = anything else (manual, chat, ...).
 */
function leadSource(c: GhlContact): "form" | "website" | "other" {
  const a = c.attributionSource ?? {};
  const medium = (a.medium ?? "").toLowerCase();
  if (medium === "facebook" || medium === "instagram_lead_form" || (a.adSource === "facebook" && !a.url)) return "form";
  if (a.url || ["form", "survey", "calendar", "funnel", "quiz", "order_form"].includes(medium)) return "website";
  return "other";
}

function firstField(fields: Record<string, unknown>, ids: string[]): string | null {
  for (const id of ids) {
    const v = fields[id];
    if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
  }
  return null;
}

function isTest(email: string | null, name: string): boolean {
  const ex = excluded();
  if (email) {
    if (ex.emails.includes(email)) return true;
    if (ex.domains.includes(email.split("@")[1] ?? "")) return true;
  }
  return TEST_NAME_PATTERN.test(name);
}
