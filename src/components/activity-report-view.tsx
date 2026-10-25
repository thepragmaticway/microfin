"use client";
import { d, displayMoney } from "@/lib/money";
import { reportDetail, type ReportGroup, type ReportMode } from "@/lib/report-detail";
import type { Snapshot, Transaction } from "@/lib/types";
import { Empty, Notice } from "./ui";
import { AccumulatedResult } from "./accumulated-result";

export function ActivityReportView({
  snapshot,
  mode,
  from,
  to,
  search,
  accountId,
  group = "all",
  openEntry,
  openAccumulated,
}: {
  snapshot: Snapshot;
  mode: ReportMode;
  from: string;
  to: string;
  search: string;
  accountId: string;
  group?: ReportGroup;
  openEntry: (transaction: Transaction) => void;
  openAccumulated: () => void;
}) {
  const profitLoss = mode === "profit_loss";
  if (profitLoss && from && to && from > to)
    return <Notice error message="From date must be on or before through date." />;
  const detail = reportDetail(snapshot, mode, { from, to, search, accountId, group });
  const code = snapshot.workspace.functional_currency_code;
  const metrics = profitLoss
    ? [["revenue", "Total income"], ["expenses", "Total expenses"], ["profit", "Net profit / loss"]] as const
    : [["assets", "Total assets"], ["liabilities", "Total liabilities"], ["equity", "Total equity"]] as const;
  function totals(result: typeof detail.full) {
    return (
      <div className="stats">
        {metrics.map(([key, label]) => (
          <div className="stat" key={key}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{displayMoney(result[key], code)}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="activity-report">
      <section aria-label="Complete report totals">
        <div className="eyebrow">COMPLETE REPORT TOTALS</div>
        <h2>{profitLoss ? "Profit & loss" : "Balance sheet"}</h2>
        <p className="muted">
          {profitLoss ? `${from || "All dates"} — ${to || "All dates"}` : `As of ${to || "all dates"}`}
          {" · "}{code} · Posted historical values, including reversals. Drafts excluded.
        </p>
        {totals(detail.full)}
        {!profitLoss && <>
          <div className="report-line">
            <span>Owner equity</span>
            <span>{displayMoney(detail.full.contributedEquity, code)}</span>
          </div>
          <AccumulatedResult amount={detail.full.unclosed} currency={code} open={openAccumulated} />
          <div className="balance-check">
            {d(detail.full.assets).eq(d(detail.full.liabilities).plus(detail.full.equity))
              ? "✓ Assets = liabilities + equity"
              : "Balance needs attention"}
          </div>
        </>}
      </section>
      <section aria-label="Matching subtotal" className="spacer">
        <h2>Matching subtotal</h2>
        <p className="muted">
          Current description and account filters match {detail.lineCount} journal {detail.lineCount === 1 ? "line" : "lines"}
          {" across "}{detail.transactionCount} {detail.transactionCount === 1 ? "entry" : "entries"}.
          {" "}Complete report totals above stay unchanged by these filters.
        </p>
        {totals(detail.matching)}
      </section>
      <section aria-label="Matching account details">
        <h2>Matching accounts & journal lines</h2>
        {!detail.breakdown.length ? (
          <Empty title="No posted journal lines match">
            Change the description, account, or report dates to see supporting entries.
          </Empty>
        ) : detail.breakdown.map((row) => (
          <details className="report-account" key={`${mode}-${row.account.id}`}>
            <summary>
              <span>
                <strong>{row.account.name}</strong>
                <small>
                  {!profitLoss && ["revenue", "expense"].includes(row.account.type)
                    ? `Accumulated result · ${row.account.type}`
                    : row.account.type}
                  {!row.account.is_active && " · inactive"}
                </small>
              </span>
              <span className="row-amount">{displayMoney(row.net, code)}</span>
            </summary>
            <div className="report-account-body">
              <div className="report-line">
                <span>Complete account total</span>
                <strong>{displayMoney(row.fullNet, code)}</strong>
              </div>
              <p className="muted">
                Net = {row.sign === 1 ? "debits − credits" : "credits − debits"}.
                {!profitLoss && ["revenue", "expense"].includes(row.account.type)
                  && " These lines contribute to accumulated results in equity."}
                {" "}Foreign amounts retain their original currency; totals use {code}.
              </p>
              <div className="table-wrap" role="region" aria-label={`${row.account.name} journal lines`} tabIndex={0}>
                <table className="ledger-table">
                  <caption>{row.account.name} · Matching posted journal lines · {code}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Entry</th>
                      <th scope="col" className="align-right">Debit ({code})</th>
                      <th scope="col" className="align-right">Credit ({code})</th>
                      <th scope="col" className="align-right">Net ({code})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.entries.map(({ line, transaction, net }) => (
                      <tr key={line.id}>
                        <td className="ledger-date">{transaction.accounting_date}</td>
                        <td>
                          <button className="text-action" onClick={() => openEntry(transaction)}>{transaction.description}</button>
                          <small>{transaction.kind.replaceAll("_", " ")}</small>
                        </td>
                        {(["debit", "credit"] as const).map((side) => (
                          <td className="align-right" key={side}>
                            {line.side === side ? <>
                              {displayMoney(line.book_amount, code)}
                              {line.currency_code !== code && <small>{displayMoney(line.amount, line.currency_code)}</small>}
                            </> : "—"}
                          </td>
                        ))}
                        <td className="align-right">{displayMoney(net, code)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={2}>Matching subtotal</th>
                      <td className="align-right">{displayMoney(row.debit, code)}</td>
                      <td className="align-right">{displayMoney(row.credit, code)}</td>
                      <td className="align-right">{displayMoney(row.net, code)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
