import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountingCommandInput, sameRequest, sourceRequest } from "../../src/lib/accounting/contracts";
import { saveEventInput } from "../../src/lib/contracts";
import { buildRecognition } from "../../src/lib/accounting/recognition";
import { transferRate } from "../../src/lib/accounting/settlement";
import { buildInvoiceOrBill } from "../../src/lib/modules/invoicing";
import { prepareBookkeeping, guidedChoices } from "../../src/lib/modules/bookkeeping";
import { buildPayrollAccrual, buildPayrollPayment, payrollAccrualInput, payrollPaymentInput } from "../../src/lib/modules/payroll";
import { openItems, reports } from "../../src/lib/reports";
import type { Account, Currency, EventInput, Snapshot } from "../../src/lib/types";

let sequence = 1;
const id = () => "00000000-0000-4000-8000-" + (sequence++).toString(16).padStart(12, "0");
beforeEach(() => { sequence = 1; vi.spyOn(crypto, "randomUUID").mockImplementation(id); });
afterEach(() => vi.restoreAllMocks());
function fixture(home: Currency = "THB", salary: Currency = "MMK", funding: Currency = "THB") {
  const workspace = id(), employee = id();
  const account = (name: string, type: Account["type"], role: Account["role"], currency_code: Currency | null): Account =>
    ({id: id(), workspace_id: workspace, name, type, role, currency_code, is_active: true});
  const bank = account("Bank", "asset", "bank", funding);
  const payable = account("Salary payable", "liability", "payable", salary);
  const expense = account("Salary expense", "expense", "general", null);
  const capital = account("Capital", "equity", "general", null);
  const fx = account("FX", "expense", "general", null);
  const fee = account("Fees", "expense", "general", null);
  const s: Snapshot = {
    workspace: {id: workspace, owner_user_id: id(), name: "Test", kind: "business", functional_currency_code: home, timezone: "UTC", created_at: "2026-01-01"},
    accounts: [bank, payable, expense, capital, fx, fee],
    parties: [{id: employee, workspace_id: workspace, name: "Employee"}],
    transactions: [], lines: [], obligations: [], settlements: [],
  };
  const eventId = id();
  const openingRate = funding === home ? "1" : "0.75";
  append(s, {
    id: eventId, kind: "contribution", description: "Opening", accounting_date: "2026-01-01", party_id: null, obligation: null, settlements: [],
    lines: [
      {id: id(), account_id: bank.id, side: "debit", amount: "100000.00", currency_code: funding, exchange_rate: openingRate, book_amount: funding === home ? "100000.00" : "75000.00", rate_source: funding === home ? null : "manual"},
      {id: id(), account_id: capital.id, side: "credit", amount: "100000.00", currency_code: funding, exchange_rate: openingRate, book_amount: funding === home ? "100000.00" : "75000.00", rate_source: funding === home ? null : "manual"},
    ],
  });
  const request = payrollAccrualInput.parse({
    id: id(), source_id: id(), employee_party_id: employee, period: "2026-10",
    accounting_date: "2026-10-31", description: "October salary",
    payable_account_id: payable.id, expense_account_id: expense.id,
    amount: "2000000", currency_code: salary, exchange_rate: salary === home ? "1" : "0.01",
  });
  return {s, employee, bank, payable, expense, capital, fx, fee, request};
}
function append(s: Snapshot, e: EventInput, reversalOf: string | null = null) {
  s.transactions.push({id: e.id, workspace_id: s.workspace.id, accounting_date: e.accounting_date, description: e.description, kind: e.kind, party_id: e.party_id, posted_at: "2026-11-01T00:00:00Z", reversal_of_id: reversalOf, created_at: "2026-11-01T00:00:00Z"});
  s.lines.push(...e.lines.map((l) => ({...l, workspace_id: s.workspace.id, transaction_id: e.id})));
  if (e.obligation) s.obligations.push({...e.obligation, workspace_id: s.workspace.id});
  s.settlements.push(...e.settlements.map((st) => ({...st, workspace_id: s.workspace.id})));
}
function accrue(f: ReturnType<typeof fixture>) {
  const event = buildPayrollAccrual(f.s, f.request);
  append(f.s, event);
  return {event, source: {id: f.request.source_id, employee_party_id: f.employee, period: f.request.period, recognition_obligation_id: event.obligation!.id}};
}
function payment(f: ReturnType<typeof fixture>, amount = "1000000", paid = "8000") {
  return payrollPaymentInput.parse({
    id: id(), source_id: f.request.source_id, operation_id: id(),
    accounting_date: "2026-11-01", description: "Salary payment",
    allocations: [{amount, funding_account_id: f.bank.id, funding_amount: paid, funding_rate: "1", provider: "Mobile transfer", provider_rate: "124.9", reference: "Transfer ref"}],
    fx_account_id: f.fx.id,
  });
}

