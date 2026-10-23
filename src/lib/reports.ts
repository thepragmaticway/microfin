import { d, money } from "./money";
import type { Snapshot, OpenItem, JournalLine } from "./types";
export function isActive(s: Snapshot, id: string) {
  const t = s.transactions.find((t) => t.id === id);
  return (
    !!t?.posted_at &&
    !t.reversal_of_id &&
    !s.transactions.some((r) => r.reversal_of_id === id && r.posted_at)
  );
}
export function openItems(s: Snapshot): OpenItem[] {
  return s.obligations.flatMap((obligation) => {
    const line = s.lines.find((l) => l.id === obligation.recognition_line_id)!;
    if (!line || !isActive(s, line.transaction_id)) return [];
    const transaction = s.transactions.find(
      (t) => t.id === line.transaction_id,
    )!;
    const account = s.accounts.find((a) => a.id === line.account_id)!;
    const clearing = s.settlements
      .filter((x) => x.obligation_id === obligation.id)
      .map((x) => s.lines.find((l) => l.id === x.clearing_line_id)!)
      .filter((l) => l && isActive(s, l.transaction_id));
    const outstanding = money(
      clearing.reduce((v, l) => v.minus(l.amount), d(line.amount)),
    );
    const outstanding_book = money(
      clearing.reduce((v, l) => v.minus(l.book_amount), d(line.book_amount)),
    );
    return [
      {
        obligation,
        line,
        transaction,
        account,
        party: s.parties.find((p) => p.id === transaction.party_id),
        outstanding,
        outstanding_book,
        state: d(outstanding).isZero()
          ? "paid"
          : d(outstanding).eq(line.amount)
            ? "open"
            : "partially_paid",
      },
    ];
  });
}
export const signed = (l: JournalLine) =>
  d(l.book_amount).times(l.side === "debit" ? 1 : -1);
export function postedLines(s: Snapshot, from?: string, to?: string) {
  const ids = new Set(
    s.transactions
      .filter(
        (t) =>
          t.posted_at &&
          (!from || t.accounting_date >= from) &&
          (!to || t.accounting_date <= to),
      )
      .map((t) => t.id),
  );
  return s.lines.filter((l) => ids.has(l.transaction_id));
}
export function accountBalance(s: Snapshot, id: string, to?: string) {
  const lines = postedLines(s, undefined, to).filter(
    (l) => l.account_id === id,
  );
  const account = s.accounts.find((a) => a.id === id)!;
  const sign =
    account.type === "liability" ||
    account.type === "equity" ||
    account.type === "revenue"
      ? -1
      : 1;
  return {
    native: money(
      lines.reduce(
        (v, l) => v.plus(d(l.amount).times(l.side === "debit" ? sign : -sign)),
        d(0),
      ),
    ),
    book: money(lines.reduce((v, l) => v.plus(signed(l).times(sign)), d(0))),
  };
}
export function reports(s: Snapshot, from?: string, to?: string) {
  const totals = (lines: JournalLine[]) =>
    s.accounts.map((account) => ({
      account,
      balance: money(
        lines
          .filter((l) => l.account_id === account.id)
          .reduce((v, l) => v.plus(signed(l)), d(0)),
      ),
    }));
  const period = totals(postedLines(s, from, to));
  const all = totals(postedLines(s, undefined, to));
  const sum = (rows: typeof all, type: string) =>
    rows
      .filter((x) => x.account.type === type)
      .reduce((v, x) => v.plus(x.balance), d(0));
  const revenue = sum(period, "revenue").negated(),
    expenses = sum(period, "expense"),
    unclosed = sum(all, "revenue").plus(sum(all, "expense")).negated();
  return {
    period,
    all,
    revenue: money(revenue),
    expenses: money(expenses),
    profit: money(revenue.minus(expenses)),
    assets: money(sum(all, "asset")),
    liabilities: money(sum(all, "liability").negated()),
    contributedEquity: money(sum(all, "equity").negated()),
    unclosed: money(unclosed),
    equity: money(sum(all, "equity").negated().plus(unclosed)),
  };
}
export function workspaceToday(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
}
