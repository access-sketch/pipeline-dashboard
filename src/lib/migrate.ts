import postgres from "postgres";

/**
 * Creates every table on first run, so a fresh Supabase database needs no manual SQL.
 * Tables are prefixed with "pd_" so they can share a database with other apps.
 * Uses the direct connection string that Vercel's Supabase integration adds.
 */
const MIGRATIONS = [
  `create table if not exists pd_meta_daily (
    date date primary key,
    spend numeric not null default 0, impressions integer not null default 0, reach integer not null default 0,
    clicks integer not null default 0, unique_outbound_clicks integer not null default 0, lpv integer not null default 0,
    meta_leads integer not null default 0, currency text, updated_at timestamptz not null default now())`,
  `create table if not exists pd_meta_ad_daily (
    date date not null, ad_id text not null, ad_name text, campaign_name text,
    spend numeric not null default 0, impressions integer not null default 0, reach integer not null default 0,
    clicks integer not null default 0, unique_outbound_clicks integer not null default 0, lpv integer not null default 0,
    meta_leads integer not null default 0, updated_at timestamptz not null default now(),
    primary key (date, ad_id))`,
  `create table if not exists pd_leads (
    contact_id text primary key, created_at timestamptz not null, local_date date not null,
    email text, name text, has_email boolean not null default false, is_test boolean not null default false,
    utm_campaign text, utm_content text, tags text[],
    stage_ids text[], stage_names text, won boolean not null default false, won_value numeric,
    updated_at timestamptz not null default now())`,
  `create index if not exists pd_leads_date on pd_leads (local_date)`,
  // Every stage a lead has been seen in. GHL only keeps the current stage; this keeps the history.
  `create table if not exists pd_stage_history (
    contact_id text not null, stage_id text not null, stage_name text, first_seen timestamptz not null default now(),
    primary key (contact_id, stage_id))`,
  `create table if not exists pd_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now())`,
  `create table if not exists pd_sync_runs (
    id bigserial primary key, started_at timestamptz not null, finished_at timestamptz not null,
    ok boolean not null, trigger text, details jsonb)`,
  `alter table pd_meta_daily enable row level security`,
  `alter table pd_meta_ad_daily enable row level security`,
  `alter table pd_leads enable row level security`,
  `alter table pd_stage_history enable row level security`,
  `alter table pd_settings enable row level security`,
  `alter table pd_sync_runs enable row level security`,
];

let done = false;

export async function ensureSchema(): Promise<void> {
  if (done) return;
  const raw = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!raw) throw new Error("POSTGRES_URL_NON_POOLING is not set. Connect Supabase to this project in Vercel (Storage tab).");
  const u = new URL(raw);
  u.search = "";
  const sql = postgres(u.toString(), { ssl: "require", max: 1, prepare: false, idle_timeout: 5, onnotice: () => {} });
  try {
    for (const m of MIGRATIONS) await sql.unsafe(m);
    // Tell Supabase's API to pick up new tables right away.
    await sql.unsafe(`notify pgrst, 'reload schema'`);
    // Give the API a moment to reload before the first writes.
    await new Promise((r) => setTimeout(r, 1500));
    done = true;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
