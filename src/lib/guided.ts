import {
  carrying,
  convert,
  d,
  displayMoney,
  effectiveRate,
  money,
} from "./money";
import { openItems } from "./reports";
import type {
  Account,
  Currency,
  EventInput,
  Kind,
  Line,
  Snapshot,
} from "./types";
import { decimal, rate as rateInput } from "./contracts";
export interface Split {
  account_id: string;
  amount: string;
}
export interface GuidedInput {
  id: string;
  kind: Exclude<Kind, "payment" | "reversal" | "adjustment">;
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
function line(
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
function discharge(
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
function bookDifference(lines: Line[]) {
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
function balanceFx(s: Snapshot, lines: Line[], fxId?: string) {
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