describe("extension request contracts and operation identity (A2/A3)", () => {
  it("normalizes amounts, excludes only the transport ID and compares object key order independently", () => {
    const f = fixture();
    const a = sourceRequest(f.request);
    const b = sourceRequest({...f.request, id: id()});
    expect(a).not.toHaveProperty("id");
    expect(a).toHaveProperty("source_id", f.request.source_id);
    expect(a.amount).toBe("2000000.00");
    expect(sameRequest(a, Object.fromEntries(Object.entries(b).reverse()))).toBe(true);
    expect(sameRequest(a, {...b, amount: "1.00"})).toBe(false);
    expect(sameRequest(a, {...b, source_id: id()})).toBe(false);
    expect(sameRequest([a, b], [b, {changed: true}])).toBe(false);
  });
  it.each(["0", "-1", "1.001", "NaN", "Infinity"])("rejects invalid salary amount %s", (amount) => {
    const f = fixture();
    expect(payrollAccrualInput.safeParse({...f.request, amount}).success).toBe(false);
  });
  it("rejects unknown fields, invalid periods, empty allocations and invalid provider rates", () => {
    const f = fixture();
    expect(payrollAccrualInput.safeParse({...f.request, period: "2026-13"}).success).toBe(false);
    expect(payrollAccrualInput.safeParse({...f.request, paid: true}).success).toBe(false);
    const p = payment(f);
    expect(payrollPaymentInput.safeParse({...p, allocations: []}).success).toBe(false);
    expect(payrollPaymentInput.safeParse({...p, allocations: [{...p.allocations[0], provider_rate: "0"}]}).success).toBe(false);
    expect(accountingCommandInput.safeParse({type: "manual", post: true, input: {id: id(), accounting_date: "2026-10-31", description: "x", party_id: null, lines: []}}).success).toBe(false);
    expect(accountingCommandInput.safeParse({type: "payment", post: false, input: {...p, allocations: []}}).success).toBe(false);
  });
});

describe("shared recognition and application adapters (A1/A2)", () => {
  it("recognizes payroll as a generic payable, preserving salary currency and historical home values", () => {
    const f = fixture(), event = buildPayrollAccrual(f.s, f.request);
    expect(event.kind).toBe("recognition");
    expect(event.party_id).toBe(f.employee);
    expect(event.lines.find((l) => l.account_id === f.payable.id)).toMatchObject({side: "credit", amount: "2000000.00", currency_code: "MMK", book_amount: "20000.00", exchange_rate: "0.01"});
    expect(event.lines.find((l) => l.account_id === f.expense.id)).toMatchObject({side: "debit", book_amount: "20000.00"});
    expect(event).not.toHaveProperty("period");
  });
  it("invoice and bill adapters use generic recognition with their existing presentation kinds and splits", () => {
    const f = fixture("THB", "THB");
    const secondExpense = {...f.expense, id: id()};
    f.s.accounts.push(secondExpense);
    const bill = buildInvoiceOrBill(f.s, {id: id(), kind: "bill", accounting_date: "2026-10-31", description: "Supplier bill", party_id: f.employee, source_id: f.payable.id, destination_id: "", amount: "100", currency: "THB", rate: "1", splits: [{account_id: f.expense.id, amount: "60"}, {account_id: secondExpense.id, amount: "40"}]});
    expect(bill.kind).toBe("bill");
    expect(bill.lines).toHaveLength(3);
    expect(bill.obligation?.recognition_line_id).toBe(bill.lines[0].id);
    f.payable.role = "receivable"; f.payable.type = "asset";
    f.expense.type = "revenue";
    const invoice = buildInvoiceOrBill(f.s, {id: id(), kind: "invoice", accounting_date: "2026-10-31", description: "Customer invoice", party_id: f.employee, source_id: f.payable.id, destination_id: f.expense.id, amount: "100", currency: "THB", rate: "1", splits: []});
    expect(invoice.lines[0]).toMatchObject({side: "debit", amount: "100.00", book_amount: "100.00", exchange_rate: "1", rate_source: null});
  });
  it("rejects inactive/wrong controls, incompatible categories and forged counterparties", () => {
    const f = fixture();
    f.payable.is_active = false;
    expect(() => buildPayrollAccrual(f.s, f.request)).toThrow(/control account/);
    f.payable.is_active = true; f.payable.role = "bank";
    expect(() => buildPayrollAccrual(f.s, f.request)).toThrow(/payable/);
    f.payable.role = "payable"; f.expense.type = "revenue";
    expect(() => buildPayrollAccrual(f.s, f.request)).toThrow(/category/);
    f.expense.type = "expense";
    expect(() => buildPayrollAccrual(f.s, {...f.request, employee_party_id: id()})).toThrow(/counterparty/);
    expect(() => buildRecognition(f.s, {id: id(), accounting_date: "2026-10-31", description: "x", party_id: f.employee, control_account_id: f.payable.id, category_account_id: f.expense.id, amount: "10", currency_code: "SGD", exchange_rate: "1"})).toThrow(/currency/);
  });
});

