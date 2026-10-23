import { describe, it, expect, vi } from "vitest";
import { carrying, convert, displayMoney } from "../../src/lib/money";
import { accountInput, eventInput } from "../../src/lib/contracts";
import {
  reports,
  openItems,
  workspaceToday,
  accountBalance,
} from "../../src/lib/reports";
import {
  buildGuided,
  buildPayment,
  refreshDraftCarrying,
} from "../../src/lib/guided";
import type { Account, Snapshot, EventInput } from "../../src/lib/types";
const id = () => crypto.randomUUID();
const account = (
  name: string,
  type: Account["type"],
  role: Account["role"] = "general",
  currency_code: Account["currency_code"] = null,
): Account => ({
  id: id(),
  workspace_id: "w",
  name,
  type,
  role,
  currency_code,
  is_active: true,
});
function fixture() {
  const bank = account("USD bank", "asset", "bank", "USD"),
    sgd = account("SGD bank", "asset", "bank", "SGD"),
    capital = account("Capital", "equity"),
    revenue = account("Services", "revenue"),
    expense = account("Rent", "expense"),
    asset = account("Equipment / deposit", "asset"),
    ar = account("Customer SGD", "asset", "receivable", "SGD"),
    fx = account("FX", "expense");
  const s: Snapshot = {
    workspace: {
      id: "w",
      owner_user_id: "u",
      name: "Studio",
      kind: "business",
      functional_currency_code: "USD",
      timezone: "Asia/Bangkok",
      created_at: "2026-10-23",
    },
    accounts: [bank, sgd, capital, revenue, expense, asset, ar, fx],
    parties: [{ id: id(), workspace_id: "w", name: "Client" }],
    transactions: [],
    lines: [],
    obligations: [],
    settlements: [],
  };
  return { s, bank, sgd, capital, revenue, expense, asset, ar, fx };
}
function append(s: Snapshot, event: EventInput, posted = true) {
  s.transactions.push({
    id: event.id,
    workspace_id: "w",
    accounting_date: event.accounting_date,
    description: event.description,
    kind: event.kind,
    party_id: event.party_id,
    posted_at: posted ? "2026-10-23T12:00:00Z" : null,
    reversal_of_id: null,
    created_at: "2026-10-23",
  });
  s.lines.push(
    ...event.lines.map((l) => ({
      ...l,
      workspace_id: "w",
      transaction_id: event.id,
    })),
  );
  if (event.obligation)
    s.obligations.push({ ...event.obligation, workspace_id: "w" });
  s.settlements.push(
    ...event.settlements.map((x) => ({ ...x, workspace_id: "w" })),
  );
}
function guided(
  s: Snapshot,
  kind: Parameters<typeof buildGuided>[1]["kind"],
  source: string,
  destination: string,
  amount: string,
  currency: Parameters<typeof buildGuided>[1]["currency"] = "USD",
  rate = "1",
) {
  return buildGuided(s, {
    id: id(),
    kind,
    accounting_date: "2026-10-23",
    description: kind,
    party_id: s.parties[0].id,
    source_id: source,
    destination_id: destination,
    amount,
    currency,
    rate,
    splits: [],
  });
}
describe("exact money and financial journeys", () => {
  it("keeps decimals exact and assigns the final carrying remainder", () => {
    expect(convert("0.1", "0.2")).toBe("0.02");
    expect(carrying("0.01", "0.03", "0.01")).toBe("0.00");
    expect(carrying("0.01", "0.01", "0.01")).toBe("0.01");
    expect(displayMoney("99999999999999999999.99", "THB")).toBe(
      "THB 99,999,999,999,999,999,999.99",
    );
    expect(() => carrying("2", "1", "1")).toThrow(/exceeds/);
  });
  it("reconciles the approved payroll-excluded fixture and excludes drafts/date ranges", () => {
    const { s, bank, sgd, capital, revenue, expense, asset } = fixture();
    append(s, guided(s, "contribution", bank.id, capital.id, "10000"));
    for (const [kind, amount, target] of [
      ["deposit", "1000", asset],
      ["expense", "1000", expense],
      ["asset_purchase", "3000", asset],
      ["asset_purchase", "500", asset],
      ["expense", "500", expense],
      ["expense", "200", expense],
    ] as const)
      append(s, guided(s, kind, bank.id, target.id, amount));
    const t10 = guided(s, "income", sgd.id, revenue.id, "4000", "SGD", "0.75");
    append(s, t10);
    expect(t10.lines.map((l) => l.book_amount)).toEqual(["3000.00", "3000.00"]);
    append(s, guided(s, "expense", bank.id, expense.id, "999"), false);
    const result = reports(s, "2026-10-01", "2026-10-31");
    expect(result).toMatchObject({
      assets: "11300.00",
      revenue: "3000.00",
      expenses: "1700.00",
      profit: "1300.00",
      equity: "11300.00",
      unclosed: "1300.00",
    });
    expect(reports(s, "2026-11-01", "2026-11-30").profit).toBe("0.00");
    expect(reports(s, undefined, "2026-10-22").assets).toBe("0.00");
  });
  it("creates partial receipts without re-recognizing income, then cancels through a full reversal", () => {
    const { s, bank, revenue, ar } = fixture(),
      invoice = guided(s, "invoice", ar.id, revenue.id, "4000", "SGD", "0.75");
    append(s, invoice);
    const payment = buildPayment(s, {
      id: id(),
      accounting_date: "2026-10-23",
      description: "Partial receipt",
      allocations: [
        {
          obligation_id: invoice.obligation!.id,
          amount: "1000",
          funding_account_id: bank.id,
          funding_amount: "750",
          funding_rate: "1",
        },
      ],
    });
    append(s, payment);
    expect(openItems(s)[0]).toMatchObject({
      outstanding: "3000.00",
      outstanding_book: "2250.00",
      state: "partially_paid",
    });
    expect(reports(s).revenue).toBe("3000.00");
    const reversal = id();
    s.transactions.push({
      ...s.transactions[1],
      id: reversal,
      kind: "reversal",
      reversal_of_id: payment.id,
    });
    s.lines.push(
      ...payment.lines.map((l) => ({
        ...l,
        id: id(),
        workspace_id: "w",
        transaction_id: reversal,
        side: l.side === "debit" ? ("credit" as const) : ("debit" as const),
      })),
    );
    expect(openItems(s)[0].outstanding).toBe("4000.00");
    expect(reports(s).revenue).toBe("3000.00");
  });
  it("preserves a foreign account’s carrying value and makes FX explicit", () => {
    const { s, sgd, revenue, expense, fx } = fixture();
    append(s, guided(s, "income", sgd.id, revenue.id, "100", "SGD", "0.75"));
    const spend = buildGuided(s, {
      id: id(),
      kind: "expense",
      accounting_date: "2026-10-23",
      description: "Spend",
      party_id: null,
      source_id: sgd.id,
      destination_id: expense.id,
      amount: "100",
      currency: "SGD",
      rate: "0.8",
      splits: [],
      fx_account_id: fx.id,
    });
    expect(spend.lines.find((l) => l.account_id === sgd.id)).toMatchObject({
      amount: "100.00",
      book_amount: "75.00",
      rate_source: "carrying_value",
    });
    expect(spend.lines.find((l) => l.account_id === fx.id)).toMatchObject({
      side: "credit",
      book_amount: "5.00",
    });
  });
  it("validates role/currency and refuses exponent or numeric JSON input", () => {
    expect(
      accountInput.safeParse({
        id: id(),
        name: "Bad",
        type: "expense",
        role: "bank",
        currency_code: "THB",
        is_active: true,
      }).success,
    ).toBe(false);
    const { s, bank, revenue } = fixture();
    const event = guided(s, "income", bank.id, revenue.id, "1");
    expect(eventInput.safeParse(event).success).toBe(true);
    expect(
      eventInput.safeParse({
        ...event,
        lines: [{ ...event.lines[0], amount: 1 }],
      }).success,
    ).toBe(false);
    expect(
      eventInput.safeParse({
        ...event,
        lines: [{ ...event.lines[0], amount: "1e8" }],
      }).success,
    ).toBe(false);
  });
  it("funds a foreign collection fee from its same-event receipt and rejects overspending", () => {
    const { s, sgd, revenue, expense, ar } = fixture();
    const invoice = guided(
      s,
      "invoice",
      ar.id,
      revenue.id,
      "100",
      "SGD",
      "0.75",
    );
    append(s, invoice);
    const input = {
      id: id(),
      accounting_date: "2026-10-23",
      description: "Collect with fee",
      allocations: [
        {
          obligation_id: invoice.obligation!.id,
          amount: "100",
          funding_account_id: sgd.id,
          funding_amount: "100",
          funding_rate: "0.75",
        },
      ],
      fee: {
        account_id: expense.id,
        funding_account_id: sgd.id,
        amount: "2",
        rate: "0.75",
      },
    };
    const paid = buildPayment(s, input);
    append(s, paid);
    expect(accountBalance(s, sgd.id)).toEqual({
      native: "98.00",
      book: "73.50",
    });
    expect(openItems(s)[0]).toMatchObject({
      outstanding: "0.00",
      outstanding_book: "0.00",
      state: "paid",
    });
    expect(reports(s)).toMatchObject({
      revenue: "75.00",
      expenses: "1.50",
      profit: "73.50",
    });
    const fresh = fixture();
    const inv = guided(
      fresh.s,
      "invoice",
      fresh.ar.id,
      fresh.revenue.id,
      "100",
      "SGD",
      "0.75",
    );
    append(fresh.s, inv);
    expect(() =>
      buildPayment(fresh.s, {
        ...input,
        allocations: [
          {
            ...input.allocations[0],
            obligation_id: inv.obligation!.id,
            funding_account_id: fresh.sgd.id,
          },
        ],
        fee: {
          ...input.fee,
          account_id: fresh.expense.id,
          funding_account_id: fresh.sgd.id,
          amount: "101",
        },
      }),
    ).toThrow(/exceeds available/);
  });
  it("refreshes a saved expense’s carrying and FX values while retaining its identity and manual expense", () => {
    const { s, sgd, revenue, expense, fx } = fixture();
    append(s, guided(s, "income", sgd.id, revenue.id, "100", "SGD", "0.75"));
    const draft = buildGuided(s, {
      id: id(),
      kind: "expense",
      accounting_date: "2026-10-23",
      description: "Saved purchase",
      party_id: null,
      source_id: sgd.id,
      destination_id: expense.id,
      amount: "50",
      currency: "SGD",
      rate: "0.8",
      splits: [],
      fx_account_id: fx.id,
    });
    append(s, draft, false);
    expect(reports(s).expenses).toBe("0.00");
    append(s, guided(s, "income", sgd.id, revenue.id, "100", "SGD", "1"));
    const refreshed = refreshDraftCarrying(
      s,
      draft,
      fx.id,
      draft.lines.find((l) => l.account_id === fx.id)!.id,
    );
    expect(refreshed.id).toBe(draft.id);
    expect(refreshed.lines.find((l) => l.account_id === sgd.id)).toMatchObject({
      amount: "50.00",
      book_amount: "43.75",
      exchange_rate: "0.875000000000000000",
      rate_source: "carrying_value",
    });
    expect(
      refreshed.lines.find((l) => l.account_id === expense.id),
    ).toMatchObject({
      amount: "50.00",
      book_amount: "40.00",
      exchange_rate: "0.8",
    });
    expect(refreshed.lines.find((l) => l.account_id === fx.id)).toMatchObject({
      side: "debit",
      amount: "3.75",
      book_amount: "3.75",
    });
  });
  it("posts distinct transfer currencies, split spending and owner withdrawal with carried values", () => {
    const { s, bank, sgd, revenue, expense, asset, capital, fx } = fixture();
    append(s, guided(s, "income", sgd.id, revenue.id, "100", "SGD", "0.75"));
    const transfer = buildGuided(s, {
      id: id(),
      kind: "transfer",
      accounting_date: "2026-10-23",
      description: "Convert SGD",
      party_id: null,
      source_id: sgd.id,
      destination_id: bank.id,
      amount: "50",
      currency: "SGD",
      rate: "0.8",
      destination_amount: "40",
      destination_rate: "1",
      splits: [],
      fx_account_id: fx.id,
    });
    expect(transfer.lines.find((l) => l.account_id === sgd.id)).toMatchObject({
      side: "credit",
      amount: "50.00",
      currency_code: "SGD",
      book_amount: "37.50",
    });
    expect(transfer.lines.find((l) => l.account_id === bank.id)).toMatchObject({
      side: "debit",
      amount: "40.00",
      currency_code: "USD",
      exchange_rate: "1",
      book_amount: "40.00",
    });
    expect(transfer.lines.find((l) => l.account_id === fx.id)).toMatchObject({
      side: "credit",
      book_amount: "2.50",
    });
    append(s, transfer);
    const returnTransfer = buildGuided(s, {
      id: id(),
      kind: "transfer",
      accounting_date: "2026-10-23",
      description: "Receive SGD",
      party_id: null,
      source_id: bank.id,
      destination_id: sgd.id,
      amount: "5",
      currency: "USD",
      rate: "1",
      destination_amount: "6.25",
      destination_rate: "0.8",
      splits: [],
    });
    expect(
      returnTransfer.lines.find((l) => l.account_id === sgd.id),
    ).toMatchObject({
      side: "debit",
      amount: "6.25",
      currency_code: "SGD",
      exchange_rate: "0.8",
      book_amount: "5.00",
    });
    append(s, returnTransfer);
    const split = buildGuided(s, {
      id: id(),
      kind: "expense",
      accounting_date: "2026-10-23",
      description: "Split purchase",
      party_id: null,
      source_id: bank.id,
      destination_id: "",
      amount: "30",
      currency: "USD",
      rate: "1",
      splits: [
        { account_id: expense.id, amount: "20" },
        { account_id: asset.id, amount: "10" },
      ],
    });
    expect(split.lines).toHaveLength(3);
    expect(split.lines.find((l) => l.account_id === expense.id)).toMatchObject({
      side: "debit",
      amount: "20.00",
      book_amount: "20.00",
    });
    expect(split.lines.find((l) => l.account_id === asset.id)).toMatchObject({
      side: "debit",
      amount: "10.00",
      book_amount: "10.00",
    });
    append(s, split);
    const withdrawal = guided(s, "withdrawal", bank.id, capital.id, "5");
    expect(
      withdrawal.lines.find((l) => l.account_id === capital.id),
    ).toMatchObject({ side: "debit", amount: "5.00" });
    append(s, withdrawal);
    expect(accountBalance(s, bank.id)).toEqual({
      native: "0.00",
      book: "0.00",
    });
    expect(reports(s)).toMatchObject({
      expenses: "17.50",
      revenue: "75.00",
      contributedEquity: "-5.00",
    });
  });
  it("opens receivable and payable items against equity without new income or expense", () => {
    const { s, ar, capital } = fixture(),
      ap = account("Supplier SGD", "liability", "payable", "SGD");
    s.accounts.push(ap);
    const receivable = guided(
      s,
      "opening_balance",
      capital.id,
      ar.id,
      "100",
      "SGD",
      "0.75",
    );
    expect(receivable.obligation?.recognition_line_id).toBe(
      receivable.lines.find((l) => l.account_id === ar.id)?.id,
    );
    append(s, receivable);
    const payable = guided(
      s,
      "opening_balance",
      ap.id,
      capital.id,
      "40",
      "SGD",
      "0.75",
    );
    expect(payable.obligation?.recognition_line_id).toBe(
      payable.lines.find((l) => l.account_id === ap.id)?.id,
    );
    append(s, payable);
    expect(
      openItems(s).map((x) => ({
        role: x.account.role,
        native: x.outstanding,
        book: x.outstanding_book,
      })),
    ).toEqual([
      { role: "receivable", native: "100.00", book: "75.00" },
      { role: "payable", native: "40.00", book: "30.00" },
    ]);
    expect(reports(s)).toMatchObject({
      revenue: "0.00",
      expenses: "0.00",
      assets: "75.00",
      liabilities: "30.00",
      equity: "45.00",
    });
  });
  it("uses each workspace’s calendar date at a UTC boundary", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-23T17:30:00Z"));
      expect(workspaceToday("UTC")).toBe("2026-10-23");
      expect(workspaceToday("Asia/Bangkok")).toBe("2026-10-24");
      expect(workspaceToday("Asia/Yangon")).toBe("2026-10-24");
      expect(workspaceToday("Asia/Singapore")).toBe("2026-10-24");
    } finally {
      vi.useRealTimers();
    }
  });
});
