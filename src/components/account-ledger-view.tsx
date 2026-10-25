"use client";
import { useState } from "react";
import { accountLedger } from "@/lib/account-ledger";
import { d, displayMoney, money } from "@/lib/money";
import { workspaceToday } from "@/lib/reports";
import type { Account, Snapshot, Transaction } from "@/lib/types";
import { Empty, Field, Notice } from "./ui";

function balanceLabel(value: string, currency: string) {
  const amount = d(value);
  return `${displayMoney(money(amount.abs()), currency)}${amount.isZero() ? "" : amount.gt(0) ? " Dr" : " Cr"}`;
}

export function AccountLedgerView({
  snapshot: s,
  account,
  select,
  back,
  openEntry,
}: {
  snapshot: Snapshot;
  account: Account;
  select: (id: string) => void;
  back: () => void;
  openEntry: (transaction: Transaction) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(() => workspaceToday(s.workspace.timezone));
  const invalidRange = !!(from && to && from > to);
  const ledger = invalidRange ? null : accountLedger(s, account.id, from, to);
  const code = s.workspace.functional_currency_code;
  const native = ledger?.native?.currency !== code ? ledger?.native : null;
  return (
    <section aria-label="Account ledger">
      <div className="section-head">
        <button className="text-action" onClick={back}>← All accounts</button>
        <span className="muted">
          {account.type} · {account.role.replaceAll("_", " ")}
          {!account.is_active && " · inactive"}
        </span>
      </div>
      <div className="panel">
        <div className="filters">
          <Field label="Ledger account">
            <select value={account.id} onChange={(e) => select(e.target.value)}>
              {s.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{!a.is_active ? " (inactive)" : ""}</option>
              ))}
            </select>
          </Field>
          <Field label="From date">
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Through date">
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <p className="muted">
          Posted entries only, including reversals. Dr = debit balance; Cr = credit balance.
          {" "}Home values in {code} use recorded historical rates.
        </p>
        <Notice error message={invalidRange ? "From date must be on or before through date." : ""} />
        {ledger && <>
          <div className="ledger-summary">
            {([
              ["opening", "Opening balance", true],
              ["debit", "Total debits", false],
              ["credit", "Total credits", false],
              ["closing", "Closing balance", true],
            ] as const).map(([key, label, isBalance]) => (
              <div className="stat" key={key}>
                <div className="stat-label">{label}</div>
                <div className="stat-value">
                  {isBalance ? balanceLabel(ledger[key], code) : displayMoney(ledger[key], code)}
                </div>
                {native && <div className="stat-foot">
                  {isBalance ? balanceLabel(native[key], native.currency) : displayMoney(native[key], native.currency)}
                </div>}
              </div>
            ))}
          </div>
          <div className="table-wrap" role="region" aria-label="Ledger entries" tabIndex={0}>
            <table className="ledger-table">
              <caption>
                {account.name} · {from || "All dates"} — {to || "All dates"} · {code}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Entry</th>
                  <th scope="col" className="align-right">Debit ({code})</th>
                  <th scope="col" className="align-right">Credit ({code})</th>
                  <th scope="col" className="align-right">Balance ({code})</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" colSpan={4}>Opening balance{from ? ` before ${from}` : ""}</th>
                  <td className="align-right">
                    {balanceLabel(ledger.opening, code)}
                    {native && <small>{balanceLabel(native.opening, native.currency)}</small>}
                  </td>
                </tr>
                {ledger.rows.map(({ line, transaction, balance, nativeBalance }) => (
                  <tr key={line.id}>
                    <td className="ledger-date">{transaction.accounting_date}</td>
                    <td>
                      <button className="text-action" onClick={() => openEntry(transaction)}>{transaction.description}</button>
                      <small>{transaction.kind.replaceAll("_", " ")}</small>
                    </td>
                    {(["debit", "credit"] as const).map((side) => (
                      <td key={side} className="align-right">
                        {line.side === side ? <>
                          {displayMoney(line.book_amount, code)}
                          {line.currency_code !== code && <small>{displayMoney(line.amount, line.currency_code)}</small>}
                        </> : "—"}
                      </td>
                    ))}
                    <td className="align-right">
                      {balanceLabel(balance, code)}
                      {native && nativeBalance !== null && <small>{balanceLabel(nativeBalance, native.currency)}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>Period totals / closing balance</th>
                  <td className="align-right">{displayMoney(ledger.debit, code)}</td>
                  <td className="align-right">{displayMoney(ledger.credit, code)}</td>
                  <td className="align-right">{balanceLabel(ledger.closing, code)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!ledger.rows.length && <Empty title="No posted entries in this period">
            Change the dates to see entries. Any earlier balance is carried forward above.
          </Empty>}
        </>}
      </div>
    </section>
  );
}