describe("payroll settlement reuses accounting calculations (A4)", () => {
  it.each(["THB", "SGD", "MMK", "USD"] as const)("recognizes and fully clears a %s salary through the same contract", (code) => {
    const f = fixture("THB", code, "THB");
    f.request.amount = "100.00";
    const {source} = accrue(f);
    const prepared = buildPayrollPayment(f.s, source, payment(f, "100", "100"));
    append(f.s, prepared.event);
    expect(openItems(f.s)[0]).toMatchObject({state: "paid", outstanding: "0.00", outstanding_book: "0.00"});
    expect(prepared.transfers[0]).toMatchObject({source_currency: "THB", target_currency: code});
  });
  it("uses received amounts to discharge salary, keeps fees separate and records actual/provider rates as evidence", () => {
    const f = fixture(), {source} = accrue(f);
    const p = {...payment(f), fee: {amount: "100", rate: "1", account_id: f.fee.id, funding_account_id: f.bank.id}};
    const prepared = buildPayrollPayment(f.s, source, p);
    append(f.s, prepared.event);
    expect(openItems(f.s)[0]).toMatchObject({outstanding: "1000000.00", outstanding_book: "10000.00"});
    expect(prepared.transfers[0]).toMatchObject({source_currency: "THB", target_currency: "MMK", effective_rate: "125.000000000000000000", provider_rate: "124.9"});
    expect(prepared.event.lines.find((l) => l.account_id === f.fee.id)).toMatchObject({side: "debit", amount: "100.00", book_amount: "100.00"});
    expect(reports(f.s).expenses).toBe("18100.00"); // Salary 20,000 + fee 100 - FX gain 2,000.
    expect(reports(f.s).liabilities).toBe("10000.00");
  });
  it("leaves a short receipt outstanding and prevents overpayment or another source from being settled", () => {
    const f = fixture(), {source} = accrue(f);
    const p = payment(f, "1990000", "16000");
    append(f.s, buildPayrollPayment(f.s, source, p).event);
    expect(openItems(f.s)[0].outstanding).toBe("10000.00");
    expect(() => buildPayrollPayment(f.s, source, payment(f, "10001", "100"))).toThrow(/exceeds/);
    expect(() => buildPayrollPayment(f.s, {...source, id: id()}, payment(f))).toThrow(/source/);
    expect(() => buildPayrollPayment(f.s, {...source, employee_party_id: id()}, payment(f, "1", "1"))).toThrow(/obligation/);
  });
  it("supports split funding, final settlement and payment reversal without recognizing salary twice", () => {
    const f = fixture(), {source} = accrue(f);
    const p = payment(f);
    p.allocations = [{...p.allocations[0], amount: "600000", funding_amount: "6000"}, {...p.allocations[0], amount: "400000", funding_amount: "4000"}];
    append(f.s, buildPayrollPayment(f.s, source, p).event);
    const final = buildPayrollPayment(f.s, source, payment(f, "1000000", "10000")).event;
    append(f.s, final);
    expect(openItems(f.s)[0]).toMatchObject({state: "paid", outstanding: "0.00", outstanding_book: "0.00"});
    expect(reports(f.s).expenses).toBe("20000.00");
    append(f.s, {...final, id: id(), kind: "reversal", obligation: null, settlements: [], lines: final.lines.map((l) => ({...l, id: id(), side: l.side === "debit" ? "credit" : "debit"}))}, final.id);
    expect(openItems(f.s)[0].outstanding).toBe("1000000.00");
    expect(reports(f.s).expenses).toBe("20000.00");
  });
  it.each([
    ["SGD", "100", "2500.00", "50.00", "25", "manual"],
    ["THB", "2500", "2500.00", "2.00", "1", null],
  ] as const)("uses declared fresh card valuation for %s funding, with home currency fixed at rate one", (currency, native, principalBook, feeBook, expectedRate, rateSource) => {
    const f = fixture("THB", "THB");
    f.request.amount = "2500.00";
    const {source} = accrue(f);
    const card: Account = {...f.bank, id: id(), name: "Salary card", type: "liability", role: "credit_card", currency_code: currency};
    f.s.accounts.push(card);
    const p = payment(f, "2500", native);
    p.allocations[0].funding_account_id = card.id;
    p.allocations[0].funding_rate = "25";
    const event = buildPayrollPayment(f.s, source, {...p, fee: {account_id: f.fee.id, funding_account_id: card.id, amount: "2", rate: "25"}}).event;
    expect(event.lines.find((l) => l.account_id === card.id && l.amount === native + ".00")).toMatchObject({side: "credit", book_amount: principalBook, exchange_rate: expectedRate, rate_source: rateSource});
    expect(event.lines.find((l) => l.account_id === card.id && l.amount === "2.00")).toMatchObject({side: "credit", book_amount: feeBook, exchange_rate: expectedRate, rate_source: rateSource});
    expect(event.lines.find((l) => l.account_id === f.fee.id)).toMatchObject({side: "debit", book_amount: feeBook, exchange_rate: expectedRate, rate_source: rateSource});
    expect(event.lines).toHaveLength(4);
  });
  it("retains foreign bank carrying values when source, employee and reporting currencies differ", () => {
    const f = fixture("USD", "THB", "SGD");
    f.request.amount = "100"; f.request.exchange_rate = "0.03";
    const {source} = accrue(f);
    const p = payment(f, "100", "4");
    p.allocations[0].funding_rate = "9";
    const prepared = buildPayrollPayment(f.s, source, p);
    expect(prepared.event.lines.find((l) => l.account_id === f.bank.id)).toMatchObject({currency_code: "SGD", amount: "4.00", book_amount: "3.00", exchange_rate: "0.750000000000000000", rate_source: "carrying_value"});
    expect(prepared.event.lines.find((l) => l.account_id === f.payable.id)).toMatchObject({currency_code: "THB", book_amount: "3.00"});
    expect(prepared.event.lines.some((l) => l.account_id === f.fx.id)).toBe(false);
    expect(prepared.transfers[0].effective_rate).toBe("25.000000000000000000");
  });
  it("assigns the final carrying remainder, including a zero-book-value first payment", () => {
    const f = fixture();
    f.request.amount = "0.03"; f.request.exchange_rate = "0.333333333333333333";
    const {source} = accrue(f);
    const first = buildPayrollPayment(f.s, source, payment(f, "0.01", "0.01")).event;
    expect(first.lines.find((l) => l.account_id === f.payable.id)?.book_amount).toBe("0.00");
    append(f.s, first);
    const last = buildPayrollPayment(f.s, source, payment(f, "0.02", "0.01")).event;
    expect(last.lines.find((l) => l.account_id === f.payable.id)?.book_amount).toBe("0.01");
    append(f.s, last);
    expect(openItems(f.s)[0].outstanding_book).toBe("0.00");
  });
  it("validates positive transfer evidence inputs", () => {
    expect(transferRate("16000", "2000000")).toBe("125.000000000000000000");
    expect(Number(transferRate("99999999999999999999", "0.01"))).toBeGreaterThan(0);
    expect(() => transferRate("0", "1")).toThrow(/positive/);
    expect(() => transferRate("1", "-1")).toThrow(/positive/);
  });
});

