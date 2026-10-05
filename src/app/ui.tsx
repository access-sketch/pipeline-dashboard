import { addDays, DASHBOARD_TZ, isYmd, todayIn } from "@/lib/dates";
import { dateTime, shortDate } from "@/lib/format";
import { db } from "@/lib/supabase";

export type Range = { from: string; to: string; preset: string | null };

const PRESETS = [
  { key: "hoy", label: "Today" },
  { key: "ayer", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "14d", label: "14 days" },
  { key: "30d", label: "30 days" },
  { key: "mes", label: "This month" },
] as const;

function presetRange(key: string, today: string): { from: string; to: string } | null {
  switch (key) {
    case "hoy":
      return { from: today, to: today };
    case "ayer":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "14d":
      return { from: addDays(today, -13), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "mes":
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  return null;
}

export function resolveRange(sp: Record<string, string | string[] | undefined>, tz: string = DASHBOARD_TZ): Range {
  const today = todayIn(tz);
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  if (isYmd(from) && isYmd(to)) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const match = PRESETS.find((p) => {
      const r = presetRange(p.key, today);
      return r && r.from === a && r.to === b;
    });
    return { from: a, to: b, preset: match?.key ?? null };
  }
  const key = typeof sp.r === "string" && presetRange(sp.r, today) ? sp.r : "7d";
  return { ...presetRange(key, today)!, preset: key };
}

export function rangeLabel(r: Range): string {
  if (r.from === r.to) return shortDate(r.from);
  return `${shortDate(r.from)} to ${shortDate(r.to)}`;
}

export function RangeBar({ basePath, range, extra = {}, tz = DASHBOARD_TZ }: { basePath: string; range: Range; extra?: Record<string, string>; tz?: string }) {
  const keep = Object.entries(extra)
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");
  const today = todayIn(tz);
  return (
    <nav className="range" aria-label="Date range">
      <div className="presets">
        {PRESETS.map((p) => {
          const r = presetRange(p.key, today)!;
          return (
            <a
              key={p.key}
              className="preset"
              href={`${basePath}?from=${r.from}&to=${r.to}${keep}`}
              aria-current={range.preset === p.key ? "true" : undefined}
            >
              {p.label}
            </a>
          );
        })}
      </div>
      <form className="custom" method="get" action={basePath}>
        <label htmlFor="from">From</label>
        <input id="from" type="date" name="from" defaultValue={range.from} max={today} required />
        <label htmlFor="to">to</label>
        <input id="to" type="date" name="to" defaultValue={range.to} max={today} required />
        {Object.entries(extra).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button className="btn" type="submit">
          Apply
        </button>
      </form>
    </nav>
  );
}

type Run = { finished_at: string; ok: boolean; details: { step: string; ok: boolean; error?: string }[] };

export async function SyncStatus() {
  let run: Run | null = null;
  try {
    const { data } = await db().from("pd_sync_runs").select("finished_at,ok,details").order("finished_at", { ascending: false }).limit(1).maybeSingle();
    run = (data as Run) ?? null;
  } catch {
    run = null;
  }
  const failed = run?.details?.filter((d) => !d.ok) ?? [];
  return (
    <div className="status">
      <span>
        {run ? `Updated ${dateTime(run.finished_at, DASHBOARD_TZ)}` : "No sync has run yet"}
        {failed.length > 0 && (
          <span className="bad" title={failed.map((f) => `${f.step}: ${f.error}`).join("\n")}>
            {" "}
            with errors in {failed.map((f) => f.step).join(", ")} (hover for details)
          </span>
        )}
      </span>
      <a className="btn" href="/settings">
        Settings
      </a>
      <form method="post" action="/api/refresh">
        <button className="btn" type="submit">
          Refresh now
        </button>
      </form>
    </div>
  );
}

/**
 * Cambio contra el período anterior. `better` dice qué dirección es buena:
 * más leads es bueno, más costo por lead es malo.
 */
export function Delta({ cur, prev, better }: { cur: number | null; prev: number | null; better: "up" | "down" }) {
  if (cur === null || prev === null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  const change = (cur - prev) / Math.abs(prev);
  if (Math.abs(change) < 0.005) return <span className="delta flat">0%</span>;
  const good = better === "up" ? change > 0 : change < 0;
  const pctText = `${change > 0 ? "+" : "−"}${Math.round(Math.abs(change) * 100)}%`;
  return (
    <span className={`delta ${good ? "good" : "bad"}`} title="vs previous period">
      {pctText}
    </span>
  );
}
