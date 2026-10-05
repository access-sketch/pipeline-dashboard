import { config } from "@/config";
import { getPipelines, Pipeline } from "./ghl";
import { db } from "./supabase";

/** One step of the sales funnel after "Leads", defined by pipeline stages. */
export type Step = {
  id: string;
  label: string;
  /** A lead counts in this step if it has ever been in any of these stages. */
  stageIds: string[];
  /** Also count leads whose opportunity was marked Won. */
  includeWon: boolean;
};

export type FunnelSettings = { steps: Step[]; noShowStageIds: string[] };
export type Account = { timezone: string; currency: string };

const lower = (s: string) => s.toLowerCase();

/**
 * Best guess from stage names, used until someone saves the Settings page.
 * Works for the usual setups: "... Booked", "Follow Up ...", "... Close ...", "No Show".
 */
export function defaultSettings(pipelines: Pipeline[]): FunnelSettings {
  const stages = pipelines.flatMap((p) => p.stages);
  const pick = (yes: RegExp, no?: RegExp) => stages.filter((s) => yes.test(lower(s.name)) && !(no && no.test(lower(s.name))));
  const notLead = /cancel|unrespon|not sched|new lead|lost|unqualif|disqualif|dead|nurture/;
  const booked = pick(/book|resched|no.?show|follow|close|closing|call|demo|meeting|consult|showed|discovery/, notLead);
  const follow = pick(/follow/, /cancel/);
  const close = pick(/close|closing/, /lost|cancel/);
  const noShow = pick(/no.?show/);
  const firstBooked = booked.find((s) => /book/.test(lower(s.name)));
  const steps: Step[] = [
    { id: "booked", label: firstBooked ? plural(firstBooked.name) : "Calls booked", stageIds: booked.map((s) => s.id), includeWon: true },
  ];
  if (follow.length) steps.push({ id: "follow", label: "Follow-ups", stageIds: follow.map((s) => s.id), includeWon: false });
  if (close.length)
    steps.push({ id: "close", label: close.length === 1 ? close[0].name : "Closing calls booked", stageIds: close.map((s) => s.id), includeWon: true });
  return { steps, noShowStageIds: noShow.map((s) => s.id) };
}

function plural(name: string) {
  // "Discovery Call Booked" → "Discovery calls booked"
  return name.replace(/\bCall\b/i, "calls").replace(/\bBooked\b/, "booked");
}

async function getValue<T>(key: string): Promise<T | null> {
  const { data, error } = await db().from("pd_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as T) ?? null;
}

export async function setValue(key: string, value: unknown) {
  const { error } = await db().from("pd_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function loadPipelines(): Promise<Pipeline[]> {
  const cached = await getValue<Pipeline[]>("pipelines");
  if (cached) return cached;
  return getPipelines(config.ghlToken(), config.ghlLocationId());
}

export async function loadFunnelSettings(): Promise<{ settings: FunnelSettings; isDefault: boolean }> {
  const saved = await getValue<FunnelSettings>("funnel");
  if (saved) return { settings: saved, isDefault: false };
  return { settings: defaultSettings(await loadPipelines()), isDefault: true };
}

export async function loadAccount(): Promise<Account | null> {
  return getValue<Account>("account");
}
