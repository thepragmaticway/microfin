"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { displayMoney } from "@/lib/money";
import { reports } from "@/lib/reports";
import { actualOpening, scenarioAccounts, scenarioSnapshot, type SavedScenario, type ScenarioSummary } from "@/lib/scenarios";
import type { ScenarioConfig } from "@/lib/scenario-contracts";
import type { ReportDrill } from "@/lib/report-detail";
import type { Snapshot, Transaction } from "@/lib/types";
import { BalanceMovementView } from "./balance-movement-view";
import { ActivityReportView } from "./activity-report-view";
import { ScenarioForm } from "./scenario-form";
import { Action, Empty, Field, Notice } from "./ui";
import { Dialog } from "./dialog";

export function ScenariosView({ source, from, to }: { source: Snapshot; from: string; to: string }) {
  const [list, setList] = useState<ScenarioSummary[]>([]), [selected, setSelected] = useState("");
  const [saved, setSaved] = useState<SavedScenario | null>(null), [create, setCreate] = useState(false);
  const [detail, setDetail] = useState<ReportDrill | null>(null), [entry, setEntry] = useState<Transaction | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [deleting, setDeleting] = useState(false);
  const [revision, setRevision] = useState(0);
  const path = `/api/workspaces/${source.workspace.id}/scenarios`;
  useEffect(() => {
    let active = true;
    api<ScenarioSummary[]>(path).then((rows) => { if (active) { setList(rows); setError(""); setLoading(false); } })
      .catch((error) => { if (active) { setError((error as Error).message); setLoading(false); } });
    return () => { active = false; };
  }, [path, revision]);
  useEffect(() => {
    let active = true;
    if (selected) api<SavedScenario>(`${path}/${selected}`).then((row) => { if (active) { setSaved(row); setError(""); } })
      .catch((error) => { if (active) setError((error as Error).message); });
    return () => { active = false; };
  }, [path, selected, revision]);
  function choose(id: string) { setSelected(id); setSaved(null); setDetail(null); setEntry(null); setError(""); }
  async function save(config: ScenarioConfig) {
    const id = await api<string>(path, config);
    setCreate(false); choose(id); setRevision((v) => v + 1);
  }
  async function remove() {
    setDeleting(true); setError("");
    try { await api(`${path}/${selected}`, { action: "delete" }); choose(""); setRevision((v) => v + 1); }
    catch (error) { setError((error as Error).message); }
    finally { setDeleting(false); }
  }
  const snapshot = saved ? scenarioSnapshot(saved) : null;
  const code = source.workspace.functional_currency_code;
  const totals = saved && snapshot ? reports(snapshot, saved.start_date, saved.end_date) : null;
  return <div className="scenario-view">
    <section className="panel" aria-label="Saved scenarios">
      <div className="section-head"><div><div className="eyebrow">EXPLORE AN ALTERNATIVE START</div><h2>Saved scenarios</h2></div>
        <Action onPress={() => setCreate(true)}>New scenario</Action></div>
      <p className="muted">Saved experiments have their own opening position and frozen historical entries. Actual bookkeeping stays unchanged.</p>
      <Notice error message={error} />
      {error && <button className="text-action" onClick={() => setRevision((v) => v + 1)}>Retry scenarios</button>}
      {loading ? <p role="status">Loading scenarios…</p> : list.length ? <Field label="Choose scenario">
        <select value={selected} onChange={(e) => choose(e.target.value)}><option value="">Select a saved scenario</option>
          {list.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.start_date} — {row.end_date}</option>)}
        </select>
      </Field> : <Empty title="No saved scenarios">Copy your actual opening position or enter custom balances, then choose entries to replay.</Empty>}
      {selected && !saved && !error && <p role="status">Loading frozen scenario…</p>}
    </section>
    {saved && snapshot && totals && <>
      <section className="panel" aria-label="Scenario results">
        <div className="section-head"><div><div className="eyebrow">SCENARIO · {saved.opening_mode.toUpperCase()} OPENING</div><h2>{saved.name}</h2></div>
          <Action variant="tertiary" isPending={deleting} isDisabled={deleting} onPress={remove}>Delete scenario</Action></div>
        <p className="muted">{saved.start_date} — {saved.end_date} · Frozen {saved.frozen_at} · {saved.selected_transaction_ids.length} replayed entries</p>
        <p className="muted">Historical replay uses the recorded journal values. It does not recalculate interest, FX carrying values, or whether the alternative business could make these payments.</p>
        <div className="stats">{([["revenue", "Scenario revenue"], ["expenses", "Scenario expenses"], ["profit", "Scenario profit / loss"]] as const).map(([key, label]) =>
          <button className="stat graph-stat" key={key} onClick={() => setDetail({ mode: "profit_loss", from: saved.start_date, to: saved.end_date,
            group: key === "revenue" ? "revenue" : key === "expenses" ? "expense" : "all" })}>
            <span className="stat-label">{label}</span><span className="stat-value">{displayMoney(totals[key], code)}</span><span className="stat-foot">View frozen supporting entries ↗</span>
          </button>)}</div>
        <details className="spacer"><summary>View frozen opening balances</summary><div className="table-wrap"><table>
          <caption>Opening balances in {code}; native amounts retained separately</caption>
          <thead><tr><th>Account</th><th>Home balance</th><th>Native balance</th></tr></thead>
          <tbody>{(saved.opening_mode === "actual" ? actualOpening(saved.source_snapshot, saved.start_date) : saved.opening_balances).map((row) => {
            const account = scenarioAccounts(saved.source_snapshot).find((a) => a.id === row.account_id)!;
            return <tr key={row.account_id}><th scope="row">{account.name}</th><td>{displayMoney(row.book_balance, code)}</td><td>{account.currency_code ? displayMoney(row.native_balance!, account.currency_code) : "—"}</td></tr>;
          })}</tbody>
        </table></div></details>
      </section>
      {detail ? <section className="panel" aria-label="Frozen scenario detail">
        <button className="text-action" onClick={() => setDetail(null)}>← Back to scenario</button>
        <p className="muted">Frozen scenario detail · {saved.name}. All values below belong to this experiment.</p>
        <ActivityReportView snapshot={snapshot} mode={detail.mode} from={detail.from} to={detail.to} group={detail.group}
          search="" accountId={detail.accountId ?? ""} openEntry={setEntry}
          openAccumulated={() => setDetail({ mode: "profit_loss", from: "", to: detail.to })} />
      </section> : <BalanceMovementView snapshot={snapshot} from={saved.start_date} to={saved.end_date} drill={setDetail} />}
      <section className="panel" aria-label="Frozen replay entries"><h2>Frozen replay entries</h2>
        {!saved.selected_transaction_ids.length && <p className="muted">Opening-only scenario. No transactions were replayed.</p>}
        <div className="rows">{snapshot.transactions.filter((t) => t.id !== "scenario-opening").map((t) => <button className="scenario-entry" key={t.id} onClick={() => setEntry(t)}>
          <span>{t.description}<small>{t.accounting_date} · {t.kind.replaceAll("_", " ")}</small></span><span>Inspect ↗</span>
        </button>)}</div>
      </section>
    </>}
    {create && <Dialog title="Create financial scenario" presentation="sheet" close={() => setCreate(false)}>
      <ScenarioForm source={source} from={from} to={to} save={save} />
    </Dialog>}
    {entry && snapshot && <Dialog title="Frozen scenario entry" presentation="sheet" close={() => setEntry(null)}>
      <p className="muted">Read-only copy from {saved?.name}.</p><h3>{entry.description}</h3><p>{entry.accounting_date}</p>
      <div className="table-wrap"><table><caption>Frozen journal lines in {code}</caption><thead><tr><th>Account</th><th>Side</th><th>Home amount</th><th>Original amount</th></tr></thead>
        <tbody>{snapshot.lines.filter((l) => l.transaction_id === entry.id).map((line) => <tr key={line.id}>
          <th scope="row">{snapshot.accounts.find((a) => a.id === line.account_id)?.name}</th><td>{line.side}</td>
          <td>{displayMoney(line.book_amount, code)}</td><td>{displayMoney(line.amount, line.currency_code)}</td>
        </tr>)}</tbody></table></div>
    </Dialog>}
  </div>;
}