describe("authoritative guided intent decisions (A1)", () => {
  it("shares permitted account choices with previews and rejects forged kind/account combinations", () => {
    const f = fixture();
    const input = {id: id(), kind: "expense" as const, accounting_date: "2026-10-31", description: "Expense", party_id: null, source_id: f.bank.id, destination_id: f.expense.id, amount: "10", currency: "THB" as const, rate: "1", splits: []};
    expect(guidedChoices(f.s, "expense").target).toContain(f.expense);
    expect(prepareBookkeeping(f.s, {type: "guided", post: true, input}).kind).toBe("expense");
    expect(() => prepareBookkeeping(f.s, {type: "guided", post: true, input: {...input, source_id: f.expense.id}})).toThrow(/source account/);
    expect(() => prepareBookkeeping(f.s, {type: "guided", post: true, input: {...input, destination_id: f.capital.id}})).toThrow(/destination account/);
    expect(() => prepareBookkeeping(f.s, {type: "guided", post: true, input: {...input, splits: [{account_id: f.capital.id, amount: "10"}]}})).toThrow(/destination account/);
  });
});

describe("legacy-compatible actual posting budgets (A1/A5)", () => {
  it("accepts 50 simple payment pairs and 49 pairs with a fee, rejecting actual fee/FX overflow", () => {
    const f = fixture("THB", "THB", "THB"), {event: salary} = accrue(f);
    const allocation = {obligation_id: salary.obligation!.id, amount: "1", funding_account_id: f.bank.id, funding_amount: "1", funding_rate: "1"};
    const input = {id: id(), accounting_date: "2026-11-01", description: "Boundary payment", allocations: Array.from({length: 50}, () => ({...allocation})), fx_account_id: f.fx.id};
    const command = accountingCommandInput.parse({type: "payment", post: true, input});
    const event = prepareBookkeeping(f.s, command);
    expect(event.lines).toHaveLength(100);
    expect(event.settlements).toHaveLength(50);
    expect(saveEventInput.safeParse({event, post: true}).success).toBe(true);
    expect(accountingCommandInput.safeParse({type: "payment", post: true, input: {...input, allocations: [...input.allocations, allocation]}}).success).toBe(false);
    const fee = {account_id: f.fee.id, funding_account_id: f.bank.id, amount: "1", rate: "1"};
    const withFee = prepareBookkeeping(f.s, accountingCommandInput.parse({type: "payment", post: true, input: {...input, fee}}));
    expect(withFee.lines).toHaveLength(102);
    expect(saveEventInput.safeParse({event: withFee, post: true}).success).toBe(false);
    const fitsFee = prepareBookkeeping(f.s, accountingCommandInput.parse({type: "payment", post: true, input: {...input, allocations: input.allocations.slice(0, 49), fee}}));
    expect(fitsFee.lines).toHaveLength(100);
    expect(saveEventInput.safeParse({event: fitsFee, post: true}).success).toBe(true);
    const withFx = prepareBookkeeping(f.s, accountingCommandInput.parse({type: "payment", post: true, input: {...input, allocations: input.allocations.map((a) => ({...a, funding_amount: "2"}))}}));
    expect(withFx.lines).toHaveLength(101);
    expect(saveEventInput.safeParse({event: withFx, post: true}).success).toBe(false);
  });
  it("accepts 99 simple category splits and counts only FX lines actually produced", () => {
    const f = fixture();
    const split = {account_id: f.expense.id, amount: "1"};
    const input = {id: id(), kind: "expense" as const, accounting_date: "2026-10-31", description: "Boundary split", party_id: null, source_id: f.bank.id, destination_id: "", amount: "99", currency: "THB" as const, rate: "1", splits: Array.from({length: 99}, () => ({...split})), fx_account_id: f.fx.id};
    const event = prepareBookkeeping(f.s, accountingCommandInput.parse({type: "guided", post: true, input}));
    expect(event.lines).toHaveLength(100);
    expect(saveEventInput.safeParse({event, post: true}).success).toBe(true);
    expect(accountingCommandInput.safeParse({type: "guided", post: true, input: {...input, splits: [...input.splits, split]}}).success).toBe(false);
    const withFx = prepareBookkeeping(f.s, accountingCommandInput.parse({type: "guided", post: true, input: {...input, amount: "100"}}));
    expect(withFx.lines).toHaveLength(101);
    expect(saveEventInput.safeParse({event: withFx, post: true}).success).toBe(false);
    const fitsFx = prepareBookkeeping(f.s, accountingCommandInput.parse({type: "guided", post: true, input: {...input, splits: input.splits.slice(0, 98)}}));
    expect(fitsFx.lines).toHaveLength(100);
    expect(saveEventInput.safeParse({event: fitsFx, post: true}).success).toBe(true);
  });
  it("uses the same actual budget for the new payroll adapter", () => {
    const f = fixture("THB", "THB", "THB"), {source} = accrue(f);
    const base = payment(f, "1", "1");
    const input = {...base, allocations: Array.from({length: 50}, () => ({...base.allocations[0]}))};
    const parsed = payrollPaymentInput.parse(input);
    const {event} = buildPayrollPayment(f.s, source, parsed);
    expect(event.lines).toHaveLength(100);
    expect(saveEventInput.safeParse({event, post: true}).success).toBe(true);
    expect(payrollPaymentInput.safeParse({...input, allocations: [...input.allocations, input.allocations[0]]}).success).toBe(false);
  });
});
