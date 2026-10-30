import type { Currency, EventInput, Snapshot } from "../types";
import { line, balanceFx } from "./ledger";
export interface RecognitionInput {
  id: string;
  accounting_date: string;
  description: string;
  party_id: string;
  control_account_id: string;
  category_account_id?: string;
  categories?: {account_id: string; amount: string; currency_code?: Currency; exchange_rate?: string}[];
  fx_account_id?: string;
  amount: string;
  currency_code: Currency;
  exchange_rate: string;
  reference?: string;
  due_date?: string;
}
/** Generic earned receivable/payable recognition; no module domain fields. */
export function buildRecognition(s: Snapshot, p: RecognitionInput): EventInput {
  const control = s.accounts.find((a) => a.id === p.control_account_id && a.is_active);

  if (!control || !["receivable", "payable"].includes(control.role) ||
      control.currency_code !== p.currency_code)
    throw new Error("Choose a control account matching the obligation currency");
  const payable = control.role === "payable";
  if (!s.parties.some((party) => party.id === p.party_id))
    throw new Error("Choose a counterparty in this workspace");
  const home = s.workspace.functional_currency_code;
  const recognition = line(control, payable ? "credit" : "debit", p.amount, p.currency_code, p.exchange_rate, home);
  const parts = p.categories ?? [{account_id: p.category_account_id!, amount: p.amount}];
  if (!parts.length) throw new Error("Recognition requires a category");
  const counters = parts.map((part) => {
    const category = s.accounts.find((a) => a.id === part.account_id && a.is_active);
    if (!category || category.role !== "general" || category.type !== (payable ? "expense" : "revenue"))
      throw new Error("Choose a matching recognition category");
    return line(category, payable ? "debit" : "credit", part.amount, category.currency_code ?? part.currency_code ?? p.currency_code, part.exchange_rate ?? p.exchange_rate, home);
  });
  const lines = [recognition, ...counters];
  balanceFx(s, lines, p.fx_account_id);
  return {
    id: p.id, accounting_date: p.accounting_date, description: p.description,
    kind: "recognition", party_id: p.party_id, lines,
    obligation: {id: crypto.randomUUID(), recognition_line_id: recognition.id, reference: p.reference ?? null, due_date: p.due_date ?? null},
    settlements: [],
  };
}
