import { int, money } from "@/lib/format";
import { Delta } from "./ui";

export type FunnelData = {
  /** "form": clicks open a Meta instant form; otherwise clicks go to a landing page. */
  mode: "form" | "landing" | "all";
  spend: number;
  reach: number;
  uniqueOutboundClicks: number;
  uniqueLinkClicks: number;
  lpv: number;
  leads: number;
  /** Pipeline steps after Leads (label + count). */
  steps: { label: string; count: number }[];
  sales: number;
  revenue: number;
};

type Metric = { label: string; value: string; cur: number | null; prev: number | null; better: "up" | "down" };
type Stage = { name: string; count: number | null; metrics: Metric[]; rate?: { label: string; value: number | null } };

const div = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b);
const pctText = (n: number | null) => (n === null ? "–" : `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`);

export function AdFunnel({
  cur,
  prev,
  currency,
  approximate,
}: {
  cur: FunnelData;
  prev: FunnelData;
  currency: string | null;
  approximate: boolean;
}) {
  const m = (d: FunnelData) => ({
    cpc: div(d.spend, d.uniqueOutboundClicks),
    ctr: div(d.uniqueOutboundClicks, d.reach),
    cplc: div(d.spend, d.uniqueLinkClicks),
    lctr: div(d.uniqueLinkClicks, d.reach),
    formCvr: div(d.leads, d.uniqueLinkClicks),
    cplpv: div(d.spend, d.lpv),
    cvr: div(d.leads, d.lpv),
    cpl: div(d.spend, d.leads),
  });
  const a = m(cur);
  const b = m(prev);

  const formTop: Stage[] = [
    {
      name: "Unique link clicks (form opens)",
      count: cur.uniqueLinkClicks,
      metrics: [
        { label: "Cost per unique link click", value: money(a.cplc, currency), cur: a.cplc, prev: b.cplc, better: "down" },
        { label: "Unique link CTR", value: pctText(a.lctr), cur: a.lctr, prev: b.lctr, better: "up" },
      ],
    },
    {
      name: "Leads",
      count: cur.leads,
      rate: { label: "of clicks", value: a.formCvr },
      metrics: [
        { label: "Form conversion (leads / link clicks)", value: pctText(a.formCvr), cur: a.formCvr, prev: b.formCvr, better: "up" },
        { label: "Cost per lead", value: money(a.cpl, currency), cur: a.cpl, prev: b.cpl, better: "down" },
      ],
    },
  ];
  const landingTop: Stage[] = [
    {
      name: "Unique outbound clicks",
      count: cur.uniqueOutboundClicks,
      metrics: [
        { label: "Cost per unique outbound click", value: money(a.cpc, currency), cur: a.cpc, prev: b.cpc, better: "down" },
        { label: "Unique outbound CTR", value: pctText(a.ctr), cur: a.ctr, prev: b.ctr, better: "up" },
      ],
    },
    {
      name: "Landing page views",
      count: cur.lpv,
      rate: { label: "of clicks", value: div(cur.lpv, cur.uniqueOutboundClicks) },
      metrics: [
        { label: "Cost per landing page view", value: money(a.cplpv, currency), cur: a.cplpv, prev: b.cplpv, better: "down" },
        { label: "Landing page views", value: int(cur.lpv), cur: cur.lpv, prev: prev.lpv, better: "up" },
      ],
    },
    {
      name: "Leads",
      count: cur.leads,
      rate: { label: "of page views", value: a.cvr },
      metrics: [
        { label: "Conversion rate (leads / page views)", value: pctText(a.cvr), cur: a.cvr, prev: b.cvr, better: "up" },
        { label: "Cost per lead", value: money(a.cpl, currency), cur: a.cpl, prev: b.cpl, better: "down" },
      ],
    },
  ];
  const allTop: Stage[] = [
    {
      name: "Unique link clicks",
      count: cur.uniqueLinkClicks,
      metrics: [
        { label: "Cost per unique link click", value: money(a.cplc, currency), cur: a.cplc, prev: b.cplc, better: "down" },
        { label: "Unique link CTR", value: pctText(a.lctr), cur: a.lctr, prev: b.lctr, better: "up" },
      ],
    },
    {
      name: "Leads",
      count: cur.leads,
      rate: { label: "of clicks", value: a.formCvr },
      metrics: [
        { label: "Cost per lead", value: money(a.cpl, currency), cur: a.cpl, prev: b.cpl, better: "down" },
        { label: "Landing page views", value: int(cur.lpv), cur: cur.lpv, prev: prev.lpv, better: "up" },
      ],
    },
  ];

  const stages: Stage[] = [
    ...(cur.mode === "form" ? formTop : cur.mode === "landing" ? landingTop : allTop),
    ...cur.steps.map((st, i): Stage => {
      const prevCount = prev.steps[i]?.count ?? null;
      const cost = div(cur.spend, st.count);
      const costPrev = prevCount === null ? null : div(prev.spend, prevCount);
      return {
        name: st.label,
        count: st.count,
        rate: { label: "of leads", value: div(st.count, cur.leads) },
        metrics: [
          { label: `Cost per ${singular(st.label)}`, value: money(cost, currency), cur: cost, prev: costPrev, better: "down" },
          { label: st.label, value: int(st.count), cur: st.count, prev: prevCount, better: "up" },
        ],
      };
    }),
  ];
  if (cur.sales > 0 || prev.sales > 0) {
    const cps = div(cur.spend, cur.sales);
    const roas = div(cur.revenue, cur.spend);
    stages.push({
      name: "Won deals",
      count: cur.sales,
      rate: { label: "of leads", value: div(cur.sales, cur.leads) },
      metrics: [
        { label: "Cost per won deal", value: money(cps, currency), cur: cps, prev: div(prev.spend, prev.sales), better: "down" },
        {
          label: "Revenue (return on ad spend)",
          value: cur.revenue ? `${money(cur.revenue, currency)}${roas ? ` (${roas.toFixed(1)}x)` : ""}` : "No deal values in GHL",
          cur: cur.revenue,
          prev: prev.revenue,
          better: "up",
        },
      ],
    });
  }

  return (
    <section className="section">
      <h2>Funnel</h2>
      <p className="hint">
        {cur.mode === "form"
          ? "Meta instant forms: people tap the ad, a form opens inside Facebook or Instagram, and they submit it."
          : cur.mode === "landing"
            ? "Landing pages: people click through to your website and fill in a form there."
            : "All channels together. Pick Instant forms or Landing pages above to see each funnel on its own."}{" "}
        {money(cur.spend, currency)} spent. Pipeline steps count each lead once, on the day it came in, if it has ever reached
        that stage.
        {approximate ? " Unique clicks are added up by day or ad set, so they may run slightly high." : ""}
      </p>
      <ol className="afunnel">
        {stages.map((s, i) => (
          <li key={s.name} className={`afunnel-row step-${Math.min(5, Math.round((i / Math.max(1, stages.length - 1)) * 4) + 1)}`}>
            <div className="afunnel-bar-wrap">
              {s.rate && (s.rate.value === null || s.rate.value <= 1) && (
                <span className="afunnel-rate">
                  ↓ {s.rate.value === null ? "–" : pctText(s.rate.value)} {s.rate.label}
                </span>
              )}
              <div className="afunnel-bar" style={{ width: `${Math.max(34, 100 - i * (62 / Math.max(1, stages.length - 1)))}%` }}>
                <span className="afunnel-count">{s.count === null ? "–" : int(s.count)}</span>
                <span className="afunnel-name">{s.name}</span>
              </div>
            </div>
            <div className="afunnel-metrics">
              {s.metrics.map((mt) => (
                <div key={mt.label} className="afunnel-metric">
                  <span className="afunnel-mlabel">{mt.label}</span>
                  <span className="afunnel-mvalue">
                    {mt.value}
                    <Delta cur={mt.cur} prev={mt.prev} better={mt.better} />
                  </span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function singular(label: string) {
  // "Discovery calls booked" → "discovery call booked", "Follow-ups" → "follow-up"
  return label
    .toLowerCase()
    .replace(/\bcalls\b/, "call")
    .replace(/ups\b/, "up")
    .replace(/deals\b/, "deal");
}
