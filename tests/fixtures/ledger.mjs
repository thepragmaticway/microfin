import { randomUUID } from "node:crypto";
export const uuid = randomUUID;
export const line = (
  account_id,
  side,
  amount,
  currency_code = "USD",
  exchange_rate = "1",
  book_amount = amount,
  rate_source = currency_code === "USD" ? null : "manual",
) => ({
  id: uuid(),
  account_id,
  side,
  amount,
  currency_code,
  exchange_rate,
  book_amount,
  rate_source,
});
export function event(kind, lines, extra = {}) {
  return {
    id: uuid(),
    accounting_date: "2026-10-23",
    kind,
    description: `Test ${kind}`,
    party_id: null,
    lines,
    obligation: null,
    settlements: [],
    ...extra,
  };
}
export function invoice(
  control,
  category,
  party,
  amount = "4000",
  rate = "0.75",
  book = "3000",
  kind = "invoice",
) {
  const recognition = line(
      control,
      kind === "bill" ? "credit" : "debit",
      amount,
      "SGD",
      rate,
      book,
    ),
    counter = line(
      category,
      kind === "bill" ? "debit" : "credit",
      amount,
      "SGD",
      rate,
      book,
    );
  return event(kind, [recognition, counter], {
    party_id: party,
    obligation: {
      id: uuid(),
      recognition_line_id: recognition.id,
      reference: "INV-TEST",
      due_date: "2026-11-01",
    },
  });
}
export function payment(
  original,
  bank,
  amount = "1000",
  funding = "750",
  book = "750",
  extras = [],
) {
  const r = original.lines[0],
    clearing = line(
      r.account_id,
      r.side === "debit" ? "credit" : "debit",
      amount,
      r.currency_code,
      "0.75",
      book,
      "carrying_value",
    ),
    funded = line(bank, r.side, funding);
  return event("payment", [clearing, funded, ...extras], {
    settlements: [
      {
        id: uuid(),
        obligation_id: original.obligation.id,
        clearing_line_id: clearing.id,
        funding_line_id: funded.id,
      },
    ],
  });
}
