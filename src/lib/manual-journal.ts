import { currency, decimal, eventInput, lineInput, rate } from "./contracts";
import { carriedLines } from "./accounting/ledger";
import { convert, d, money } from "./money";
import type { Account, Currency, EventInput, Line, Snapshot } from "./types";

export type ManualLine = Pick<
  Line,
  "id" | "account_id" | "side" | "amount" | "currency_code" | "exchange_rate"
>;
export interface ManualInput {
  id: string;
  accounting_date: string;
  description: string;
  party_id: string | null;
  lines: ManualLine[];
}
export function usesCarryingValue(
  account: Account | undefined,
  side: Line["side"],
  code: Currency,
  home: Currency,
) {
  return (
    code !== home &&
    ((account?.type === "asset" && side === "credit") ||
      (account?.type === "liability" && side === "debit"))
  );
}
export function previewManual(s: Snapshot, rows: ManualLine[]) {
  if (rows.length < 2 || rows.length > 100)
    throw new Error("Use between 2 and 100 journal lines");
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error("Journal line identifiers must be unique");
  const home = s.workspace.functional_currency_code;
  const prepared = rows.map((row, index): Line => {
    const fail = (message: string): never => {
      throw new Error(`Line ${index + 1}: ${message}`);
    };
    const account = s.accounts.find(
      (a) => a.id === row.account_id && a.is_active,
    );
    if (!account) return fail("Choose an active account");
    if (["receivable", "payable"].includes(account.role))
      return fail(
        "Use the invoice, bill or payment form for customer/supplier control accounts",
      );
    if (
      !currency.safeParse(row.currency_code).success ||
      (account.currency_code && account.currency_code !== row.currency_code)
    )
      return fail("Currency must match the account");
    if (!["debit", "credit"].includes(row.side))
      return fail("Choose debit or credit");
    if (!decimal.safeParse(row.amount).success || d(row.amount).lte(0))
      return fail("Enter an original amount greater than zero");
    // All four supported currencies use two minor units in the ledger schema.
    const units = 2;
    if (d(row.amount).decimalPlaces() > units)
      return fail(
        `Use at most ${units} decimal places for ${row.currency_code}`,
      );
    const automatic =
      row.currency_code === home ||
      usesCarryingValue(account, row.side, row.currency_code, home);
    const exchangeRate = automatic ? "1" : row.exchange_rate;
    if (!rate.safeParse(exchangeRate).success)
      return fail(
        "Enter a positive exchange rate in home currency per original unit",
      );
    const value: Line = {
      ...row,
      amount: money(row.amount),
      exchange_rate: exchangeRate,
      book_amount: convert(row.amount, exchangeRate),
      rate_source: row.currency_code === home ? null : "manual",
    };
    if (!lineInput.safeParse(value).success)
      return fail("Amount or rate exceeds the supported precision");
    return value;
  });
  const lines = carriedLines(s, prepared);
  const sum = (side: Line["side"]) =>
    money(
      lines
        .filter((l) => l.side === side)
        .reduce((v, l) => v.plus(l.book_amount), d(0)),
    );
  const debits = sum("debit"),
    credits = sum("credit");
  return {
    lines,
    debits,
    credits,
    difference: money(d(debits).minus(credits)),
  };
}
export function buildManual(
  s: Snapshot,
  input: ManualInput,
  post: boolean,
): EventInput {
  if (s.transactions.some((t) => t.id === input.id && t.posted_at))
    throw new Error("Recorded entries can only be corrected with a reversal");
  const preview = previewManual(s, input.lines);
  if (post && !d(preview.difference).isZero())
    throw new Error(
      "Journal debits and credits must balance in home currency before posting",
    );
  return eventInput.parse({
    id: input.id,
    kind: "adjustment",
    accounting_date: input.accounting_date,
    description: input.description,
    party_id: input.party_id,
    lines: preview.lines,
    obligation: null,
    settlements: [],
  });
}
