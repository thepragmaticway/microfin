import type { GuidedInput } from "../guided";
import { buildRecognition } from "../accounting/recognition";
import type { Snapshot } from "../types";

/** Invoice/bill terminology and category selection belong to the application adapter. */
export function buildInvoiceOrBill(s: Snapshot, p: GuidedInput) {
  if (!["invoice", "bill"].includes(p.kind) || !p.party_id)
    throw new Error("Invoice or bill requires a counterparty");
  const expectedRole = p.kind === "invoice" ? "receivable" : "payable";
  const control = s.accounts.find((a) => a.id === p.source_id);
  if (control?.role !== expectedRole) throw new Error("Choose the correct unpaid account");
  const event = buildRecognition(s, {
    id: p.id, accounting_date: p.accounting_date, description: p.description,
    party_id: p.party_id, control_account_id: p.source_id,
    amount: p.amount, currency_code: control.currency_code!, exchange_rate: p.rate,
    categories: (p.splits.length ? p.splits : [{account_id: p.destination_id, amount: p.destination_amount ?? p.amount}])
      .map((part) => ({...part, currency_code: p.currency, exchange_rate: p.destination_rate ?? p.rate})),
    fx_account_id: p.fx_account_id, reference: p.reference, due_date: p.due_date,
  });
  return {...event, kind: p.kind};
}
