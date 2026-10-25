import { d, money } from "./money";
import { postedLines, signed } from "./reports";
import type { Snapshot } from "./types";

// Balances are debit minus credit; the view labels their side explicitly.
export function accountLedger(
  s: Snapshot,
  accountId: string,
  from = "",
  to = "",
) {
  const account = s.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Account not found");
  if (from && to && from > to)
    throw new Error("From date must be on or before through date.");
  const transactions = new Map(s.transactions.map((t) => [t.id, t]));
  const entries = postedLines(s, undefined, to)
    .filter((l) => l.account_id === accountId)
    .map((line) => ({ line, transaction: transactions.get(line.transaction_id)! }))
    .sort(
      (a, b) =>
        a.transaction.accounting_date.localeCompare(b.transaction.accounting_date) ||
        a.transaction.created_at.localeCompare(b.transaction.created_at) ||
        a.transaction.id.localeCompare(b.transaction.id) ||
        a.line.id.localeCompare(b.line.id),
    );
  let opening = d(0), nativeOpening = d(0);
  let debit = d(0), credit = d(0), nativeDebit = d(0), nativeCredit = d(0);
  let balance = d(0), nativeBalance = d(0);
  const rows = entries.flatMap(({ line, transaction }) => {
    balance = balance.plus(signed(line));
    if (account.currency_code)
      nativeBalance = nativeBalance.plus(
        d(line.amount).times(line.side === "debit" ? 1 : -1),
      );
    if (from && transaction.accounting_date < from) {
      opening = balance;
      nativeOpening = nativeBalance;
      return [];
    }
    if (line.side === "debit") {
      debit = debit.plus(line.book_amount);
      if (account.currency_code) nativeDebit = nativeDebit.plus(line.amount);
    } else {
      credit = credit.plus(line.book_amount);
      if (account.currency_code) nativeCredit = nativeCredit.plus(line.amount);
    }
    return [{
      line,
      transaction,
      balance: money(balance),
      nativeBalance: account.currency_code ? money(nativeBalance) : null,
    }];
  });
  return {
    opening: money(opening),
    debit: money(debit),
    credit: money(credit),
    closing: money(balance),
    // Any-currency accounts have no meaningful combined native balance.
    native: account.currency_code ? {
      currency: account.currency_code,
      opening: money(nativeOpening),
      debit: money(nativeDebit),
      credit: money(nativeCredit),
      closing: money(nativeBalance),
    } : null,
    rows,
  };
}
