"use client";
import { d, displayMoney, money } from "@/lib/money";
import { reports } from "@/lib/reports";
import type { Snapshot } from "@/lib/types";
import { AccumulatedResult } from "./accumulated-result";
export function ReportView({
  snapshot: s,
  from,
  to,
  drill,
  openAccumulated,
}: {
  snapshot: Snapshot;
  from: string;
  to: string;
  drill: (id: string, period: boolean) => void;
  openAccumulated: () => void;
}) {
  const r = reports(s, from, to),
    code = s.workspace.functional_currency_code;
  function group(title: string, type: string, period: boolean, sign = 1) {
    const rows = (period ? r.period : r.all).filter(
      (x) => x.account.type === type && !d(x.balance).isZero(),
    );
    return (
      <>
        <h3 className="spacer">{title}</h3>
        {rows.length ? (
          rows.map((x) => (
            <div className="report-line" key={x.account.id}>
              <button onClick={() => drill(x.account.id, period)}>
                {x.account.name} ↗
              </button>
              <span>{displayMoney(money(d(x.balance).times(sign)), code)}</span>
            </div>
          ))
        ) : (
          <p className="muted">No recorded amounts</p>
        )}
      </>
    );
  }
  return (
    <div className="two-col">
      <section className="panel">
        <div className="eyebrow">MONEY EARNED & SPENT</div>
        <h2>
          {s.workspace.kind === "personal"
            ? "Income & spending"
            : "Profit & loss"}
        </h2>
        <p className="muted">
          {from} — {to} · {code}
        </p>
        {group("Income", "revenue", true, -1)}
        <div className="report-total">
          <span>Total income</span>
          <span>{displayMoney(r.revenue, code)}</span>
        </div>
        {group("Expenses", "expense", true)}
        <div className="report-total">
          <span>Total expenses</span>
          <span>{displayMoney(r.expenses, code)}</span>
        </div>
        <div className="report-total positive">
          <span>
            {s.workspace.kind === "personal"
              ? "Left over"
              : "Net profit / loss"}
          </span>
          <span>{displayMoney(r.profit, code)}</span>
        </div>
      </section>
      <section className="panel">
        <div className="eyebrow">WHAT YOU HAVE & OWE</div>
        <h2>Balance sheet</h2>
        <p className="muted">
          As of {to} · {code}
        </p>
        {group("Assets", "asset", false)}
        <div className="report-total">
          <span>Total assets</span>
          <span>{displayMoney(r.assets, code)}</span>
        </div>
        {group("Liabilities", "liability", false, -1)}
        <div className="report-total">
          <span>Total liabilities</span>
          <span>{displayMoney(r.liabilities, code)}</span>
        </div>
        {group("Owner equity", "equity", false, -1)}
        <AccumulatedResult amount={r.unclosed} currency={code} open={openAccumulated} />
        <div className="report-total">
          <span>Total equity</span>
          <span>{displayMoney(r.equity, code)}</span>
        </div>
        <div className="balance-check">
          {d(r.assets).eq(d(r.liabilities).plus(r.equity))
            ? "✓ Assets = liabilities + equity"
            : "Balance needs attention"}
        </div>
        <p className="muted spacer">
          <small>
            Recorded historical values. Accumulated profit or loss is included
            in equity once. Drafts are excluded.
          </small>
        </p>
      </section>
    </div>
  );
}
