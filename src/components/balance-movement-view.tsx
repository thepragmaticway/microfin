"use client";
import { balanceMovement, movementDrill } from "@/lib/balance-movement";
import { d, displayMoney } from "@/lib/money";
import type { ReportDrill } from "@/lib/report-detail";
import type { Snapshot } from "@/lib/types";
import { Notice } from "./ui";
export function BalanceMovementView({ snapshot, from, to, drill }: {
  snapshot: Snapshot; from: string; to: string; drill: (selection: ReportDrill) => void;
}) {
  if (!from || !to || from > to) return <Notice error message="Choose a start date on or before the end date." />;
  const data = balanceMovement(snapshot, from, to), code = snapshot.workspace.functional_currency_code;
  function cells(row: (typeof data.rows)[number] | (typeof data.totals)[number]) {
    return (["opening", "movement", "closing"] as const).map((column) => <td key={column} className="align-right">
      <button className="text-action" disabled={column === "opening" && from === "0001-01-01"}
        aria-label={`${row.label}, ${column}: ${displayMoney(row[column], code)}`}
        onClick={() => drill(movementDrill(from, to, column, "accountId" in row ? row.accountId : undefined, row.group))}>
        {displayMoney(row[column], code)}
      </button>
    </td>);
  }
  return <section className="panel" aria-label="Balance sheet movement">
    <div className="eyebrow">OPENING → MOVEMENT → CLOSING</div>
    <h2>Balance sheet movement</h2>
    <p className="muted">{from} — {to} · {code} · Opening is immediately before the start date. Closing includes the end date.</p>
    <p className="muted">Opening + movement = closing. Assets are debit-positive; liabilities and equity are credit-positive. Posted historical values include reversals; drafts are excluded.</p>
    <div className="table-wrap" role="region" aria-label="Movement amounts" tabIndex={0}>
      <table className="ledger-table"><caption>Balance sheet accounts and total movements in {code}</caption>
        <thead><tr><th>Account</th><th className="align-right">Opening</th><th className="align-right">Movement</th><th className="align-right">Closing</th></tr></thead>
        <tbody>{data.rows.filter((row) => [row.opening, row.movement, row.closing].some((value) => !d(value).isZero())).map((row) =>
          <tr key={row.id}><th scope="row">{row.label}<small>{row.group}</small></th>{cells(row)}</tr>)}</tbody>
        <tfoot>{data.totals.map((row) => <tr key={row.id}><th scope="row">{row.label}</th>{cells(row)}</tr>)}</tfoot>
      </table>
    </div>
    <p className="muted">Accumulated results are part of total equity. Their movement includes any closing journals and may differ from operating profit for this period. Select an amount to inspect its journal lines.</p>
  </section>;
}
