"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { d, displayMoney, money } from "@/lib/money";
import { chartDomain, type ChartMetric, type ChartPeriod, type ChartRow } from "@/lib/report-charts";

export interface ChartSeries {
  key: ChartMetric;
  label: string;
  color: string;
  bars?: boolean;
  dash?: string;
}
function usePlotWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
function activate(event: KeyboardEvent<SVGGElement>, open: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
}
function tickLabel(value: string) {
  const amount = d(value), absolute = amount.abs();
  for (const [unit, suffix] of [["1000000000000", "T"], ["1000000000", "B"], ["1000000", "M"], ["1000", "K"]])
    if (absolute.gte(unit)) return `${amount.div(unit).toSignificantDigits(4).toString()}${suffix}`;
  return money(amount);
}

export function ReportTrend({ periods, series, currency, open }: {
  periods: ChartPeriod[];
  series: ChartSeries[];
  currency: string;
  open: (period: ChartPeriod, metric: ChartMetric) => void;
}) {
  const id = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const plotWidth = usePlotWidth(plotRef);
  const width = Math.max(540, periods.length * 72 + 120, plotWidth), height = 310;
  useEffect(() => {
    // Long series open at the latest results; earlier points remain scrollable.
    if (plotRef.current) plotRef.current.scrollLeft = plotRef.current.scrollWidth;
  }, [width, periods]);
  const left = 90, right = width - 36, top = 22, bottom = 250;
  const domain = chartDomain(periods.flatMap((p) => series.map((s) => p.values[s.key])));
  const y = (value: string) => bottom - domain.fraction(value) * (bottom - top);
  const x = (index: number) => left + (index + .5) * (right - left) / Math.max(1, periods.length);
  return <>
    <div className="graph-legend">
      {series.map((s) => <span key={s.key}><i style={{ background: `var(--graph-${s.color})` }} />{s.label}</span>)}
    </div>
    <div className="graph-scroll" ref={plotRef} role="region" aria-label="Interactive report trend" tabIndex={0}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={id}>
        <title id={id}>Report trend in {currency}. Select a value to inspect its posted entries.</title>
        {[0, .25, .5, .75, 1].map((fraction) => {
          const value = domain.min.plus(domain.max.minus(domain.min).times(fraction));
          const position = y(value.toString());
          return <g key={fraction} className="graph-axis">
            <line x1={left} x2={right} y1={position} y2={position} />
            <text x={left - 10} y={position + 4} textAnchor="end">{tickLabel(value.toString())}</text>
          </g>;
        })}
        <text x={left - 10} y={height - 12} textAnchor="end" className="graph-axis-label">{currency}</text>
        <line x1={left} x2={right} y1={y("0")} y2={y("0")} className="graph-zero" />
        {series.filter((s) => !s.bars).map((s) => <polyline key={s.key}
          points={periods.map((p, i) => `${x(i)},${y(p.values[s.key])}`).join(" ")}
          fill="none" stroke={`var(--graph-${s.color})`} strokeWidth="3" strokeDasharray={s.dash} />)}
        {periods.map((p, i) => <g key={p.from + p.to}>
          <text x={x(i)} y={bottom + 28} textAnchor="middle" className="graph-axis-label">{p.label}</text>
          {series.map((s, index) => {
            const value = p.values[s.key], position = y(value);
            const center = x(i) + (s.bars ? index === 0 ? -20 : 20 : 0);
            const label = `${s.label}, ${p.label}: ${displayMoney(value, currency)}`;
            return <g key={s.key} role="button" tabIndex={0} aria-label={label} className="graph-point"
              onClick={() => open(p, s.key)} onKeyDown={(e) => activate(e, () => open(p, s.key))}>
              <title>{label}</title>
              {s.bars ? <rect x={center - 13} y={Math.min(position, y("0"))} width={26}
                height={Math.max(1, Math.abs(y("0") - position))} fill={`var(--graph-${s.color})`} rx="3" />
                : <circle cx={center} cy={position} r="5" fill={`var(--graph-${s.color})`} />}
              <rect className="graph-hit" x={center - 18} y={Math.max(top, Math.min(bottom - 44, position - 22))} width={36} height={44} rx="4" />
            </g>;
          })}
        </g>)}
      </svg>
    </div>
    <details className="graph-data"><summary>View trend data</summary>
      <div className="table-wrap"><table>
        <caption>Exact report trend values in {currency}</caption>
        <thead><tr><th>Period</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{periods.map((p) => <tr key={p.from + p.to}>
          <th scope="row">{p.label}<small>{p.from ? `${p.from} — ` : "As of "}{p.to}</small></th>
          {series.map((s) => <td key={s.key}><button className="text-action" onClick={() => open(p, s.key)}
            aria-label={`${s.label}, ${p.label}: ${displayMoney(p.values[s.key], currency)}`}>{displayMoney(p.values[s.key], currency)}</button></td>)}
        </tr>)}</tbody>
      </table></div>
    </details>
  </>;
}

