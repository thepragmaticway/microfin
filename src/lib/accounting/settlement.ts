import { carrying, d, effectiveRate, money } from "../money";
import { openItems } from "../reports";
import type { EventInput, Line, Snapshot } from "../types";
import { line, discharge, balanceFx } from "./ledger";

export interface PaymentAllocation {
  obligation_id: string;
  amount: string;
  funding_account_id: string;
  funding_amount: string;
  funding_rate: string;
}
export function buildPayment(
  s: Snapshot,
  p: {
    id: string;
    accounting_date: string;
    description: string;
    allocations: PaymentAllocation[];
    fx_account_id?: string;
    fee?: {
      account_id: string;
      funding_account_id: string;
      amount: string;
      rate: string;
    };
  },
): EventInput {
  const functional = s.workspace.functional_currency_code,
    items = openItems(s),
    lines: Line[] = [],
    settlements: EventInput["settlements"] = [];
  const remaining = new Map<string, { native: string; book: string }>();
  for (const allocation of p.allocations) {
    const item = items.find(
        (x) => x.obligation.id === allocation.obligation_id,
      ),
      funding = s.accounts.find(
        (a) =>
          a.id === allocation.funding_account_id &&
          a.is_active &&
          ["bank", "cash", "wallet", "credit_card"].includes(a.role),
      );
    if (!item || !funding)
      throw new Error("Choose an open item and a money account");
    const balance = remaining.get(item.obligation.id) ?? {
      native: item.outstanding,
      book: item.outstanding_book,
    };
    const book = carrying(allocation.amount, balance.native, balance.book);
    const clearing = line(
      item.account,
      item.line.side === "debit" ? "credit" : "debit",
      allocation.amount,
      item.line.currency_code,
      item.line.exchange_rate,
      functional,
    );
    clearing.book_amount = book;
    clearing.exchange_rate =
      clearing.currency_code === functional
        ? "1"
        : d(book).isZero()
          ? "0.000000000000000001"
          : effectiveRate(allocation.amount, book);
    clearing.rate_source =
      clearing.currency_code === functional ? null : "carrying_value";
    const funded = line(
      funding,
      item.line.side,
      allocation.funding_amount,
      funding.currency_code!,
      allocation.funding_rate,
      functional,
    );
    lines.push(clearing, funded);
    settlements.push({
      id: crypto.randomUUID(),
      obligation_id: item.obligation.id,
      clearing_line_id: clearing.id,
      funding_line_id: funded.id,
    });
    remaining.set(item.obligation.id, {
      native: money(d(balance.native).minus(allocation.amount)),
      book: money(d(balance.book).minus(book)),
    });
  }
  if (p.fee && d(p.fee.amount).gt(0)) {
    const expense = s.accounts.find(
        (a) =>
          a.id === p.fee!.account_id &&
          a.type === "expense" &&
          a.role === "general",
      ),
      bank = s.accounts.find(
        (a) =>
          a.id === p.fee!.funding_account_id &&
          ["bank", "cash", "wallet", "credit_card"].includes(a.role),
      );
    if (!expense || !bank)
      throw new Error("Choose a fee category and money account");
    lines.push(
      line(
        bank,
        "credit",
        p.fee.amount,
        bank.currency_code!,
        p.fee.rate,
        functional,
      ),
      line(
        expense,
        "debit",
        p.fee.amount,
        bank.currency_code!,
        p.fee.rate,
        functional,
      ),
    );
  }
  // Allocate all foreign funding discharges in deterministic order. Recognition
  // clearings use the obligation remainder rather than a whole control balance.
  const balances = new Map<string, { native: string; book: string }>();
  lines
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((l) => {
      if (!settlements.some((x) => x.clearing_line_id === l.id))
        discharge(s, l, balances, lines);
    });
  // Stable clearing order also governs repeated allocations of the same item.
  // Recompute their proportional remainders after sorting, including final cents.
  remaining.clear();
  for (const l of lines) {
    const st = settlements.find((x) => x.clearing_line_id === l.id);
    if (!st) continue;
    const item = items.find((x) => x.obligation.id === st.obligation_id)!;
    const rem = remaining.get(item.obligation.id) ?? {
      native: item.outstanding,
      book: item.outstanding_book,
    };
    l.book_amount = carrying(l.amount, rem.native, rem.book);
    l.exchange_rate =
      l.currency_code === functional
        ? "1"
        : d(l.book_amount).isZero()
          ? "0.000000000000000001"
          : effectiveRate(l.amount, l.book_amount);
    remaining.set(item.obligation.id, {
      native: money(d(rem.native).minus(l.amount)),
      book: money(d(rem.book).minus(l.book_amount)),
    });
  }
  balanceFx(s, lines, p.fx_account_id);
  return {
    id: p.id,
    accounting_date: p.accounting_date,
    kind: "payment",
    description: p.description,
    party_id: null,
    lines,
    obligation: null,
    settlements,
  };
}


export type PaymentInput = Parameters<typeof buildPayment>[1];
export function transferRate(source: string, received: string): string {
  if (!d(source).gt(0) || !d(received).gt(0)) throw new Error("Transfer amounts must be positive");
  const rounded = effectiveRate(source, received);
  return d(rounded).isZero() ? d(received).div(source).toFixed() : rounded;
}
