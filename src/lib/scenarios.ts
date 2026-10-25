import { d } from "./money";
import { previousDate } from "./balance-movement";
import { postedLines, signed } from "./reports";
import type { OpeningBalance, ScenarioConfig } from "./scenario-contracts";
import type { Account, JournalLine, Snapshot } from "./types";
export interface SavedScenario extends ScenarioConfig {
  workspace_id: string;
  frozen_at: string;
  source_snapshot: Snapshot;
}
export type ScenarioSummary = Pick<SavedScenario, "id" | "workspace_id" | "name" | "start_date" | "end_date" | "opening_mode" | "frozen_at">;
export function scenarioAccounts(source: Snapshot): Account[] {
  return [...source.accounts.filter((a) => !["revenue", "expense"].includes(a.type)), {
    id: "accumulated", workspace_id: source.workspace.id, name: "Opening accumulated results", type: "equity", role: "general", currency_code: null, is_active: false,
  }];
}
export function actualOpening(source: Snapshot, start: string): OpeningBalance[] {
  const before = { ...source, transactions: source.transactions.filter((t) => t.accounting_date < start) };
  const lines = postedLines(before);
  return scenarioAccounts(source).map((account) => {
    const selected = account.id === "accumulated" ? lines.filter((l) => source.accounts.some((a) => a.id === l.account_id && ["revenue", "expense"].includes(a.type)))
      : lines.filter((l) => l.account_id === account.id);
    const sign = account.type === "asset" ? 1 : -1;
    return { account_id: account.id, book_balance: selected.reduce((v, l) => v.plus(signed(l).times(sign)), d(0)).toFixed(8),
      native_balance: account.currency_code ? selected.reduce((v, l) => v.plus(d(l.amount).times(l.side === "debit" ? sign : -sign)), d(0)).toFixed(8) : null };
  });
}
export function replayCandidates(source: Snapshot, from: string, to: string) {
  return source.transactions.filter((t) => t.posted_at && t.accounting_date >= from && t.accounting_date <= to)
    .sort((a, b) => a.accounting_date.localeCompare(b.accounting_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
export function validateScenario(source: Snapshot, config: ScenarioConfig) {
  const candidates = new Set(replayCandidates(source, config.start_date, config.end_date).map((t) => t.id));
  if (config.selected_transaction_ids.some((id) => !candidates.has(id))) throw new Error("Replay entries must be posted in the selected workspace and period");
  const balances = config.opening_mode === "actual" ? actualOpening(source, config.start_date) : config.opening_balances;
  const accounts = new Map(scenarioAccounts(source).map((a) => [a.id, a]));
  let trial = d(0);
  for (const row of balances) {
    const account = accounts.get(row.account_id);
    if (!account) throw new Error("Opening balances must use this workspace's asset, liability or equity accounts");
    if (!!account.currency_code !== (row.native_balance !== null)) throw new Error("Fixed-currency accounts require a native opening balance");
    if (account.currency_code === source.workspace.functional_currency_code && !d(row.native_balance!).eq(row.book_balance))
      throw new Error("Home-currency native and book balances must match");
    trial = trial.plus(d(row.book_balance).times(account.type === "asset" ? 1 : -1));
  }
  if (!trial.isZero()) throw new Error("Opening assets must equal liabilities plus equity, including accumulated results");
  return balances;
}
/** Replay recorded journal amounts; opening values never become real ledger entries. */
export function scenarioSnapshot(saved: Pick<SavedScenario, keyof ScenarioConfig | "source_snapshot">): Snapshot {
  const source = saved.source_snapshot, opening = validateScenario(source, saved);
  const accounts = [...source.accounts, scenarioAccounts(source).find((a) => a.id === "accumulated")!];
  const selected = new Set(saved.selected_transaction_ids), id = "scenario-opening";
  const lines: JournalLine[] = opening.flatMap((row) => {
    const account = accounts.find((a) => a.id === row.account_id)!;
    const book = d(row.book_balance).times(account.type === "asset" ? 1 : -1);
    const native = d(row.native_balance ?? row.book_balance).times(account.type === "asset" ? 1 : -1);
    if (book.isZero() && native.isZero()) return [];
    // Separate native-only residuals or differing signs retain both frozen quantities.
    const makeLine = (side: "debit" | "credit", amount: string, value: string, suffix: string): JournalLine => ({
      id: `${id}-${account.id}-${suffix}`, workspace_id: source.workspace.id, transaction_id: id, account_id: account.id,
      side, amount, currency_code: account.currency_code ?? source.workspace.functional_currency_code,
      book_amount: value, exchange_rate: "1", rate_source: null,
    });
    if (!native.isZero() && !book.isZero() && native.isNegative() === book.isNegative())
      return [makeLine(book.lt(0) ? "credit" : "debit", native.abs().toFixed(8), book.abs().toFixed(8), "both")];
    return [...(!book.isZero() ? [makeLine(book.lt(0) ? "credit" : "debit", "0", book.abs().toFixed(8), "book")] : []),
      ...(!native.isZero() ? [makeLine(native.lt(0) ? "credit" : "debit", native.abs().toFixed(8), "0", "native")] : [])];
  });
  return { ...source, accounts, obligations: [], settlements: [],
    transactions: [{ id, workspace_id: source.workspace.id, accounting_date: previousDate(saved.start_date), kind: "opening_balance", description: "Scenario opening position", party_id: null,
      posted_at: source.workspace.created_at, created_at: source.workspace.created_at, reversal_of_id: null },
    ...source.transactions.filter((t) => selected.has(t.id))],
    lines: [...lines, ...source.lines.filter((l) => selected.has(l.transaction_id))] };
}
