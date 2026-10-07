import { config } from "@/config";
import { singular } from "@/lib/words";
import { daysBetween } from "@/lib/dates";
import { dateTime, int, money, shortDate } from "@/lib/format";
import { getRangeUniques, getRangeUniquesByChannel } from "@/lib/meta";
import { channelBreakdown, computeTotals, inStep, Lead, leadChannel, loadRange, previousRange, ratio, summarizeAds, View } from "@/lib/metrics";
import { loadAccount, loadAdsetDestinations, loadFunnelSettings, loadPipelines } from "@/lib/settings";
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
  const view: View = sp.ch === "form" || sp.ch === "landing" ? sp.ch : "all";
  const destinations = view === "all" ? {} : await loadAdsetDestinations();

  type Live = { reach: number; uniqueOutboundClicks: number; uniqueLinkClicks: number } | null;
  const live = async (from: string, to: string): Promise<Live> => {
    if (view === "all") return getRangeUniques(adAccount, from, to);
    const byCh = await getRangeUniquesByChannel(adAccount, from, to, destinations);
    return byCh ? byCh[view] : null;
  };
  const [cur, before, liveCur, livePrev] = await Promise.all([
    loadRange(range.from, range.to, view),
    loadRange(prev.from, prev.to, view),
    live(range.from, range.to),
    live(prev.from, prev.to),
  ]);
  const t = computeTotals(settings, cur.meta, cur.leads);
  const p = computeTotals(settings, before.meta, before.leads);
  const ads = summarizeAds(settings, cur.ads, cur.leads, view);
  const channels = view === "all" ? channelBreakdown(settings, cur.allLeads, cur.ads, cur.landing) : [];

  const sumBy = (rows: typeof cur.meta, k: "reach" | "unique_outbound_clicks" | "unique_link_clicks") =>
    rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const funnelOf = (tot: typeof t, rows: typeof cur.meta, live: Live): FunnelData => ({
    mode: view,
    spend: tot.spend,
    reach: live?.reach ?? sumBy(rows, "reach"),
    uniqueOutboundClicks: live?.uniqueOutboundClicks ?? sumBy(rows, "unique_outbound_clicks"),
    uniqueLinkClicks: live?.uniqueLinkClicks ?? sumBy(rows, "unique_link_clicks"),
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

      <div className="toolbar">
        <RangeBar basePath="/" range={range} tz={tz} extra={view === "all" ? {} : { ch: view }} />
        <div className="presets" role="group" aria-label="Channel">
          {(
            [
              ["all", "All channels"],
              ["form", "Instant forms"],
              ["landing", "Landing pages"],
            ] as const
          ).map(([k, label]) => (
            <a
              key={k}
              className="preset"
              href={`/?from=${range.from}&to=${range.to}${k === "all" ? "" : `&ch=${k}`}`}
              aria-current={view === k ? "true" : undefined}
            >
              {label}
            </a>
          ))}
        </div>
      </div>

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

      {channels.length > 0 && (
        <section className="section">
          <h2>By channel</h2>
          <p className="hint">
            Instant form leads are matched to their ad by Meta’s ad ID. Website leads count as “Landing pages” when their utm_content
            matches a landing-page ad; the rest are organic or direct.
          </p>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Spend</th>
                  <th>Leads</th>
                  <th>Cost per lead</th>
                  {settings.steps.map((s) => (
                    <th key={s.id}>{s.label}</th>
                  ))}
                  {settings.steps.map((s) => (
                    <th key={`c${s.id}`}>Cost per {singular(s.label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.key}>
                    <td>
                      {c.key === "unpaid" ? (
                        c.label
                      ) : (
                        <a className="client-link" href={`/?from=${range.from}&to=${range.to}&ch=${c.key}`}>
                          {c.label}
                        </a>
                      )}
                    </td>
                    <td className="strong">{c.spend === null ? <span className="na">–</span> : money(c.spend, currency)}</td>
                    <td>{int(c.totals.leads)}</td>
                    <td className="cost">{c.spend === null ? <span className="na">–</span> : money(ratio(c.spend, c.totals.leads), currency)}</td>
                    {c.totals.steps.map((n, i) => (
                      <td key={i} className={i === 0 ? "num-booked" : "num-qual"}>
                        {int(n)}
                      </td>
                    ))}
                    {c.totals.steps.map((n, i) => (
                      <td key={`c${i}`} className="cost">
                        {c.spend === null ? <span className="na">–</span> : money(ratio(c.spend, n), currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
          <p className="hint">Spend from Meta, matched to GHL leads by ad ID (instant forms) or ad name (utm_content on landing pages).</p>
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
                  <th>Cost per {settings.steps[0] ? singular(settings.steps[0].label) : "step"}</th>
                  <th>Won</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((a) => (
                  <tr key={a.ad}>
                    <td>
                      {a.ad}
                      {(a.campaign || a.channel) && (
                        <span className="src">
                          {[a.channel === "form" ? "Instant form" : a.channel === "landing" ? "Landing page" : a.channel === "other" ? "Other" : null, a.campaign]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
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
                  <th className="left">Came from</th>
                  <th className="left">Current stage</th>
                  <th className="left">Reached</th>
                  <th className="left">Ad</th>
                </tr>
              </thead>
              <tbody>
                {cur.leads.map((l) => (
                  <LeadLine
                    key={l.contact_id}
                    lead={l}
                    tz={tz}
                    settings={settings}
                    stageName={stageName}
                    currency={currency}
                    channel={leadChannel(l, cur.landing)}
                  />
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
  channel,
}: {
  channel: string;
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
      <td className="left">{channel === "form" ? "Instant form" : channel === "landing" ? "Landing page" : "Organic / direct"}</td>
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
