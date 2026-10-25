"use client";
import { useState, type FormEvent } from "react";
import { actualOpening, replayCandidates, scenarioAccounts, validateScenario } from "@/lib/scenarios";
import { scenarioInput, signedBalance, type OpeningBalance, type ScenarioConfig } from "@/lib/scenario-contracts";
import { d, displayMoney, money } from "@/lib/money";
import type { Snapshot } from "@/lib/types";
import { Action, Field, Notice } from "./ui";
export function ScenarioForm({ source, from, to, save }: {
  source: Snapshot; from: string; to: string; save: (config: ScenarioConfig) => Promise<void>;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(""), [start, setStart] = useState(from), [end, setEnd] = useState(to);
  const [mode, setMode] = useState<"actual" | "custom">("actual");
  const [balances, setBalances] = useState<OpeningBalance[]>(() => actualOpening(source, from));
  const [selected, setSelected] = useState<Set<string>>(() => {
    const candidates = replayCandidates(source, from, to);
    return new Set(candidates.length > 2000 ? [] : candidates.map((t) => t.id));
  });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const accounts = scenarioAccounts(source), code = source.workspace.functional_currency_code;
  const candidates = replayCandidates(source, start, end);
  const rows = mode === "actual" ? actualOpening(source, start) : balances;
  const trial = rows.every((row) => signedBalance.safeParse(row.book_balance || "0").success)
    ? rows.reduce((v, row) => v.plus(d(row.book_balance || "0").times(accounts.find((a) => a.id === row.account_id)!.type === "asset" ? 1 : -1)), d(0)) : null;
  function period(nextStart: string, nextEnd: string) {
    setStart(nextStart); setEnd(nextEnd);
    const next = replayCandidates(source, nextStart, nextEnd);
    setSelected(new Set(next.length > 2000 ? [] : next.map((t) => t.id)));
  }
  function balance(accountId: string, field: "book_balance" | "native_balance", value: string) {
    // Incomplete decimal input is allowed while typing; invalid values are rejected on save.
    if (value && !/^-?(?:\d*)(?:\.\d*)?$/.test(value)) return;
    const account = accounts.find((a) => a.id === accountId)!;
    setBalances((current) => current.map((row) => row.account_id === accountId ? { ...row, [field]: value,
      ...(field === "book_balance" && account.currency_code === code ? { native_balance: value } : {}) } : row));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const parsed = scenarioInput.safeParse({ id, name, start_date: start, end_date: end, opening_mode: mode,
        opening_balances: mode === "actual" ? [] : balances.map((row) => ({ ...row, book_balance: row.book_balance || "0", native_balance: row.native_balance === "" ? "0" : row.native_balance })),
        selected_transaction_ids: [...selected] });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      validateScenario(source, parsed.data);
      await save(parsed.data);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="scenario-form">
    <Notice message={error} error />
    <p className="muted">Create an isolated experiment. On save, source records are captured together and frozen. Replay retains recorded journal amounts and historical FX values; it does not forecast or recalculate operating decisions.</p>
    <Field label="Scenario name"><input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <div className="form-grid">
      <Field label="Scenario start date"><input required type="date" value={start} onChange={(e) => period(e.target.value, end)} /></Field>
      <Field label="Scenario end date"><input required type="date" value={end} onChange={(e) => period(start, e.target.value)} /></Field>
    </div>
    <Field label="Opening position"><select value={mode} onChange={(e) => {
      const next = e.target.value as "actual" | "custom"; setMode(next);
      if (next === "custom") setBalances(actualOpening(source, start));
    }}><option value="actual">Copy actual balances before start</option><option value="custom">Custom opening balances</option></select></Field>
    <h3>Opening balances</h3>
    <p className="muted">Positive assets are debits; positive liabilities/equity are credits. Negative balances are supported. Earlier revenue less expenses is included once in opening accumulated results. Scenario P&L starts at zero.</p>
    <div className="scenario-openings">{accounts.map((account) => {
      const row = rows.find((r) => r.account_id === account.id)!;
      return <div className="scenario-opening" key={account.id}>
        <strong>{account.name}<small>{account.type}{!account.is_active && account.id !== "accumulated" ? " · inactive" : ""}</small></strong>
        {mode === "actual" ? <span>{displayMoney(row.book_balance, code)}{account.currency_code && account.currency_code !== code && <small>{displayMoney(row.native_balance!, account.currency_code)}</small>}</span> : <>
          <Field label={`${account.name} opening (${code})`}><input inputMode="decimal" value={row.book_balance} onChange={(e) => balance(account.id, "book_balance", e.target.value)} /></Field>
          {account.currency_code && account.currency_code !== code && <Field label={`${account.name} native (${account.currency_code})`}><input inputMode="decimal" value={row.native_balance!} onChange={(e) => balance(account.id, "native_balance", e.target.value)} /></Field>}
        </>}
      </div>;
    })}</div>
    <p className="muted">Opening difference (assets − liabilities − equity): <strong>{trial ? `${money(trial)} ${code}` : "Complete the balance amounts"}</strong></p>
    <div className="section-head"><h3>Replay posted entries</h3><span>{selected.size} selected</span></div>
    <p className="muted">Choose complete entries dated within the scenario period. Drafts are excluded. Changing dates resets the selection. Up to 2,000 entries can be replayed.</p>
    <div className="scenario-actions">
      <button type="button" className="text-action" disabled={candidates.length > 2000} onClick={() => setSelected(new Set(candidates.map((t) => t.id)))}>Select all</button>
      <button type="button" className="text-action" onClick={() => setSelected(new Set())}>Clear selection</button>
    </div>
    {!candidates.length && <p className="muted">No posted entries in this period. You can save an opening-only scenario.</p>}
    <div className="scenario-replay">{candidates.map((t) => <label className="scenario-choice" key={t.id}>
      <input type="checkbox" checked={selected.has(t.id)} disabled={!selected.has(t.id) && selected.size >= 2000}
        onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(t.id)) next.delete(t.id); else next.add(t.id); return next; })} />
      <span><strong>{t.description}</strong><small>{t.accounting_date} · {t.kind.replaceAll("_", " ")}</small></span>
    </label>)}</div>
    <Action type="submit" isPending={busy} isDisabled={busy}>Save scenario</Action>
  </form>;
}
