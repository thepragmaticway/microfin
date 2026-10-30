export type Currency = "THB" | "SGD" | "MMK" | "USD";
export const currencies: Currency[] = ["THB", "SGD", "MMK", "USD"];
export type AccountType =
  "asset" | "liability" | "equity" | "revenue" | "expense";
export type AccountRole =
  | "general"
  | "bank"
  | "cash"
  | "wallet"
  | "credit_card"
  | "receivable"
  | "payable";
export type Kind =
  | "income"
  | "expense"
  | "transfer"
  | "contribution"
  | "withdrawal"
  | "asset_purchase"
  | "deposit"
  | "invoice"
  | "bill"
  | "payment"
  | "opening_balance"
  | "recognition"
  | "adjustment"
  | "reversal";
export interface Workspace {
  id: string;
  owner_user_id: string;
  name: string;
  kind: "personal" | "business";
  functional_currency_code: Currency;
  timezone: string;
  created_at: string;
}
export interface Account {
  id: string;
  workspace_id: string;
  name: string;
  type: AccountType;
  role: AccountRole;
  currency_code: Currency | null;
  is_active: boolean;
}
export interface Party {
  id: string;
  workspace_id: string;
  name: string;
}
export interface Transaction {
  id: string;
  workspace_id: string;
  accounting_date: string;
  kind: Kind;
  description: string;
  party_id: string | null;
  posted_at: string | null;
  reversal_of_id: string | null;
  created_at: string;
}
export interface Line {
  id: string;
  account_id: string;
  side: "debit" | "credit";
  amount: string;
  currency_code: Currency;
  exchange_rate: string;
  book_amount: string;
  rate_source: "manual" | "bank" | "carrying_value" | null;
}
export interface JournalLine extends Line {
  workspace_id: string;
  transaction_id: string;
}
export interface Obligation {
  id: string;
  workspace_id: string;
  recognition_line_id: string;
  reference: string | null;
  due_date: string | null;
}
export interface Settlement {
  id: string;
  workspace_id: string;
  obligation_id: string;
  clearing_line_id: string;
  funding_line_id: string;
}
export interface EventInput {
  id: string;
  accounting_date: string;
  kind: Kind;
  description: string;
  party_id: string | null;
  lines: Line[];
  obligation: Omit<Obligation, "workspace_id"> | null;
  settlements: Omit<Settlement, "workspace_id">[];
}
export interface Snapshot {
  workspace: Workspace;
  accounts: Account[];
  parties: Party[];
  transactions: Transaction[];
  lines: JournalLine[];
  obligations: Obligation[];
  settlements: Settlement[];
}
export interface OpenItem {
  obligation: Obligation;
  transaction: Transaction;
  line: JournalLine;
  account: Account;
  party: Party | undefined;
  outstanding: string;
  outstanding_book: string;
  state: "open" | "partially_paid" | "paid";
}
