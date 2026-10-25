import { d, money } from "./money";
import { postedLines, reports, signed } from "./reports";
import type { Account, Snapshot } from "./types";

export type ReportMode = "profit_loss" | "balance_sheet" | "balance_movement";
export type ReportGroup = "all" | Account["type"] | "accumulated";
export interface ReportDrill {
  mode: ReportMode;
  from: string;
  to: string;
  accountId?: string;
  group?: ReportGroup;
}

export function matchesReportGroup(account: Account, group: ReportGroup) {
  if (group === "all") return true;
  if (group === "equity") return ["equity", "revenue", "expense"].includes(account.type);
  if (group === "accumulated") return ["revenue", "expense"].includes(account.type);
  return account.type === group;
}

export function reportSign(mode: ReportMode, account: Account) {
  // In a balance sheet, expense lines reduce accumulated results in equity.
  return account.type === "asset" ||
    (mode === "profit_loss" && account.type === "expense") ? 1 : -1;
}

export function reportDetail(
  s: Snapshot,
  mode: ReportMode,
  { from = "", to = "", search = "", accountId = "", group = "all" as ReportGroup } = {},
) {
  if (mode !== "balance_sheet" && from && to && from > to)
    throw new Error("From date must be on or before through date.");
  const periodFrom = mode === "balance_sheet" ? "" : from;
  const full = reports(mode === "balance_movement" ? { ...s, lines: postedLines(s, from, to) } : s, periodFrom, to);
  const transactions = new Map(s.transactions.map((t) => [t.id, t]));
  const accounts = new Map(s.accounts.map((a) => [a.id, a]));
  const query = search.toLowerCase();
  const lines = postedLines(s, periodFrom, to).filter((line) => {
    const account = accounts.get(line.account_id);
    const transaction = transactions.get(line.transaction_id)!;
    return account &&
      (mode !== "profit_loss" || ["revenue", "expense"].includes(account.type)) &&
      matchesReportGroup(account, group) &&
      (!accountId || account.id === accountId) &&
      (!query || transaction.description.toLowerCase().includes(query));
  });
  // Reuse the report engine for filtered subtotals as well as complete totals.
  // A matching subset is deliberately not used for the full balance check.
  const matching = reports({ ...s, lines }, periodFrom, to);
  const fullAccounts = mode === "profit_loss" ? full.period : full.all;
  const matchingAccounts = mode === "profit_loss" ? matching.period : matching.all;
  const breakdown = matchingAccounts.flatMap(({ account, balance }) => {
    const accountLines = lines.filter((line) => line.account_id === account.id);
    if (!accountLines.length) return [];
    const sign = reportSign(mode, account);
    const entries = accountLines.map((line) => ({
      line,
      transaction: transactions.get(line.transaction_id)!,
      net: money(signed(line).times(sign)),
    })).sort((a, b) =>
      a.transaction.accounting_date.localeCompare(b.transaction.accounting_date) ||
      a.transaction.created_at.localeCompare(b.transaction.created_at) ||
      a.transaction.id.localeCompare(b.transaction.id) ||
      a.line.id.localeCompare(b.line.id),
    );
    const sideTotal = (side: "debit" | "credit") => money(accountLines
      .filter((line) => line.side === side)
      .reduce((total, line) => total.plus(line.book_amount), d(0)));
    return [{
      account,
      sign,
      debit: sideTotal("debit"),
      credit: sideTotal("credit"),
      net: money(d(balance).times(sign)),
      fullNet: money(d(fullAccounts.find((row) => row.account.id === account.id)!.balance).times(sign)),
      entries,
    }];
  });
  return {
    full,
    matching,
    breakdown,
    lineCount: lines.length,
    transactionCount: new Set(lines.map((line) => line.transaction_id)).size,
  };
}
