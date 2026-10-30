import {after, before, test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {asUser, localStack, uid1, uid2} from "../../scripts/local-stack.mjs";
import {uuid, event} from "../fixtures/ledger.mjs";

let stack, db;
const extensionSQL = await readFile("supabase/migrations/202610300001_accounting_extensions.sql", "utf8");
const rpcOn = (client, user, name, args) => asUser(client, user, (c) => c.query("select public." + name + "(" + args.map((_, i) => "$" + (i + 1)).join(",") + ")", args));
const rpc = (name, args, user = uid1) => rpcOn(db, user, name, args);
const value = (result) => Object.values(result.rows[0])[0];
const l = (account, side, amount, code = "THB", rate = "1", book = amount, source = code === "THB" ? null : "manual") =>
  ({id: uuid(), account_id: account, side, amount, currency_code: code, exchange_rate: rate, book_amount: book, rate_source: source});
async function fixture(home = "THB", salary = "MMK", funding = "THB") {
  const w = uuid(), employee = uuid();
  await rpc("create_workspace", [{id: w, name: "Extension tests", kind: "business", functional_currency_code: home, timezone: "UTC"}]);
  const accounts = {};
  for (const [name, type, role, code] of [
    ["bank", "asset", "bank", funding], ["payable", "liability", "payable", salary],
    ["expense", "expense", "general", null], ["fx", "expense", "general", null],
    ["fee", "expense", "general", null], ["capital", "equity", "general", null],
  ]) {
    const id = uuid(); accounts[name] = id;
    await rpc("save_account", [w, {id, name, type, role, currency_code: code, is_active: true}]);
  }
  await rpc("save_party", [w, {id: employee, name: "Example employee"}]);
  const opening = funding === home
    ? [l(accounts.bank, "debit", "100000", funding, "1", "100000", null), l(accounts.capital, "credit", "100000", home, "1", "100000", null)]
    : [l(accounts.bank, "debit", "100000", funding, "0.75", "75000", "manual"), l(accounts.capital, "credit", "75000", home, "1", "75000", null)];
  await rpc("save_event", [w, event("contribution", opening), true]);
  return {w, employee, ...accounts, home, salary, funding};
}
function accrual(f, overrides = {}) {
  const request = {source_id: uuid(), employee_party_id: f.employee, period: "2026-10", accounting_date: "2026-10-31", description: "October salary", payable_account_id: f.payable, expense_account_id: f.expense, amount: "2000000.00", currency_code: f.salary, exchange_rate: f.salary === f.home ? "1" : "0.01", ...overrides};
  const rate = f.salary === f.home ? "1" : request.exchange_rate;
  const book = request.amount === "2000000.00" ? "20000" : request.amount === "100.00" ? "3" : "100";
  const actualBook = f.salary === f.home ? request.amount : book;
  const control = l(f.payable, "credit", request.amount, f.salary, rate, actualBook, f.salary === f.home ? null : "manual");
  const p = event("recognition", [control, l(f.expense, "debit", request.amount, f.salary, rate, actualBook, f.salary === f.home ? null : "manual")], {
    accounting_date: request.accounting_date, description: request.description, party_id: request.employee_party_id,
    obligation: {id: uuid(), recognition_line_id: control.id, reference: null, due_date: null},
  });
  return {request, p};
}
const record = (f, a) => rpc("save_payroll_accrual", [f.w, a.request, a.p]);
function pay(f, a, {amount = "1000000.00", funded = "8000.00", clearedBook = "10000.00", fundingBook = funded, fee = false, operation = uuid()} = {}) {
  const request = {
    source_id: a.request.source_id, operation_id: operation, accounting_date: "2026-11-01", description: "Pay salary",
    allocations: [{amount, funding_account_id: f.bank, funding_amount: funded, funding_rate: f.funding === f.home ? "1" : "0.75", provider: "Mobile transfer", provider_rate: "124.9", reference: "Actual receipt"}],
    fx_account_id: f.fx,
    ...(fee ? {fee: {account_id: f.fee, funding_account_id: f.bank, amount: "100.00", rate: "1"}} : {}),
  };
  const clearing = l(f.payable, "debit", amount, f.salary, f.salary === f.home ? "1" : String(Number(clearedBook) / Number(amount)), clearedBook, f.salary === f.home ? null : "carrying_value");
  const funding = l(f.bank, "credit", funded, f.funding, f.funding === f.home ? "1" : "0.75", fundingBook, f.funding === f.home ? null : "carrying_value");
  const lines = [clearing, funding];
  if (fee) lines.push(l(f.bank, "credit", "100"), l(f.fee, "debit", "100"));
  const difference = Number(clearedBook) - Number(fundingBook);
  if (difference) lines.push(l(f.fx, difference > 0 ? "credit" : "debit", String(Math.abs(difference)), f.home, "1", String(Math.abs(difference)), null));
  const p = event("payment", lines, {accounting_date: request.accounting_date, description: request.description, settlements: [{id: uuid(), obligation_id: a.p.obligation.id, clearing_line_id: clearing.id, funding_line_id: funding.id}]});
  return {request, p};
}
const sendPayment = (f, p) => rpc("save_payroll_payment", [f.w, p.request, p.p]);
async function snapshot(w) { return value(await rpc("read_snapshot", [w])); }
async function count(table, w) { return Number((await db.query("select count(*) as n from public." + table + " where workspace_id=$1", [w])).rows[0].n); }
async function remaining(a) {
  return (await db.query("select (r.amount-coalesce(sum(c.amount) filter(where public.event_active(c.transaction_id)),0))::text as native,(r.book_amount-coalesce(sum(c.book_amount) filter(where public.event_active(c.transaction_id)),0))::text as book from obligations o join journal_lines r on r.id=o.recognition_line_id left join settlements st on st.obligation_id=o.id left join journal_lines c on c.id=st.clearing_line_id where o.id=$1 group by r.amount,r.book_amount", [a.p.obligation.id])).rows[0];
}
before(async () => { stack = await localStack({migrationsThrough: "202610260001_financial_scenarios.sql"}); db = stack.db; });
after(async () => { await stack?.stop(); });

test("A5 populated upgrade preserves exact ledger snapshots and legacy RPCs", async () => {
  const f = await fixture();
  const before = await snapshot(f.w);
  await db.query(extensionSQL);
  assert.deepEqual(await snapshot(f.w), before);
  const oldEvent = event("expense", [l(f.expense, "debit", "25"), l(f.bank, "credit", "25")]);
  assert.equal(value(await rpc("save_event", [f.w, oldEvent, true])), oldEvent.id);
  const reverse = uuid();
  assert.equal(value(await rpc("reverse_event", [f.w, oldEvent.id, reverse, "2026-11-01"])), reverse);
  assert.equal(await count("accounting_sources", f.w), 0);
  assert.equal(await count("accounting_operations", f.w), 0);
});

test("A2/A4 payroll recognition, cross-currency partial/final payment, fee evidence and reversals", async () => {
  const f = await fixture(), a = accrual(f);
  assert.equal(value(await record(f, a)), a.p.id);
  assert.equal(await count("payroll_items", f.w), 1);
  const source = (await db.query("select * from payroll_items where id=$1", [a.request.source_id])).rows[0];
  assert.equal(source.employee_party_id, f.employee);
  assert.equal(source.period, "2026-10");
  const first = pay(f, a, {fee: true});
  assert.equal(value(await sendPayment(f, first)), first.p.id);
  assert.deepEqual(await remaining(a), {native: "1000000.00000000", book: "10000.00000000"});
  const evidence = (await db.query("select transfer_evidence from accounting_operations where transaction_id=$1", [first.p.id])).rows[0].transfer_evidence;
  assert.equal(Number(evidence[0].effective_rate), 125);
  assert.equal(evidence[0].provider_rate, "124.9");
  assert.equal(evidence[0].source_currency, "THB"); assert.equal(evidence[0].target_currency, "MMK");
  assert.equal((await db.query("select sum(case side when 'debit' then book_amount else -book_amount end)::text as n from journal_lines where account_id=$1", [f.expense])).rows[0].n, "20000.00000000");
  const last = pay(f, a, {funded: "10000.00", operation: uuid()});
  await sendPayment(f, last);
  assert.deepEqual(await remaining(a), {native: "0.00000000", book: "0.00000000"});
  await assert.rejects(rpc("reverse_event", [f.w, a.p.id, uuid(), "2026-11-02"]), /dependent payments/);
  await rpc("reverse_event", [f.w, last.p.id, uuid(), "2026-11-02"]);
  assert.deepEqual(await remaining(a), {native: "1000000.00000000", book: "10000.00000000"});
  await rpc("reverse_event", [f.w, first.p.id, uuid(), "2026-11-02"]);
  await rpc("reverse_event", [f.w, a.p.id, uuid(), "2026-11-02"]);
});

test("A3 retries ignore fresh transaction IDs, detect changed intent and preserve atomic rollback", async () => {
  const f = await fixture(), a = accrual(f);
  await record(f, a);
  const retry = accrual(f, {...a.request});
  assert.notEqual(retry.p.id, a.p.id);
  assert.equal(value(await record(f, retry)), a.p.id);
  assert.equal(await count("payroll_items", f.w), 1);
  await assert.rejects(record(f, {...a, request: {...a.request, amount: "1999999"}}), /Retry conflicts/);
  const failed = accrual(f);
  failed.p.lines[1].book_amount = "1";
  await assert.rejects(record(f, failed), /Postings must balance/);
  assert.equal(await count("payroll_items", f.w), 1);
  assert.equal(await count("accounting_sources", f.w), 1);
  assert.equal(await count("accounting_operations", f.w), 1);
  const alreadyPosted = accrual(f);
  await rpc("save_event", [f.w, alreadyPosted.p, true]);
  await assert.rejects(record(f, alreadyPosted), /outside this source operation/);
  assert.equal(await count("accounting_sources", f.w), 1);
  const paid = pay(f, a);
  await sendPayment(f, paid);
  assert.equal(value(await sendPayment(f, {...paid, p: {...paid.p, id: uuid()}})), paid.p.id);
  await assert.rejects(sendPayment(f, {...paid, request: {...paid.request, description: "Changed"}}), /Retry conflicts/);
  const over = pay(f, a, {amount: "1000001", funded: "10000", clearedBook: "10000"});
  await assert.rejects(sendPayment(f, over), /exceeds/);
  assert.equal(await count("accounting_operations", f.w), 2);
});

test("A3 concurrent source recognition commits once; different concurrent transfers cannot over-settle", async () => {
  const f = await fixture(), a = accrual(f);
  const other = new pg.Client(db.connectionParameters); await other.connect();
  try {
    const retry = accrual(f, {...a.request});
    const results = await Promise.all([record(f, a), rpcOn(other, uid1, "save_payroll_accrual", [f.w, retry.request, retry.p])]);
    const replies = results.map(value);
    assert.equal(replies[0], replies[1]);
    assert.ok([a.p.id, retry.p.id].includes(replies[0]));
    const winner = replies[0] === a.p.id ? a : retry;
    const persisted = (await db.query("select transaction_id,obligation_id from accounting_operations where workspace_id=$1 and source_id=$2", [f.w, a.request.source_id])).rows;
    assert.deepEqual(persisted, [{transaction_id: replies[0], obligation_id: winner.p.obligation.id}]);
    assert.equal(await count("accounting_operations", f.w), 1);
    const one = pay(f, winner, {amount: "2000000.00", funded: "20000.00", clearedBook: "20000.00"});
    const two = pay(f, winner, {amount: "2000000.00", funded: "20000.00", clearedBook: "20000.00"});
    const settled = await Promise.allSettled([sendPayment(f, one), rpcOn(other, uid1, "save_payroll_payment", [f.w, two.request, two.p])]);
    assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(settled.filter((r) => r.status === "rejected").length, 1);
    assert.deepEqual(await remaining(winner), {native: "0.00000000", book: "0.00000000"});
  } finally { await other.end(); }
});

test("A3 tenant boundaries, private helpers, direct writes and source/event mismatches are enforced in SQL", async () => {
  const f = await fixture(), a = accrual(f);
  await record(f, a);
  await assert.rejects(record(f, {...a, request: {...a.request, source_id: uuid()}, p: {...a.p, party_id: uuid()}}), /does not match/);
  await assert.rejects(rpc("save_payroll_accrual", [f.w, a.request, a.p], uid2), /Workspace not found/);
  const other = await fixture();
  await assert.rejects(rpc("save_payroll_accrual", [other.w, a.request, a.p]), /Source record not found/);
  const crossEmployee = accrual(other, {employee_party_id: f.employee});
  await assert.rejects(record(other, crossEmployee), /foreign key/);
  await assert.rejects(asUser(db, uid1, (c) => c.query("insert into accounting_sources(id,workspace_id,module) values($1,$2,'payroll')", [uuid(), f.w])), /permission denied/);
  await assert.rejects(asUser(db, uid1, (c) => c.query("select public.record_accounting_operation($1,$2,'record','{}','{}','[]')", [f.w, a.request.source_id])), /permission denied/);
  await assert.rejects(db.query("update payroll_items set period='2026-11' where id=$1", [a.request.source_id]), /immutable/);
  const invisible = await asUser(db, uid2, (c) => c.query("select * from payroll_items where id=$1", [a.request.source_id]));
  assert.equal(invisible.rows.length, 0);
  const forged = pay(f, a);
  forged.request.allocations[0].amount = "900000";
  await assert.rejects(sendPayment(f, forged), /does not match/);
  assert.equal(await count("accounting_operations", f.w), 1);
});

test("A4 SGD funding discharges carried USD values while clearing a THB salary", async () => {
  const f = await fixture("USD", "THB", "SGD");
  const a = accrual(f, {amount: "100.00", exchange_rate: "0.03"});
  await record(f, a);
  const p = pay(f, a, {amount: "100.00", funded: "4.00", clearedBook: "3.00", fundingBook: "3.00"});
  p.request.allocations[0].funding_rate = "9"; // Provider/account quote is not the bank's historical carrying rate.
  await sendPayment(f, p);
  assert.deepEqual(await remaining(a), {native: "0.00000000", book: "0.00000000"});
  const funding = (await db.query("select amount::text,book_amount::text,rate_source from journal_lines where transaction_id=$1 and account_id=$2", [p.p.id, f.bank])).rows[0];
  assert.deepEqual(funding, {amount: "4.00000000", book_amount: "3.00000000", rate_source: "carrying_value"});
});


async function effectCounts(w) {
  const counts = {};
  for (const table of ["accounting_sources", "accounting_operations", "transactions", "journal_lines", "obligations", "settlements", "payroll_items"])
    counts[table] = await count(table, w);
  return counts;
}
function guidedExpense(f, amount = "25.00") {
  const request = {
    command: "guided", kind: "expense", accounting_date: "2026-10-25", description: "Bookkeeping cost",
    party_id: null, source_id: f.bank, destination_id: f.expense, amount, currency: "THB", rate: "1", splits: [],
  };
  const p = event("expense", [l(f.bank, "credit", amount), l(f.expense, "debit", amount)], {
    accounting_date: request.accounting_date, description: request.description,
  });
  return {request, p};
}
async function rejectBookkeeping(f, request, p) {
  const before = await effectCounts(f.w);
  await assert.rejects(rpc("save_bookkeeping_event", [f.w, uuid(), request, p]), /intent|command|request|posting|match/i);
  assert.deepEqual(await effectCounts(f.w), before);
}
async function postAndRetryBookkeeping(f, request, p) {
  const source = uuid();
  assert.equal(value(await rpc("save_bookkeeping_event", [f.w, source, request, p])), p.id);
  const once = await effectCounts(f.w);
  assert.equal(value(await rpc("save_bookkeeping_event", [f.w, source, request, {...p, id: uuid()}])), p.id);
  assert.deepEqual(await effectCounts(f.w), once);
}

test("A3 direct authenticated bookkeeping RPC binds guided/manual/payment intent and preserves atomic retries", async () => {
  const f = await fixture(), cost = guidedExpense(f);
  const missing = {...cost.request}; delete missing.command;
  await rejectBookkeeping(f, missing, cost.p);
  await rejectBookkeeping(f, {...cost.request, command: null}, cost.p);
  await rejectBookkeeping(f, {...cost.request, command: "unknown"}, cost.p);
  await rejectBookkeeping(f, cost.request, guidedExpense(f, "250.00").p); // Both events balance; the request still says 25.
  await rejectBookkeeping(f, {...cost.request, amount: "1.00"}, cost.p);
  await rejectBookkeeping(f, cost.request, {...cost.p, party_id: f.employee});
  await rejectBookkeeping(f, cost.request, {...cost.p, accounting_date: "2026-10-26"});
  await rejectBookkeeping(f, cost.request, {...cost.p, description: "Different source description"});
  const alternate = uuid();
  await rpc("save_account", [f.w, {id: alternate, name: "Other money", type: "asset", role: "bank", currency_code: "THB", is_active: true}]);
  await rejectBookkeeping(f, {...cost.request, source_id: alternate}, cost.p);
  await rejectBookkeeping(f, {...cost.request, destination_id: f.fee}, cost.p);
  await rejectBookkeeping(f, {...cost.request, currency: "SGD"}, cost.p);
  const injected = structuredClone(cost.p);
  injected.lines.push(l(f.bank, "credit", "10"), l(f.fee, "debit", "10"));
  await rejectBookkeeping(f, cost.request, injected);
  await postAndRetryBookkeeping(f, cost.request, cost.p);

  const manual = event("adjustment", [l(f.expense, "debit", "5"), l(f.bank, "credit", "5")], {accounting_date: "2026-10-26", description: "Manual source"});
  const manualRequest = {command: "manual", accounting_date: manual.accounting_date, description: manual.description, party_id: null,
    lines: manual.lines.map(({id, account_id, side, amount, currency_code, exchange_rate}) => ({id, account_id, side, amount, currency_code, exchange_rate}))};
  const wrongManual = structuredClone(manualRequest);
  wrongManual.lines[0].amount = "50";
  await rejectBookkeeping(f, wrongManual, manual);
  const wrongManualAccount = structuredClone(manualRequest);
  wrongManualAccount.lines[0].account_id = f.fee;
  await rejectBookkeeping(f, wrongManualAccount, manual);
  await postAndRetryBookkeeping(f, manualRequest, manual);

  const bill = accrual(f);
  bill.p.kind = "bill";
  const billRequest = {command: "guided", kind: "bill", accounting_date: bill.p.accounting_date, description: bill.p.description,
    party_id: f.employee, source_id: f.payable, destination_id: f.expense, amount: "2000000.00", currency: "MMK", rate: "0.01", splits: []};
  const wrongRate = structuredClone(bill.p);
  for (const row of wrongRate.lines) { row.exchange_rate = "0.02"; row.book_amount = "40000"; }
  await rejectBookkeeping(f, billRequest, wrongRate);
  await postAndRetryBookkeeping(f, billRequest, bill.p);

  const a = accrual(f); await record(f, a);
  const paid = pay(f, a, {fee: true});
  const paymentRequest = {command: "payment", accounting_date: paid.p.accounting_date, description: paid.p.description,
    allocations: [{obligation_id: a.p.obligation.id, amount: "1000000.00", funding_account_id: f.bank, funding_amount: "8000.00", funding_rate: "1"}],
    fx_account_id: f.fx, fee: paid.request.fee};
  const wrongClear = structuredClone(paymentRequest); wrongClear.allocations[0].amount = "900000.00";
  await rejectBookkeeping(f, wrongClear, paid.p);
  const wrongFunding = structuredClone(paymentRequest); wrongFunding.allocations[0].funding_amount = "7999.00";
  await rejectBookkeeping(f, wrongFunding, paid.p);
  const wrongBank = structuredClone(paymentRequest); wrongBank.allocations[0].funding_account_id = alternate;
  await rejectBookkeeping(f, wrongBank, paid.p);
  const wrongObligation = structuredClone(paymentRequest); wrongObligation.allocations[0].obligation_id = bill.p.obligation.id;
  await rejectBookkeeping(f, wrongObligation, paid.p);
  const wrongFee = structuredClone(paymentRequest); wrongFee.fee.amount = "99.00";
  await rejectBookkeeping(f, wrongFee, paid.p);
  await rejectBookkeeping(f, paymentRequest, {...paid.p, party_id: f.employee});
  await postAndRetryBookkeeping(f, paymentRequest, paid.p);
});

test("A4 persisted payroll split funding retains both THB/SGD pairs, evidence, fee/FX and reversal restoration", async () => {
  const f = await fixture(), a = accrual(f); await record(f, a);
  const sgd = uuid();
  await rpc("save_account", [f.w, {id: sgd, name: "SGD salary funding", type: "asset", role: "bank", currency_code: "SGD", is_active: true}]);
  await rpc("save_event", [f.w, event("contribution", [l(sgd, "debit", "1000", "SGD", "25", "25000"), l(f.capital, "credit", "25000")]), true]);
  const firstClear = l(f.payable, "debit", "600000", "MMK", "0.01", "6000", "carrying_value");
  const firstFund = l(f.bank, "credit", "5000");
  const secondClear = l(f.payable, "debit", "400000", "MMK", "0.01", "4000", "carrying_value");
  const secondFund = l(sgd, "credit", "150", "SGD", "25", "3750", "carrying_value");
  const p = event("payment", [firstClear, firstFund, secondClear, secondFund, l(f.bank, "credit", "100"), l(f.fee, "debit", "100"), l(f.fx, "credit", "1250")], {
    accounting_date: "2026-11-01", description: "Split salary transfer",
    settlements: [
      {id: uuid(), obligation_id: a.p.obligation.id, clearing_line_id: firstClear.id, funding_line_id: firstFund.id},
      {id: uuid(), obligation_id: a.p.obligation.id, clearing_line_id: secondClear.id, funding_line_id: secondFund.id},
    ],
  });
  const request = {
    source_id: a.request.source_id, operation_id: uuid(), accounting_date: p.accounting_date, description: p.description,
    allocations: [
      {amount: "600000", funding_account_id: f.bank, funding_amount: "5000", funding_rate: "1", provider_rate: "119.9", provider: "THB app", reference: "THB receipt"},
      {amount: "400000", funding_account_id: sgd, funding_amount: "150", funding_rate: "26", provider_rate: "2665", provider: "SGD app", reference: "SGD receipt"},
    ],
    fee: {account_id: f.fee, funding_account_id: f.bank, amount: "100", rate: "1"}, fx_account_id: f.fx,
  };
  assert.equal(value(await sendPayment(f, {request, p})), p.id);
  const pairs = (await db.query("select s.obligation_id,c.amount::text as cleared,c.currency_code as target_currency,c.book_amount::text as cleared_book,f.account_id as funding_account,f.amount::text as funded,f.currency_code as source_currency,f.book_amount::text as funded_book,f.rate_source from settlements s join journal_lines c on c.id=s.clearing_line_id join journal_lines f on f.id=s.funding_line_id where s.workspace_id=$1 and c.transaction_id=$2", [f.w, p.id])).rows;
  assert.equal(pairs.length, 2);
  const byBank = Object.fromEntries(pairs.map((pair) => [pair.funding_account, pair]));
  assert.deepEqual(byBank[f.bank], {obligation_id: a.p.obligation.id, cleared: "600000.00000000", target_currency: "MMK", cleared_book: "6000.00000000", funding_account: f.bank, funded: "5000.00000000", source_currency: "THB", funded_book: "5000.00000000", rate_source: null});
  assert.deepEqual(byBank[sgd], {obligation_id: a.p.obligation.id, cleared: "400000.00000000", target_currency: "MMK", cleared_book: "4000.00000000", funding_account: sgd, funded: "150.00000000", source_currency: "SGD", funded_book: "3750.00000000", rate_source: "carrying_value"});
  const operation = (await db.query("select transfer_evidence from accounting_operations where workspace_id=$1 and transaction_id=$2", [f.w, p.id])).rows[0];
  assert.equal(operation.transfer_evidence.length, 2);
  assert.deepEqual(operation.transfer_evidence.map((e) => [e.source_currency, e.target_currency, e.provider_rate, e.provider, e.reference]), [
    ["THB", "MMK", "119.9", "THB app", "THB receipt"], ["SGD", "MMK", "2665", "SGD app", "SGD receipt"],
  ]);
  assert.equal(Number(operation.transfer_evidence[0].effective_rate), 120);
  assert.equal(Number(operation.transfer_evidence[1].effective_rate), 2666.6666666666665);
  assert.deepEqual(await remaining(a), {native: "1000000.00000000", book: "10000.00000000"});
  const totals = async () => (await db.query("select account_id,sum(case side when 'debit' then amount else -amount end)::text as native,sum(case side when 'debit' then book_amount else -book_amount end)::text as book from journal_lines l join transactions t on t.id=l.transaction_id where l.workspace_id=$1 and t.posted_at is not null group by account_id", [f.w])).rows;
  let balances = Object.fromEntries((await totals()).map((row) => [row.account_id, row]));
  assert.deepEqual([balances[f.bank].native, balances[sgd].native, balances[sgd].book], ["94900.00000000", "850.00000000", "21250.00000000"]);
  assert.deepEqual([balances[f.expense].book, balances[f.fee].book, balances[f.fx].book], ["20000.00000000", "100.00000000", "-1250.00000000"]);
  assert.equal((await db.query("select count(*)::int as n from journal_lines where account_id=$1", [f.expense])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from journal_lines where transaction_id=$1 and account_id=$2 and amount=100", [p.id, f.bank])).rows[0].n, 1);
  await rpc("reverse_event", [f.w, p.id, uuid(), "2026-11-02"]);
  assert.deepEqual(await remaining(a), {native: "2000000.00000000", book: "20000.00000000"});
  balances = Object.fromEntries((await totals()).map((row) => [row.account_id, row]));
  assert.deepEqual([balances[f.bank].native, balances[sgd].native, balances[sgd].book], ["100000.00000000", "1000.00000000", "25000.00000000"]);
  assert.deepEqual([balances[f.expense].book, balances[f.fee].book, balances[f.fx].book], ["20000.00000000", "0.00000000", "0.00000000"]);
});


test("A3/A4 authenticated payroll RPC binds fresh card principal and fee valuation to declared rates", async () => {
  const f = await fixture("THB", "THB"), a = accrual(f, {amount: "2500.00"});
  await record(f, a);
  const card = uuid();
  await rpc("save_account", [f.w, {id: card, name: "SGD salary card", type: "liability", role: "credit_card", currency_code: "SGD", is_active: true}]);
  function cardPayment(principalRate = "25", feeRate = "25", withFee = false) {
    const clear = l(f.payable, "debit", "2500");
    const funded = l(card, "credit", "100", "SGD", principalRate, String(100 * Number(principalRate)));
    const lines = [clear, funded];
    const request = {source_id: a.request.source_id, operation_id: uuid(), accounting_date: "2026-11-01", description: "Salary funded by card",
      allocations: [{amount: "2500", funding_account_id: card, funding_amount: "100", funding_rate: "25"}], fx_account_id: f.fx};
    if (withFee) {
      request.fee = {account_id: f.fee, funding_account_id: card, amount: "2", rate: "25"};
      lines.push(l(card, "credit", "2", "SGD", feeRate, String(2 * Number(feeRate))), l(f.fee, "debit", "2", "SGD", "25", "50"));
    }
    const difference = lines.reduce((sum, row) => sum + Number(row.book_amount) * (row.side === "debit" ? 1 : -1), 0);
    if (difference) lines.push(l(f.fx, difference > 0 ? "credit" : "debit", String(Math.abs(difference))));
    return {request, p: event("payment", lines, {accounting_date: request.accounting_date, description: request.description,
      settlements: [{id: uuid(), obligation_id: a.p.obligation.id, clearing_line_id: clear.id, funding_line_id: funded.id}]})};
  }
  for (const invalid of [cardPayment("1"), cardPayment("25", "1", true)]) {
    // Each forged event is balanced and keeps the declared native accounts and amounts.
    assert.equal(invalid.p.lines.reduce((sum, row) => sum + Number(row.book_amount) * (row.side === "debit" ? 1 : -1), 0), 0);
    const before = await effectCounts(f.w);
    await assert.rejects(sendPayment(f, invalid), /does not match command intent/);
    assert.deepEqual(await effectCounts(f.w), before);
    assert.deepEqual(await remaining(a), {native: "2500.00000000", book: "2500.00000000"});
  }
  const valid = cardPayment("25", "25", true);
  assert.equal(value(await sendPayment(f, valid)), valid.p.id);
  const rows = (await db.query("select account_id,side,amount::text,exchange_rate::text,book_amount::text,rate_source from journal_lines where transaction_id=$1", [valid.p.id])).rows;
  const expected = (account_id, side, amount, book_amount, exchange_rate, rate_source) => ({account_id, side, amount, book_amount, exchange_rate, rate_source});
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.find((row) => row.account_id === card && row.amount === "100.00000000"), expected(card, "credit", "100.00000000", "2500.00000000", "25.000000000000000000", "manual"));
  assert.deepEqual(rows.find((row) => row.account_id === card && row.amount === "2.00000000"), expected(card, "credit", "2.00000000", "50.00000000", "25.000000000000000000", "manual"));
  assert.deepEqual(rows.find((row) => row.account_id === f.fee), expected(f.fee, "debit", "2.00000000", "50.00000000", "25.000000000000000000", "manual"));
  assert.deepEqual(rows.find((row) => row.account_id === f.payable), expected(f.payable, "debit", "2500.00000000", "2500.00000000", "1.000000000000000000", null));
  assert.deepEqual(await remaining(a), {native: "0.00000000", book: "0.00000000"});
  const persisted = (await db.query("select request from accounting_operations where transaction_id=$1", [valid.p.id])).rows[0].request;
  assert.equal(persisted.allocations[0].funding_rate, "25");
  assert.equal(persisted.fee.rate, "25");
});
