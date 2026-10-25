import { d, money } from "./money";
import { postedLines, reports, signed } from "./reports";
import type { Account, Snapshot } from "./types";

export type ReportMode = "profit_loss" | "balance_sheet";

export function reportSign(mode: ReportMode, account: Account) {
  // In a balance sheet, expense lines reduce accumulated results in equity.
  return account.type === "asset" ||
    (mode === "profit_loss" && account.type === "expense") ? 1 : -1;
}

export function reportDetail(
  s: Snapshot,
  mode: ReportMode,
  { from = "", to = "", search = "", accountId = "" } = {},
) {
  if (mode === "profit_loss" && from && to && from > to)
    throw new Error("From date must be on or before through date.");
  const periodFrom = mode === "profit_loss" ? from : "";
  const full = reports(s, periodFrom, to);
  const transactions = new Map(s.transactions.map((t) => [t.id, t]));
  const accounts = new Map(s.accounts.map((a) => [a.id, a]));
  const query = search.toLowerCase();
  const lines = postedLines(s, periodFrom, to).filter((line) => {
    const account = accounts.get(line.account_id);
    const transaction = transactions.get(line.transaction_id)!;
    return account &&
      (mode === "balance_sheet" || ["revenue", "expense"].includes(account.type)) &&
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
