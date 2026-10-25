"use client";
import { useMemo } from "react";
import { d, displayMoney } from "@/lib/money";
import { reportChartData, type ChartMetric, type ChartPeriod, type ChartRow } from "@/lib/report-charts";
import type { ReportDrill, ReportGroup, ReportMode } from "@/lib/report-detail";
import type { Snapshot } from "@/lib/types";
import { AccumulatedResult } from "./accumulated-result";
import { BalanceComposition, CategoryBars, ReportTrend, type ChartSeries } from "./report-chart";
import { Notice } from "./ui";

const profitSeries: ChartSeries[] = [
  { key: "revenue", label: "Revenue", color: "revenue", bars: true },
  { key: "expenses", label: "Expenses", color: "expenses", bars: true },
  { key: "profit", label: "Profit / loss", color: "profit" },
];
const balanceSeries: ChartSeries[] = [
  { key: "assets", label: "Assets", color: "assets" },
  { key: "liabilities", label: "Liabilities", color: "liabilities", dash: "7 4" },
  { key: "equity", label: "Equity", color: "equity", dash: "2 4" },
];
const groups: Record<ChartMetric, ReportGroup> = {
  revenue: "revenue", expenses: "expense", profit: "all", assets: "asset", liabilities: "liability", equity: "equity",
};
export function GraphicalReportsView({ snapshot, mode, from, to, category, setCategory, drill, openAccumulated }: {
  snapshot: Snapshot; mode: ReportMode; from: string; to: string;
  category: "revenue" | "expense"; setCategory: (value: "revenue" | "expense") => void;
  drill: (selection: ReportDrill) => void; openAccumulated: () => void;
}) {
  const invalid = mode === "profit_loss" && !!from && !!to && from > to;
  const data = useMemo(() => invalid ? null : reportChartData(snapshot, mode, from, to), [snapshot, mode, from, to, invalid]);
  if (!data) return <Notice error message="From date must be on or before through date." />;
  const currency = snapshot.workspace.functional_currency_code, profitLoss = mode === "profit_loss";
  const period = { from: profitLoss ? from : "", to };
  function openMetric(metric: ChartMetric, dates = period) {
    drill({ mode, ...dates, group: groups[metric] });
  }
  function openRow(row: ChartRow) {
    if (row.id === "accumulated") openAccumulated();
    else drill({ mode, ...period, accountId: row.accountId });
  }
  const series = profitLoss ? profitSeries : balanceSeries;
  const totals = profitLoss
    ? [["revenue", "Revenue"], ["expenses", "Expenses"], ["profit", "Net profit / loss"]] as const
    : [["assets", "Assets"], ["liabilities", "Liabilities"], ["equity", "Total equity"]] as const;
  return <div className="graphical-reports">
    <section className="panel" aria-label="Graphical report summary">
      <div className="eyebrow">{profitLoss ? "MONEY EARNED & SPENT" : "WHAT YOU HAVE & OWE"}</div>
      <h2>{profitLoss ? snapshot.workspace.kind === "personal" ? "Income & spending" : "Profit & loss" : "Balance sheet"}</h2>
      <p className="muted">{profitLoss ? `${from || "All dates"} — ${to || "All dates"}` : `As of ${to || "all dates"}`}
        {" · "}{currency} · Posted historical values · Drafts excluded</p>
      <div className="stats">
        {totals.map(([metric, label]) => <button className="stat graph-stat" key={metric} onClick={() => openMetric(metric)}>
          <span className="stat-label">{label}</span>
          <span className={`stat-value ${d(data.full[metric]).lt(0) ? "graph-negative" : ""}`}>{displayMoney(data.full[metric], currency)}</span>
          <span className="stat-foot">View supporting entries ↗</span>
        </button>)}
      </div>
      {!profitLoss && <>
        <AccumulatedResult amount={data.full.unclosed} currency={currency} open={openAccumulated} />
        <div className="balance-check">{d(data.full.assets).eq(d(data.full.liabilities).plus(data.full.equity))
          ? "✓ Assets = liabilities + equity" : "Balance needs attention"}</div>
      </>}
    </section>
    {!profitLoss && <section className="panel" aria-label="Assets and funding">
      <h2>What you own and how it is funded</h2>
      <p className="muted">Both sides use the same scale. Negative balances extend left of zero.</p>
      <BalanceComposition assets={data.assets} funding={data.funding} currency={currency} open={openRow} />
    </section>}
    <section className="panel" aria-label="Report trends">
      <h2>{profitLoss ? `Revenue, expenses and profit by ${data.interval}` : "Closing balances by month"}</h2>
      <p className="muted">{profitLoss ? "Each point covers only its dates within the selected period."
        : `Last 12 months through ${data.end}. Each point includes all earlier postings.`} Select a value to inspect its entries.</p>
      <ReportTrend periods={data.periods} series={series} currency={currency}
        open={(point: ChartPeriod, metric) => openMetric(metric, { from: point.from, to: point.to })} />
    </section>
    {profitLoss && <section className="panel" aria-label="Category breakdown">
      <div className="section-head"><h2>{category === "expense" ? "Expense categories" : "Revenue categories"}</h2>
        <div className="report-switch" role="group" aria-label="Category type">
          <button aria-pressed={category === "expense"} onClick={() => setCategory("expense")}>Expenses</button>
          <button aria-pressed={category === "revenue"} onClick={() => setCategory("revenue")}>Revenue</button>
        </div>
      </div>
      <p className="muted">Largest amounts first · {currency} · Select an account to see its journal detail.</p>
      <CategoryBars rows={category === "expense" ? data.expenses : data.revenue} currency={currency}
        color={category === "expense" ? "expenses" : "revenue"} open={openRow} />
    </section>}
  </div>;
}