export function CategoryBars({ rows, currency, color, open }: {
  rows: ChartRow[]; currency: string; color: "revenue" | "expenses"; open: (row: ChartRow) => void;
}) {
  const domain = chartDomain(rows.map((row) => row.value));
  const zero = domain.fraction("0") * 100;
  return <><div className="graph-categories">
    {!rows.length && <p className="muted">No nonzero posted account balances in this scope.</p>}
    {rows.map((row) => {
      const position = domain.fraction(row.value) * 100;
      return <button className="graph-category" key={row.id} onClick={() => open(row)}
        aria-label={`View ${row.label}: ${displayMoney(row.value, currency)}`}>
        <span className="graph-category-heading"><span>{row.label}</span><strong>{displayMoney(row.value, currency)}</strong></span>
        <span className="graph-track" aria-hidden="true">
          <span className="graph-track-zero" style={{ left: `${zero}%` }} />
          <span className={`graph-bar ${d(row.value).lt(0) ? "graph-bar-negative" : ""}`}
            style={{ left: `${Math.min(zero, position)}%`, width: `${Math.abs(position - zero)}%`,
              background: d(row.value).lt(0) ? "var(--negative)" : `var(--graph-${color})` }} />
        </span>
      </button>;
    })}
  </div>
    {!!rows.length && <details className="graph-data"><summary>View category data</summary>
      <div className="table-wrap"><table><caption>Category amounts in {currency}</caption>
        <thead><tr><th>Account</th><th>Amount</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><th scope="row">{row.label}</th>
          <td><button className="text-action" onClick={() => open(row)}>{displayMoney(row.value, currency)}</button></td></tr>)}</tbody>
      </table></div>
    </details>}
  </>;
}

export function BalanceComposition({ assets, funding, currency, open }: {
  assets: ChartRow[]; funding: ChartRow[]; currency: string; open: (row: ChartRow) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotWidth = usePlotWidth(plotRef);
  const lanes = [{ name: "Assets", rows: assets }, { name: "Liabilities + equity", rows: funding }];
  const extents = lanes.flatMap(({ rows }) => [
    rows.reduce((v, row) => d(row.value).gt(0) ? v.plus(row.value) : v, d(0)).toString(),
    rows.reduce((v, row) => d(row.value).lt(0) ? v.plus(row.value) : v, d(0)).toString(),
  ]);
  const domain = chartDomain(extents), left = 12, width = Math.max(260, plotWidth - 24);
  const x = (value: string) => left + domain.fraction(value) * width;
  return <>
    <div className="graph-legend"><span><i style={{ background: "var(--graph-assets)" }} />Assets</span>
      <span><i style={{ background: "var(--graph-liabilities)" }} />Liabilities</span>
      <span><i style={{ background: "var(--graph-equity)" }} />Equity, including accumulated results</span></div>
    <div className="graph-scroll" ref={plotRef} role="region" aria-label="Balance sheet composition" tabIndex={0}>
      <svg width={width + 24} height="240" viewBox={`0 0 ${width + 24} 240`} role="group" aria-label={`Assets compared with liabilities and equity in ${currency}. Negative balances extend left of zero.`}>
        <line x1={x("0")} x2={x("0")} y1="15" y2="210" className="graph-zero" />
        {lanes.map((lane, i) => {
          let positive = d(0), negative = d(0);
          const total = money(lane.rows.reduce((v, row) => v.plus(row.value), d(0)));
          return <g key={lane.name}>
            <text x={left} y={i * 100 + 23} className="graph-axis-label">{lane.name}</text>
            <text x={left + width} y={i * 100 + 23} textAnchor="end" className="graph-axis-label">{displayMoney(total, currency)}</text>
            {lane.rows.map((row) => {
              const amount = d(row.value), start = amount.lt(0) ? negative : positive;
              const end = start.plus(amount);
              if (amount.lt(0)) negative = end; else positive = end;
              const label = `${row.label}: ${displayMoney(row.value, currency)}`;
              const color = row.group === "asset" ? "assets" : row.group === "liability" ? "liabilities" : "equity";
              return <g key={row.id} role="button" tabIndex={0} aria-label={label} className="graph-point"
                onClick={() => open(row)} onKeyDown={(e) => activate(e, () => open(row))}>
                <title>{label}</title>
                <rect x={Math.min(x(start.toString()), x(end.toString()))} y={i * 100 + 40}
                  width={Math.max(1, Math.abs(x(end.toString()) - x(start.toString())))} height="42" fill={`var(--graph-${color})`} />
              </g>;
            })}
          </g>;
        })}
        <text x={x("0")} y="230" textAnchor="middle" className="graph-axis-label">0 {currency}</text>
      </svg>
    </div>
    <details className="graph-data"><summary>View composition data</summary>
      <div className="table-wrap"><table><caption>Balance sheet components in {currency}</caption>
        <thead><tr><th>Component</th><th>Account</th><th>Amount</th></tr></thead>
        <tbody>{lanes.flatMap((lane) => lane.rows.map((row) => <tr key={row.id}>
          <td>{lane.name}</td><td>{row.label}</td><td><button className="text-action" onClick={() => open(row)}>{displayMoney(row.value, currency)}</button></td>
        </tr>))}</tbody>
      </table></div>
    </details>
  </>;
}
