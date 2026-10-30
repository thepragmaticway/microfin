import { carrying, convert, d, displayMoney, effectiveRate, money } from "../money";
import { decimal, rate as rateInput } from "../contracts";
import type { Account, Currency, Line, Snapshot } from "../types";

export function line(
  account: Account,
  side: Line["side"],
  amount: string,
  currency: Currency,
  rate: string,
  functional: Currency,
): Line {
  if (!decimal.safeParse(amount).success || !rateInput.safeParse(rate).success)
    throw new Error(
      "Enter a valid decimal amount and a positive exchange rate",
    );
  if (d(amount).lte(0) || d(amount).decimalPlaces() > 2)
    throw new Error(
      "Enter an amount greater than zero with up to 2 decimal places",
    );
  return {
    id: crypto.randomUUID(),
    account_id: account.id,
    side,
    amount: money(amount),
    currency_code: currency,
    exchange_rate: currency === functional ? "1" : rate,
    book_amount:
      currency === functional ? money(amount) : convert(amount, rate),
    rate_source: currency === functional ? null : "manual",
  };
}
export function discharge(
  s: Snapshot,
  l: Line,
  balances: Map<string, { native: string; book: string }>,
  incoming: Line[] = [],
) {
  const a = s.accounts.find((a) => a.id === l.account_id)!;
  if (
    l.currency_code === s.workspace.functional_currency_code ||
    !["asset", "liability"].includes(a.type) ||
    (a.type === "asset" ? l.side !== "credit" : l.side !== "debit")
  )
    return;
  const key = `${a.id}:${l.currency_code}`;
  // General accounts can contain several currencies; use only this currency.
  const balance =
    balances.get(key) ??
    (() => {
      const tx = new Set(
        s.transactions.filter((t) => t.posted_at).map((t) => t.id),
      );
      const sign = a.type === "asset" ? 1 : -1;
      const entries = s.lines.filter(
        (x) =>
          tx.has(x.transaction_id) &&
          x.account_id === a.id &&
          x.currency_code === l.currency_code,
      );
      // Receipts in this atomic event join the carrying pool before any of its
      // discharges. This lets a collection fund its own separately posted fee.
      const additions = incoming.filter(
        (x) =>
          x.account_id === a.id &&
          x.currency_code === l.currency_code &&
          x.side === (a.type === "asset" ? "debit" : "credit"),
      );
      return {
        native: money(
          entries.reduce(
            (v, x) =>
              v.plus(d(x.amount).times(x.side === "debit" ? sign : -sign)),
            additions.reduce((v, x) => v.plus(x.amount), d(0)),
          ),
        ),
        book: money(
          entries.reduce(
            (v, x) =>
              v.plus(d(x.book_amount).times(x.side === "debit" ? sign : -sign)),
            additions.reduce((v, x) => v.plus(x.book_amount), d(0)),
          ),
        ),
      };
    })();
  l.book_amount = carrying(l.amount, balance.native, balance.book);
  // A tiny carried value may be zero; preserve a positive effective rate which
  // still rounds to zero (zero exchange rates are never valid).
  l.exchange_rate = d(l.book_amount).isZero()
    ? "0.000000000000000001"
    : effectiveRate(l.amount, l.book_amount);
  l.rate_source = "carrying_value";
  balances.set(key, {
    native: money(d(balance.native).minus(l.amount)),
    book: money(d(balance.book).minus(l.book_amount)),
  });
}
export function bookDifference(lines: Line[]) {
  return lines.reduce(
    (sum, l) => sum.plus(d(l.book_amount).times(l.side === "debit" ? 1 : -1)),
    d(0),
  );
}
export function carriedLines(s: Snapshot, input: Line[]): Line[] {
  const lines = input
    .map((l) => ({ ...l }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const balances = new Map<string, { native: string; book: string }>();
  // Match SQL's allocation order, including receipts in this atomic event.
  lines.forEach((l) => discharge(s, l, balances, lines));
  return lines;
}
export function balanceFx(s: Snapshot, lines: Line[], fxId?: string) {
  const difference = bookDifference(lines);
  if (difference.isZero()) return;
  const fx = s.accounts.find(
    (a) =>
      a.id === fxId &&
      a.role === "general" &&
      a.is_active &&
      ["revenue", "expense"].includes(a.type),
  );
  if (!fx)
    throw new Error(
      `Choose an FX / rounding category to record the difference: ${displayMoney(difference.abs().toString(), s.workspace.functional_currency_code)} ${difference.isPositive() ? "gain" : "loss"} because the home-currency values differ`,
    );
  lines.push(
    line(
      fx,
      difference.isPositive() ? "credit" : "debit",
      difference.abs().toFixed(2),
      s.workspace.functional_currency_code,
      "1",
      s.workspace.functional_currency_code,
    ),
  );
}
