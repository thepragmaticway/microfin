import { describe, expect, it } from "vitest";
import {
  buildManual,
  previewManual,
  type ManualInput,
  type ManualLine,
} from "../../src/lib/manual-journal";
import type {
  Account,
  Currency,
  EventInput,
  Snapshot,
} from "../../src/lib/types";

const id = () => crypto.randomUUID();
function fixture() {
  const workspace = id();
  const make = (
    name: string,
    type: Account["type"],
    code: Currency | null,
    role: Account["role"] = "general",
  ): Account => ({
    id: id(),
    workspace_id: workspace,
    name,
    type,
    role,
    currency_code: code,
    is_active: true,
  });
  const bank = make("USD bank", "asset", "USD", "bank"),
    sgd = make("SGD bank", "asset", "SGD", "bank"),
    mmk = make("MMK salary", "expense", "MMK"),
    thb = make("THB salary", "expense", "THB"),
    mmkPayable = make("MMK payroll liability", "liability", "MMK"),
    thbPayable = make("THB payroll liability", "liability", "THB"),
    any = make("Other expense", "expense", null),
    fx = make("FX gain", "revenue", "USD"),
    control = make("Supplier THB", "liability", "THB", "payable");
  const s: Snapshot = {
    workspace: {
      id: workspace,
      owner_user_id: id(),
      name: "Manual",
      kind: "business",
      functional_currency_code: "USD",
      timezone: "Asia/Bangkok",
      created_at: "2026-10-24",
    },
    accounts: [bank, sgd, mmk, thb, mmkPayable, thbPayable, any, fx, control],
    parties: [],
    transactions: [],
    lines: [],
    obligations: [],
    settlements: [],
  };
  const row = (
    a: Account,
    side: ManualLine["side"],
    amount: string,
    exchange_rate = "1",
    currency_code = a.currency_code ?? "USD",
  ): ManualLine => ({
    id: id(),
    account_id: a.id,
    side,
    amount,
    exchange_rate,
    currency_code,
  });
  const input = (lines: ManualLine[]): ManualInput => ({
    id: id(),
    description: "Manual payroll",
    accounting_date: "2026-10-24",
    party_id: null,
    lines,
  });
  const append = (event: EventInput) => {
    s.transactions.push({
      id: event.id,
      workspace_id: workspace,
      accounting_date: event.accounting_date,
      description: event.description,
      kind: event.kind,
      party_id: null,
      posted_at: "2026-10-24T00:00:00Z",
      reversal_of_id: null,
      created_at: "2026-10-24T00:00:00Z",
    });
    s.lines.push(
      ...event.lines.map((l) => ({
        ...l,
        workspace_id: workspace,
        transaction_id: event.id,
      })),
    );
  };
  return {
    s,
    bank,
    sgd,
    mmk,
    thb,
    mmkPayable,
    thbPayable,
    any,
    fx,
    control,
    row,
    input,
    append,
  };
}
describe("manual journals", () => {
  it("records direct THB and MMK salary expenses against one USD bank credit without creating payables", () => {
    const f = fixture();
    const input = f.input([
      f.row(f.mmk, "debit", "2000000", "0.00025"),
      f.row(f.thb, "debit", "30000", "0.03"),
      f.row(f.bank, "credit", "1400"),
    ]);
    const posted = buildManual(f.s, input, true);
    expect(posted.lines).toHaveLength(3);
    expect(posted.lines.find((l) => l.account_id === f.bank.id)).toMatchObject({
      side: "credit",
      amount: "1400.00",
      currency_code: "USD",
      book_amount: "1400.00",
      exchange_rate: "1",
    });
    expect(previewManual(f.s, input.lines)).toMatchObject({
      debits: "1400.00",
      credits: "1400.00",
      difference: "0.00",
    });
    expect(posted.obligation).toBeNull();
    expect(posted.settlements).toEqual([]);
  });
  it("recognizes four-line mixed payroll and settles the two liabilities in one three-line entry", () => {
    const f = fixture();
    const original = f.input([
      f.row(f.mmk, "debit", "2000000", "0.00025"),
      f.row(f.thb, "debit", "30000", "0.03"),
      f.row(f.mmkPayable, "credit", "2000000", "0.00025"),
      f.row(f.thbPayable, "credit", "30000", "0.03"),
    ]);
    const accrued = buildManual(f.s, original, true);
    expect(accrued.kind).toBe("adjustment");
    expect(accrued.lines).toHaveLength(4);
    expect(accrued.lines.find((l) => l.account_id === f.mmk.id)).toMatchObject({
      amount: "2000000.00",
      book_amount: "500.00",
      exchange_rate: "0.00025",
    });
    expect(accrued.lines.find((l) => l.account_id === f.thb.id)).toMatchObject({
      amount: "30000.00",
      book_amount: "900.00",
      exchange_rate: "0.03",
    });
    f.append(accrued);
    const payment = f.input([
      f.row(f.mmkPayable, "debit", "2000000", "99"),
      f.row(f.thbPayable, "debit", "30000", "99"),
      f.row(f.bank, "credit", "1400"),
    ]);
    const paid = buildManual(f.s, payment, true);
    expect(paid.lines).toHaveLength(3);
    expect(
      paid.lines.find((l) => l.account_id === f.mmkPayable.id),
    ).toMatchObject({ book_amount: "500.00", rate_source: "carrying_value" });
    expect(
      paid.lines.find((l) => l.account_id === f.thbPayable.id),
    ).toMatchObject({ book_amount: "900.00", rate_source: "carrying_value" });
    expect(previewManual(f.s, payment.lines)).toMatchObject({
      debits: "1400.00",
      credits: "1400.00",
      difference: "0.00",
    });
    expect(payment.lines[0].exchange_rate).toBe("99");
  });
  it("preserves draft and line identities, allows a difference only as a draft and never plugs it", () => {
    const f = fixture();
    const input = f.input([
      f.row(f.any, "debit", "30000", "0.03", "THB"),
      f.row(f.bank, "credit", "800"),
    ]);
    const draft = buildManual(f.s, input, false);
    expect(draft.id).toBe(input.id);
    expect(new Set(draft.lines.map((l) => l.id))).toEqual(
      new Set(input.lines.map((l) => l.id)),
    );
    expect(draft.lines).toHaveLength(2);
    expect(previewManual(f.s, input.lines)).toMatchObject({
      debits: "900.00",
      credits: "800.00",
      difference: "100.00",
    });
    expect(() => buildManual(f.s, input, true)).toThrow(/must balance/);
    input.lines[1].amount = "900";
    const posted = buildManual(f.s, input, true);
    expect(posted.id).toBe(draft.id);
    f.append(posted);
    expect(() => buildManual(f.s, input, false)).toThrow(/reversal/);
  });
  it("retains exact foreign carried values and requires an explicit FX line", () => {
    const f = fixture();
    f.append(
      buildManual(
        f.s,
        f.input([
          f.row(f.sgd, "debit", "100", "0.75"),
          f.row(f.fx, "credit", "75"),
        ]),
        true,
      ),
    );
    const input = f.input([
      f.row(f.sgd, "credit", "50", "99"),
      f.row(f.any, "debit", "40"),
    ]);
    expect(previewManual(f.s, input.lines).difference).toBe("2.50");
    expect(() => buildManual(f.s, input, true)).toThrow(/must balance/);
    input.lines.push(f.row(f.fx, "credit", "2.50"));
    const posted = buildManual(f.s, input, true);
    expect(posted.lines.find((l) => l.account_id === f.sgd.id)).toMatchObject({
      amount: "50.00",
      book_amount: "37.50",
      exchange_rate: "0.750000000000000000",
      rate_source: "carrying_value",
    });
    input.lines[0].amount = "101";
    expect(() => previewManual(f.s, input.lines)).toThrow(/exceeds available/);
  });
  it("pools same-event receipts before multiple discharges regardless of row order", () => {
    const f = fixture();
    const rows = [
      f.row(f.sgd, "credit", "2"),
      f.row(f.bank, "credit", "71.25"),
      f.row(f.sgd, "debit", "100", "0.75"),
      f.row(f.sgd, "credit", "3"),
    ];
    const result = previewManual(f.s, rows);
    expect(result.difference).toBe("0.00");
    expect(result.lines.find((l) => l.id === rows[0].id)?.book_amount).toBe(
      "1.50",
    );
    expect(result.lines.find((l) => l.id === rows[3].id)?.book_amount).toBe(
      "2.25",
    );
  });
  it("rejects invalid accounts, currencies, sides, precision, rates and duplicate rows", () => {
    const f = fixture();
    const rows = [
      f.row(f.thb, "debit", "30000", "0.03"),
      f.row(f.bank, "credit", "900"),
    ];
    const invalid: [Partial<ManualLine>, RegExp][] = [
      [{ account_id: f.control.id }, /invoice, bill or payment/],
      [{ account_id: id() }, /active account/],
      [{ currency_code: "SGD" }, /Currency must match/],
      [{ amount: "0" }, /greater than zero/],
      [{ amount: "1e3" }, /greater than zero/],
      [{ amount: "1.001" }, /decimal places/],
      [{ exchange_rate: "0" }, /positive exchange rate/],
      [{ side: "invalid" as ManualLine["side"] }, /debit or credit/],
    ];
    for (const [change, error] of invalid)
      expect(() =>
        previewManual(f.s, [{ ...rows[0], ...change }, rows[1]]),
      ).toThrow(error);
    f.thb.is_active = false;
    expect(() => previewManual(f.s, rows)).toThrow(/active account/);
    expect(() => previewManual(f.s, [rows[1], rows[1]])).toThrow(/unique/);
    expect(() => previewManual(f.s, [rows[1]])).toThrow(/2 and 100/);
    expect(() =>
      previewManual(
        f.s,
        Array.from({ length: 101 }, () => ({ ...rows[1], id: id() })),
      ),
    ).toThrow(/2 and 100/);
  });
});
