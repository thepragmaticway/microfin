import { money } from "./money";
import type { Currency, EventInput, Kind, Line, Snapshot } from "./types";
import { line, carriedLines, discharge, balanceFx, bookDifference } from "./accounting/ledger";
export { carriedLines } from "./accounting/ledger";
export { buildPayment } from "./accounting/settlement";
export type { PaymentAllocation, PaymentInput } from "./accounting/settlement";

export interface Split {
  account_id: string;
  amount: string;
}
export interface GuidedInput {
  id: string;
  kind: Exclude<Kind, "payment" | "reversal" | "adjustment" | "recognition">;
  accounting_date: string;
  description: string;
  party_id: string | null;
  source_id: string;
  destination_id: string;
  amount: string;
  currency: Currency;
  rate: string;
  destination_amount?: string;
  destination_rate?: string;
  splits: Split[];
  fx_account_id?: string;
  reference?: string;
  due_date?: string;
}
function guidedEvent(s: Snapshot, p: GuidedInput): EventInput {
  const functional = s.workspace.functional_currency_code;
  const account = (id: string) => {
    const a = s.accounts.find((a) => a.id === id && a.is_active);
    if (!a) throw new Error("Choose an active account");
    return a;
  };
  const source = account(p.source_id);
  const destination = p.splits.length ? null : account(p.destination_id);
  const creditSource = !["income", "contribution", "invoice"].includes(p.kind);
  // Spend/equipment/deposit/transfer/owner withdrawal debit destination. Receive
  // and owner contribution debit the source money account; credit categories.
  const lines: Line[] = [];
  const main = line(
    source,
    creditSource ? "credit" : "debit",
    p.amount,
    source.currency_code ?? p.currency,
    p.rate,
    functional,
  );
  lines.push(main);
  const splits = p.splits.length
    ? p.splits
    : [
        {
          account_id: destination!.id,
          amount: p.destination_amount ?? p.amount,
        },
      ];
  for (const split of splits) {
    const target = account(split.account_id);
    lines.push(
      line(
        target,
        creditSource ? "debit" : "credit",
        split.amount,
        target.currency_code ?? p.currency,
        p.destination_rate ?? p.rate,
        functional,
      ),
    );
  }
  const carried = carriedLines(s, lines);
  const control = carried.find((l) =>
    ["receivable", "payable"].includes(account(l.account_id).role),
  );
  return {
    id: p.id,
    accounting_date: p.accounting_date,
    kind: p.kind,
    description: p.description,
    party_id: p.party_id,
    lines: carried,
    obligation: control
      ? {
          id: crypto.randomUUID(),
          recognition_line_id: control.id,
          reference: p.reference || null,
          due_date: p.due_date || null,
        }
      : null,
    settlements: [],
  };
}
export function buildGuided(s: Snapshot, p: GuidedInput): EventInput {
  const event = guidedEvent(s, p);
  balanceFx(s, event.lines, p.fx_account_id);
  return event;
}
export interface TransferValues {
  outgoing: string;
  incoming: string;
  difference: string;
}
export function previewTransfer(s: Snapshot, p: GuidedInput): TransferValues {
  if (p.kind !== "transfer" || p.splits.length)
    throw new Error("Choose a transfer without category splits");
  // Use the posting calculation, but expose values rather than an unbalanced
  // event. Saving must still pass buildGuided's FX category validation.
  const { lines } = guidedEvent(s, p);
  return {
    outgoing: lines.find((l) => l.side === "credit")!.book_amount,
    incoming: lines.find((l) => l.side === "debit")!.book_amount,
    difference: money(bookDifference(lines)),
  };
}
export function refreshDraftCarrying(
  s: Snapshot,
  event: EventInput,
  fxAccountId: string,
  fxLineId?: string,
): EventInput {
  if (s.transactions.some((t) => t.id === event.id && t.posted_at))
    throw new Error("This entry is already recorded. Reload its details");
  const replaced = event.lines.find((l) => l.id === fxLineId);
  if (replaced) {
    const account = s.accounts.find((a) => a.id === replaced.account_id);
    if (
      replaced.currency_code !== s.workspace.functional_currency_code ||
      account?.role !== "general" ||
      !["revenue", "expense"].includes(account.type)
    )
      throw new Error("Choose an existing home-currency FX / rounding posting");
  }
  // Keep the user's original currencies, amounts and manual expense values.
  // Only reallocate carried balance discharges and the explicitly selected FX line.
  const lines = event.lines
    .filter((l) => l.id !== fxLineId)
    .map((l) => ({ ...l }));
  const balances = new Map<string, { native: string; book: string }>();
  lines
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((l) => {
      const account = s.accounts.find((a) => a.id === l.account_id);
      if (account && !["receivable", "payable"].includes(account.role))
        discharge(s, l, balances, lines);
    });
  const before = lines.length;
  balanceFx(s, lines, fxAccountId || undefined);
  if (replaced && lines.length > before)
    lines[lines.length - 1].id = replaced.id;
  return { ...event, lines };
}
