import { d, money } from "./money";
import type { Snapshot, Transaction } from "./types";

// Keep summaries and rows on the same basis: selected-account movement,
// otherwise money-account movement, or debit value for non-money entries.
export function activityAmount(s: Snapshot, t: Transaction, accountId = "") {
  const lines = s.lines.filter((line) => line.transaction_id === t.id);
  const account = s.accounts.find((a) => a.id === accountId);
  const moneyIds = new Set(s.accounts
    .filter((a) => ["bank", "cash", "wallet", "credit_card"].includes(a.role))
    .map((a) => a.id));
  const moneyLines = lines.filter((line) => moneyIds.has(line.account_id));
  const selected = accountId
    ? lines.filter((line) => line.account_id === accountId)
    : moneyLines.length ? moneyLines : lines.filter((line) => line.side === "debit");
  const signed = !!accountId || moneyLines.length > 0;
  return {
    book: money(selected.reduce((total, line) => total.plus(
      d(line.book_amount).times(signed && line.side === "credit" ? -1 : 1),
    ), d(0))),
    native: account?.currency_code
      ? money(selected.reduce((total, line) => total.plus(
        d(line.amount).times(line.side === "credit" ? -1 : 1),
      ), d(0)))
      : null,
  };
}

export function summarizeActivity(s: Snapshot, rows: Transaction[], accountId = "") {
  const nativeCurrency = s.accounts.find((a) => a.id === accountId)?.currency_code;
  const recorded = { count: 0, book: d(0), native: d(0) };
  const drafts = { count: 0, book: d(0), native: d(0) };
  for (const transaction of rows) {
    const amount = activityAmount(s, transaction, accountId);
    const total = transaction.posted_at ? recorded : drafts;
    total.count++;
    // Sum the rounded row values so totals reconcile with what is displayed.
    total.book = total.book.plus(amount.book);
    if (amount.native !== null) total.native = total.native.plus(amount.native);
  }
  const format = (total: typeof recorded) => ({
    count: total.count,
    book: money(total.book),
    native: nativeCurrency ? money(total.native) : null,
  });
  return { recorded: format(recorded), drafts: format(drafts) };
}
