import { config } from "@/config";
import { daysBetween } from "@/lib/dates";
import { dateTime, int, money, shortDate } from "@/lib/format";
import { getRangeUniques } from "@/lib/meta";
import { computeTotals, inStep, Lead, loadRange, previousRange, ratio, summarizeAds } from "@/lib/metrics";
import { loadAccount, loadFunnelSettings, loadPipelines } from "@/lib/settings";
import { AdFunnel, FunnelData } from "./funnel";
import { Delta, RangeBar, rangeLabel, resolveRange, SyncStatus } from "./ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Dashboard({ searchParams }: Props) {
  const sp = await searchParams;
  let account, settingsInfo, pipelines;
  try {
    [account, settingsInfo, pipelines] = await Promise.all([loadAccount(), loadFunnelSettings(), loadPipelines()]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A fresh database has no tables until the first sync creates them.
    return <Setup error={/does not exist|schema cache|relation/i.test(msg) ? null : msg} />;
  }
  if (!account) return <Setup error={null} />;

  const tz = account.timezone;
  const currency = account.currency;
  const { settings, isDefault } = settingsInfo;
  const range = resolveRange(sp, tz);
  const prev = previousRange(range.from, range.to);
  const adAccount = config.metaAdAccountId();

  const [cur, before, liveCur, livePrev] = await Promise.all([
    loadRange(range.from, range.to),
    loadRange(prev.from, prev.to),
    getRangeUniques(adAccount, range.from, range.to),
    getRangeUniques(adAccount, prev.from, prev.to),
  ]);
  const t = computeTotals(settings, cur.meta, cur.leads);
  const p = computeTotals(settings, before.meta, before.leads);
  const ads = await summarizeAds(settings, range.from, range.to, cur.leads);

  const sumBy = (rows: typeof cur.meta, k: "reach" | "unique_outbound_clicks") => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const funnelOf = (tot: typeof t, rows: typeof cur.meta, live: Awaited<ReturnType<typeof getRangeUniques>>): FunnelData => ({
    spend: tot.spend,
    reach: live?.reach ?? sumBy(rows, "reach"),
    uniqueOutboundClicks: live?.uniqueOutboundClicks ?? sumBy(rows, "unique_outbound_clicks"),
    lpv: tot.lpv,
    leads: tot.leads,
    steps: settings.steps.map((s, i) => ({ label: s.label, count: tot.steps[i] })),
    sales: tot.sales,
    revenue: tot.revenue,
  });

  const stageName = new Map(pipelines.flatMap((pl) => pl.stages.map((s) => [s.id, s.name] as const)));
  const days = daysBetween(range.from, range.to).reverse();

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1 className="title">{config.title()}</h1>
          <p className="subtitle">
            Results {rangeLabel(range)}. Changes compare with the previous period of the same length.
          </p>
        </div>
        <SyncStatus />
      </header>

      <RangeBar basePath="/" range={range} tz={tz} />

      {isDefault && (
        <p className="notice">
          The funnel steps were set automatically from your pipeline stage names. Check them in <a href="/settings">Settings</a>.
        </p>
      )}

      <AdFunnel cur={funnelOf(t, cur.meta, liveCur)} prev={funnelOf(p, before.meta, livePrev)} currency={currency} approximate={!liveCur} />

      <dl className="kpis">
        <Kpi label="Spend" value={money(t.spend, currency)} delta={<Delta cur={t.spend} prev={p.spend} better="up" />} />
        <Kpi label="Leads" value={int(t.leads)} sub={t.leads ? `${money(ratio(t.spend, t.leads), currency)} per lead` : "none yet"} />
        {settings.steps.map((s, i) => (
          <Kpi
            key={s.id}
            label={s.label}
            value={int(t.steps[i])}
            sub={t.steps[i] ? `${money(ratio(t.spend, t.steps[i]), currency)} each` : "none yet"}
            delta={<Delta cur={t.steps[i]} prev={p.steps[i]} better="up" />}
          />
        ))}
        {settings.noShowStageIds.length > 0 && <Kpi label="No-shows" value={int(t.noShows)} sub="ever moved to a no-show stage" />}
        {t.sales > 0 && (
          <Kpi
            label="Won deals"
            value={int(t.sales)}
            sub={t.revenue ? `${money(t.revenue, currency)}, ${(t.revenue / t.spend).toFixed(1)}x return on ad spend` : `${money(ratio(t.spend, t.sales), currency)} per won deal`}
          />
        )}
      </dl>

      <section className="section">
        <h2>By day</h2>
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Day</th>
                <th>Spend</th>
                <th>Landing page views</th>
                <th>Leads</th>
                <th>Cost per lead</th>
                {settings.steps.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const dl = cur.leads.filter((l) => l.local_date === d);
                const dm = cur.meta.filter((m) => m.date === d);
                const dt = computeTotals(settings, dm, dl);
                return (
                  <tr key={d}>
                    <td>{shortDate(d)}</td>
                    <td className="strong">{money(dt.spend, currency)}</td>
                    <td>{int(dt.lpv)}</td>
                    <td>{int(dt.leads)}</td>
                    <td className="cost">{money(ratio(dt.spend, dt.leads), currency)}</td>
                    {dt.steps.map((n, i) => (
                      <td key={i} className={i === 0 ? "num-booked" : "num-qual"}>
                        {int(n)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {ads.length > 0 && (
        <section className="section">
          <h2>By ad</h2>
          <p className="hint">Spend from Meta, matched to GHL leads by ad name (the utm_content each lead arrived with).</p>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Ad</th>
                  <th>Spend</th>
                  <th>Leads</th>
                  <th>Cost per lead</th>
                  {settings.steps.map((s) => (
                    <th key={s.id}>{s.label}</th>
                  ))}
                  <th>Cost per {settings.steps[0]?.label.toLowerCase().replace(/calls/, "call") ?? "step"}</th>
                  <th>Won</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((a) => (
                  <tr key={a.ad}>
                    <td>
                      {a.ad}
                      {a.campaign && <span className="src">{a.campaign}</span>}
                    </td>
                    <td className="strong">{a.spend === null ? <span className="na">–</span> : money(a.spend, currency)}</td>
                    <td>{int(a.leads)}</td>
                    <td className="cost">{a.spend === null ? <span className="na">–</span> : money(ratio(a.spend, a.leads), currency)}</td>
                    {a.steps.map((n, i) => (
                      <td key={i} className={i === 0 ? "num-booked" : "num-qual"}>
                        {int(n)}
                      </td>
                    ))}
                    <td className="cost">{a.spend === null ? <span className="na">–</span> : money(ratio(a.spend, a.steps[0] ?? 0), currency)}</td>
                    <td>{a.sales ? `${a.sales} (${money(a.revenue, currency)})` : <span className="na">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Leads</h2>
        {cur.leads.length === 0 ? (
          <p className="empty">No leads in this period.</p>
        ) : (
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Created</th>
                  <th className="left">Contact</th>
                  <th className="left">Current stage</th>
                  <th className="left">Reached</th>
                  <th className="left">Ad</th>
                </tr>
              </thead>
              <tbody>
                {cur.leads.map((l) => (
                  <LeadLine key={l.contact_id} lead={l} tz={tz} settings={settings} stageName={stageName} currency={currency} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function LeadLine({
  lead: l,
  tz,
  settings,
  stageName,
  currency,
}: {
  lead: Lead;
  tz: string;
  settings: Awaited<ReturnType<typeof loadFunnelSettings>>["settings"];
  stageName: Map<string, string>;
  currency: string;
}) {
  const current = (l.stage_ids ?? []).map((id) => stageName.get(id) ?? "Unknown stage").join(", ");
  return (
    <tr>
      <td>{dateTime(l.created_at, tz)}</td>
      <td className="left">
        <strong>{l.name || "No name"}</strong>
        <span className="src">{l.email}</span>
      </td>
      <td className="left">{current || <span className="na">No opportunity</span>}</td>
      <td className="left">
        {settings.steps.filter((s) => inStep(l, s)).map((s) => (
          <span key={s.id} className="badge b">
            {s.label}
          </span>
        ))}{" "}
        {l.won && <span className="badge q">Won{l.won_value ? ` ${money(Number(l.won_value), currency)}` : ""}</span>}
      </td>
      <td className="left">{l.utm_content || <span className="na">–</span>}</td>
    </tr>
  );
}

function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>
        {value}
        {delta}
        {sub && <small>{sub}</small>}
      </dd>
    </div>
  );
}

/** Shown before the first sync has run, or when a setting is missing. */
function Setup({ error }: { error: string | null }) {
  return (
    <main className="page">
      <h1 className="title">Almost ready</h1>
      {error ? (
        <p className="subtitle">Something is missing: {error}</p>
      ) : (
        <p className="subtitle">The first data load hasn't run yet.</p>
      )}
      <form method="post" action="/api/refresh?days=90" style={{ marginTop: 20 }}>
        <button className="btn" type="submit">
          Load the last 90 days now
        </button>
      </form>
      <p className="hint" style={{ marginTop: 12 }}>
        This takes up to a minute. After that the dashboard updates itself every day.
      </p>
    </main>
  );
}
