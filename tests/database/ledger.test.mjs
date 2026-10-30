import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { asUser, localStack, uid1, uid2 } from "../../scripts/local-stack.mjs";
import { uuid, line, event, invoice, payment } from "../fixtures/ledger.mjs";
let stack,
  db,
  w,
  w2,
  bank,
  sgd,
  equity,
  revenue,
  expense,
  equipment,
  receivable,
  payable,
  party,
  fx;
const rpc = (name, args) =>
  asUser(db, uid1, (c) =>
    c.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")})`,
      args,
    ),
  );
const save = (p, post = true) => rpc("save_event", [w, p, post]);
async function account(name, type, role = "general", currency_code = null) {
  const id = uuid();
  await rpc("save_account", [
    w,
    { id, name, type, role, currency_code, is_active: true },
  ]);
  return id;
}
before(async () => {
  stack = await localStack();
  db = stack.db;
  w = uuid();
  w2 = uuid();
  await rpc("create_workspace", [
    {
      id: w,
      name: "Business",
      kind: "business",
      functional_currency_code: "USD",
      timezone: "Asia/Bangkok",
    },
  ]);
  await asUser(db, uid2, (c) =>
    c.query("select create_workspace($1)", [
      {
        id: w2,
        name: "Other user",
        kind: "personal",
        functional_currency_code: "THB",
        timezone: "Asia/Bangkok",
      },
    ]),
  );
  bank = await account("USD bank", "asset", "bank", "USD");
  sgd = await account("SGD bank", "asset", "bank", "SGD");
  equity = await account("Capital", "equity");
  revenue = await account("Services", "revenue");
  expense = await account("Rent and other expenses", "expense");
  equipment = await account("Equipment and deposits", "asset");
  receivable = await account("SGD receivable", "asset", "receivable", "SGD");
  payable = await account("SGD payable", "liability", "payable", "SGD");
  fx = await account("FX differences", "expense");
  party = uuid();
  await rpc("save_party", [w, { id: party, name: "Singapore client" }]);
});
after(async () => {
  await stack?.stop();
});
test("scenario commands freeze owner data, validate openings/replay and never write the ledger", async () => {
  const workspace = uuid(), otherWorkspace = uuid(), usd = uuid(), capital = uuid(), foreign = uuid();
  for (const id of [workspace, otherWorkspace]) await rpc("create_workspace", [{ id, name: "Scenario test", kind: "business", functional_currency_code: "USD", timezone: "UTC" }]);
  for (const [id, type, currency_code] of [[usd, "asset", "USD"], [capital, "equity", null], [foreign, "asset", "SGD"]])
    await rpc("save_account", [workspace, { id, name: id, type, role: "general", currency_code, is_active: true }]);
  const p = { id: uuid(), name: "Frozen experiment", start_date: "2026-10-01", end_date: "2026-10-31", opening_mode: "actual", opening_balances: [], selected_transaction_ids: [] };
  const getSnapshot = async () => (await rpc("read_snapshot", [workspace])).rows[0].read_snapshot;
  const before = await getSnapshot();
  await rpc("save_scenario", [workspace, p]);
  const read = async () => (await rpc("read_scenario", [workspace, p.id])).rows[0].read_scenario;
  const frozen = await read();
  assert.deepEqual(frozen.source_snapshot, before);
  assert.deepEqual(await getSnapshot(), before);
  await assert.rejects(asUser(db, uid2, (c) => c.query("select read_scenario($1,$2)", [workspace, p.id])), /Workspace not found/);
  await assert.rejects(asUser(db, uid2, (c) => c.query("select save_scenario($1,$2)", [workspace, { ...p, id: uuid() }])), /Workspace not found/);
  await assert.rejects(asUser(db, uid2, (c) => c.query("select delete_scenario($1,$2)", [workspace, p.id])), /Workspace not found/);
  assert.equal((await asUser(db, uid2, (c) => c.query("select * from financial_scenarios"))).rowCount, 0);
  await assert.rejects(rpc("read_scenario", [otherWorkspace, p.id]), /Scenario not found/);
  await assert.rejects(rpc("save_scenario", [otherWorkspace, p]), /Scenario not found/);
  await assert.rejects(asUser(db, uid1, (c) => c.query("delete from financial_scenarios where id=$1", [p.id])), /permission denied/);
  await assert.rejects(asUser(db, uid1, (c) => c.query("update financial_scenarios set name='tampered' where id=$1", [p.id])), /permission denied/);
  const invalid = (extra) => rpc("save_scenario", [workspace, { ...p, id: uuid(), opening_mode: "custom", ...extra }]);
  await assert.rejects(invalid({ opening_balances: [{ account_id: usd, book_balance: "1", native_balance: "1" }] }), /equal/);
  await assert.rejects(invalid({ opening_balances: [{ account_id: usd, book_balance: "0", native_balance: "1" }] }), /must match/);
  await assert.rejects(invalid({ opening_balances: [{ account_id: usd, book_balance: "0", native_balance: null }] }), /native/);
  await assert.rejects(invalid({ opening_balances: [{ account_id: uuid(), book_balance: "0", native_balance: null }] }), /workspace/);
  await assert.rejects(invalid({ opening_balances: [{ account_id: usd, book_balance: 0, native_balance: "0" }] }), /Invalid opening/);
  await assert.rejects(invalid({ source_snapshot: before }), /fields/);
  await assert.rejects(invalid({ opening_balances: [{ account_id: capital, book_balance: "0", native_balance: null }, { account_id: capital, book_balance: "0", native_balance: null }] }), /unique/);
  const contribution = event("contribution", [line(usd, "debit", "100"), line(capital, "credit", "100")]);
  await rpc("save_event", [workspace, contribution, true]);
  const draft = event("contribution", [line(usd, "debit", "10"), line(capital, "credit", "10")]);
  await rpc("save_event", [workspace, draft, false]);
  for (const selected_transaction_ids of [[draft.id], [contribution.id, contribution.id], [uuid()]])
    await assert.rejects(invalid({ selected_transaction_ids }), /posted|unique/);
  await assert.rejects(invalid({ end_date: "2026-09-30" }), /Start date/);
  await rpc("save_scenario", [workspace, p]);
  assert.deepEqual(await read(), frozen, "Retry must preserve the original snapshot after actual postings");
  await assert.rejects(rpc("save_scenario", [workspace, { ...p, name: "changed" }]), /immutable/);
  const custom = { ...p, id: uuid(), opening_mode: "custom", selected_transaction_ids: [contribution.id], opening_balances: [
    { account_id: usd, book_balance: "9007199254740993.12345678", native_balance: "9007199254740993.12345678" },
    { account_id: capital, book_balance: "9007199254740993.12345678", native_balance: null },
    { account_id: foreign, book_balance: "0", native_balance: "0" },
  ] };
  const ledgerBefore = await getSnapshot();
  await rpc("save_scenario", [workspace, custom]);
  assert.equal((await rpc("read_scenario", [workspace, custom.id])).rows[0].read_scenario.opening_balances[0].book_balance, "9007199254740993.12345678");
  await rpc("delete_scenario", [workspace, custom.id]);
  await rpc("delete_scenario", [workspace, p.id]);
  assert.deepEqual(await getSnapshot(), ledgerBefore);
});
test("clean schema, owner RLS, direct writes, cross-workspace RPC/FK and invalid accounts", async () => {
  const tables = (
    await db.query("select tablename from pg_tables where schemaname='public'")
  ).rows.map((r) => r.tablename);
  assert.deepEqual(tables.sort(), [
    "accounting_operations",
    "accounting_sources",
    "accounts",
    "currencies",
    "financial_scenarios",
    "journal_lines",
    "obligations",
    "parties",
    "payroll_items",
    "settlements",
    "transactions",
    "users",
    "workspaces",
  ]);
  const rows = await asUser(db, uid2, (c) => c.query("select * from accounts"));
  assert.equal(rows.rowCount, 0);
  await assert.rejects(
    asUser(db, uid2, (c) => c.query("select read_snapshot($1)", [w])),
    /Workspace not found/,
  );
  await assert.rejects(
    asUser(db, uid2, (c) =>
      c.query("select save_account($1,$2)", [
        w,
        {
          id: uuid(),
          name: "Attack",
          type: "asset",
          role: "bank",
          currency_code: "USD",
        },
      ]),
    ),
    /Workspace not found/,
  );
  await assert.rejects(
    asUser(db, uid1, (c) =>
      c.query(
        "insert into transactions(id,workspace_id,accounting_date,kind,description) values($1,$2,current_date,'income','illegal')",
        [uuid(), w],
      ),
    ),
    /permission denied/,
  );
  await assert.rejects(
    account("Invalid", "expense", "bank", "USD"),
    /check constraint/,
  );
  const otherParty = uuid();
  await asUser(db, uid2, (c) =>
    c.query("select save_party($1,$2)", [
      w2,
      { id: otherParty, name: "Other" },
    ]),
  );
  await assert.rejects(
    save(
      event(
        "income",
        [line(bank, "debit", "1"), line(revenue, "credit", "1")],
        { party_id: otherParty },
      ),
    ),
    /foreign key/,
  );
  await assert.rejects(
    save(
      event("income", [
        line(bank, "debit", "NaN"),
        line(revenue, "credit", "NaN"),
      ]),
    ),
    /check constraint/,
  );
});
test("T01-T07/T10 subset, drafts, immutable posting, retry conflict and atomic failure", async () => {
  const contribution = event("contribution", [
    line(bank, "debit", "10000"),
    line(equity, "credit", "10000"),
  ]);
  await save(contribution);
  await save(contribution);
  assert.equal(
    (
      await db.query("select count(*) from transactions where id=$1", [
        contribution.id,
      ])
    ).rows[0].count,
    "1",
  );
  await assert.rejects(
    save({ ...contribution, description: "Different retry" }),
    /Retry conflicts/,
  );
  for (const [kind, amount, target] of [
    ["deposit", "1000", equipment],
    ["expense", "1000", expense],
    ["asset_purchase", "3000", equipment],
    ["asset_purchase", "500", equipment],
    ["expense", "500", expense],
    ["expense", "200", expense],
  ])
    await save(
      event(kind, [
        line(target, "debit", amount),
        line(bank, "credit", amount),
      ]),
    );
  await save(
    event("income", [
      line(sgd, "debit", "4000", "SGD", "0.75", "3000"),
      line(revenue, "credit", "4000", "SGD", "0.75", "3000"),
    ]),
  );
  const draft = event("expense", [
    line(expense, "debit", "999"),
    line(bank, "credit", "999"),
  ]);
  await save(draft, false);
  await save({ ...draft, description: "Edited draft" }, false);
  const totals = (
    await db.query(
      "select a.type,sum(case j.side when 'debit' then j.book_amount else -j.book_amount end)::text balance from journal_lines j join accounts a on a.id=j.account_id join transactions t on t.id=j.transaction_id where t.posted_at is not null and t.workspace_id=$1 group by a.type",
      [w],
    )
  ).rows;
  const byType = Object.fromEntries(totals.map((r) => [r.type, r.balance]));
  assert.equal(byType.asset, "11300.00000000");
  assert.equal(byType.expense, "1700.00000000");
  assert.equal(byType.revenue, "-3000.00000000");
  const usd = (
    await db.query(
      "select sum(case side when 'debit' then amount else -amount end)::text amount from journal_lines j join transactions t on t.id=j.transaction_id where account_id=$1 and t.posted_at is not null",
      [bank],
    )
  ).rows[0];
  assert.equal(usd.amount, "3800.00000000");
  const bad = event("expense", [
    line(expense, "debit", "10"),
    line(bank, "credit", "11"),
  ]);
  await assert.rejects(save(bad), /must balance/);
  assert.equal(
    (await db.query("select 1 from transactions where id=$1", [bad.id]))
      .rowCount,
    0,
  );
  await assert.rejects(
    rpc("save_account", [
      w,
      {
        id: bank,
        name: "Changed",
        type: "asset",
        role: "cash",
        currency_code: "USD",
        is_active: true,
      },
    ]),
    /classification is locked/,
  );
  await assert.rejects(
    db.query("update journal_lines set amount=1 where transaction_id=$1", [
      contribution.id,
    ]),
    /immutable/,
  );
  await assert.rejects(
    save(
      event("income", [
        line(sgd, "debit", "1", "THB", "0.03", "0.03"),
        line(revenue, "credit", "1", "THB", "0.03", "0.03"),
      ]),
    ),
    /currency mismatch/,
  );
});
test("unpaid recognition, partial/full receipt, control totals and reversal dependency", async () => {
  const inv = invoice(receivable, revenue, party);
  await save(inv);
  const p = payment(inv, bank);
  await save(p);
  await save(p);
  const snap = (await rpc("read_snapshot", [w])).rows[0].read_snapshot;
  assert.equal(typeof snap.lines[0].amount, "string");
  const open = (
    await db.query(
      "select r.amount-sum(c.amount) remaining,r.book_amount-sum(c.book_amount) book from obligations o join journal_lines r on r.id=o.recognition_line_id join settlements s on s.obligation_id=o.id join journal_lines c on c.id=s.clearing_line_id where o.id=$1 group by r.amount,r.book_amount",
      [inv.obligation.id],
    )
  ).rows[0];
  assert.equal(open.remaining, "3000.00000000");
  assert.equal(open.book, "2250.00000000");
  await assert.rejects(
    rpc("reverse_event", [w, inv.id, uuid(), "2026-10-24"]),
    /dependent payments/,
  );
  const final = payment(inv, bank, "3000", "2250", "2250");
  await save(final);
  await assert.rejects(
    save(payment(inv, bank, "1", "0.75", "0.75")),
    /exceeds outstanding/,
  );
  await rpc("reverse_event", [w, final.id, uuid(), "2026-10-24"]);
  await rpc("reverse_event", [w, p.id, uuid(), "2026-10-24"]);
  const reversal = uuid();
  await rpc("reverse_event", [w, inv.id, reversal, "2026-10-24"]);
  await rpc("reverse_event", [w, inv.id, reversal, "2026-10-24"]);
  const unmatched = event("adjustment", [
    line(receivable, "debit", "1", "SGD", "0.75", "0.75"),
    line(revenue, "credit", "1", "SGD", "0.75", "0.75"),
  ]);
  await assert.rejects(save(unmatched), /requires an unpaid item/);
});
test("foreign bank carrying discharge, explicit FX, fees and split funding batch", async () => {
  const spend = event("expense", [
    line(expense, "debit", "100", "SGD", "0.8", "80"),
    line(sgd, "credit", "100", "SGD", "0.75", "75", "carrying_value"),
    line(fx, "credit", "5"),
  ]);
  await save(spend);
  await assert.rejects(
    save(
      event("expense", [
        line(expense, "debit", "100", "SGD", "0.8", "80"),
        line(sgd, "credit", "100", "SGD", "0.8", "80", "bank"),
      ]),
    ),
    /carrying value/,
  );
  const bill = invoice(payable, expense, party, "100", "0.75", "75", "bill");
  await save(bill);
  const clearing = line(
      payable,
      "debit",
      "100",
      "SGD",
      "0.75",
      "75",
      "carrying_value",
    ),
    funded = line(bank, "credit", "80");
  const pay = event(
    "payment",
    [
      clearing,
      funded,
      line(fx, "debit", "5"),
      line(bank, "credit", "2"),
      line(expense, "debit", "2"),
    ],
    {
      settlements: [
        {
          id: uuid(),
          obligation_id: bill.obligation.id,
          clearing_line_id: clearing.id,
          funding_line_id: funded.id,
        },
      ],
    },
  );
  await save(pay);
  const one = invoice(receivable, revenue, party, "100", "0.75", "75"),
    two = invoice(receivable, revenue, party, "200", "0.75", "150");
  await save(one);
  await save(two);
  const p1 = payment(one, bank, "100", "75", "75"),
    p2 = payment(two, bank, "100", "75", "75"),
    p3 = payment(two, bank, "100", "75", "75");
  await save(
    event("payment", [...p1.lines, ...p2.lines, ...p3.lines], {
      settlements: [...p1.settlements, ...p2.settlements, ...p3.settlements],
    }),
  );
});
test("concurrent requests cannot over-settle; final carried rounding remainder", async () => {
  const inv = invoice(
    receivable,
    revenue,
    party,
    "0.03",
    "0.333333333333333333",
    "0.01",
  );
  await save(inv);
  const c1 = new pg.Client({
      host: "127.0.0.1",
      port: stack.port,
      user: "postgres",
      password: "microfin-disposable-test-only",
      database: "postgres",
    }),
    c2 = new pg.Client({
      host: "127.0.0.1",
      port: stack.port,
      user: "postgres",
      password: "microfin-disposable-test-only",
      database: "postgres",
    });
  await c1.connect();
  await c2.connect();
  const make = () => {
    const p = payment(inv, bank, "0.02", "0.01", "0.01");
    p.lines[0].exchange_rate = "0.5";
    return p;
  };
  try {
    const results = await Promise.allSettled(
      [c1, c2].map((c) =>
        asUser(c, uid1, (x) =>
          x.query("select save_event($1,$2,true)", [w, make()]),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  } finally {
    await c1.end();
    await c2.end();
  }
  const final = payment(inv, bank, "0.01", "0.01", "0");
  final.lines[0].exchange_rate = "0.000000000000000001";
  final.lines.push(line(fx, "credit", "0.01"));
  await save(final);
});
test("same-payment foreign collection funds its fee atomically, but cannot overspend", async () => {
  const collectionBank = await account(
    "Empty collection bank",
    "asset",
    "bank",
    "SGD",
  );
  const inv = invoice(receivable, revenue, party, "100", "0.75", "75");
  await save(inv);
  const clearing = line(
      receivable,
      "credit",
      "100",
      "SGD",
      "0.75",
      "75",
      "carrying_value",
    ),
    funded = line(collectionBank, "debit", "100", "SGD", "0.75", "75"),
    fee = line(
      collectionBank,
      "credit",
      "2",
      "SGD",
      "0.75",
      "1.50",
      "carrying_value",
    );
  const pay = event(
    "payment",
    [clearing, funded, fee, line(expense, "debit", "2", "SGD", "0.75", "1.50")],
    {
      settlements: [
        {
          id: uuid(),
          obligation_id: inv.obligation.id,
          clearing_line_id: clearing.id,
          funding_line_id: funded.id,
        },
      ],
    },
  );
  await save(pay);
  const balance = (
    await db.query(
      "select sum(case side when 'debit' then amount else -amount end)::text native,sum(case side when 'debit' then book_amount else -book_amount end)::text book from journal_lines j join transactions t on t.id=j.transaction_id where j.account_id=$1 and t.posted_at is not null",
      [collectionBank],
    )
  ).rows[0];
  assert.deepEqual(balance, { native: "98.00000000", book: "73.50000000" });
  const posted = (await rpc("read_snapshot", [w])).rows[0].read_snapshot;
  const ownLines = posted.lines.filter((l) => l.transaction_id === pay.id);
  assert.equal(
    ownLines.find((l) => l.account_id === expense).book_amount,
    "1.50000000",
  );
  assert.equal(ownLines.filter((l) => l.account_id === revenue).length, 0);
  assert.equal(
    ownLines.find((l) => l.id === clearing.id).amount,
    "100.00000000",
  );
  assert.equal(
    ownLines.find((l) => l.id === clearing.id).book_amount,
    "75.00000000",
  );
  const empty = await account("Another empty bank", "asset", "bank", "SGD"),
    second = invoice(receivable, revenue, party, "100", "0.75", "75");
  await save(second);
  const c = line(
      receivable,
      "credit",
      "100",
      "SGD",
      "0.75",
      "75",
      "carrying_value",
    ),
    f = line(empty, "debit", "100", "SGD", "0.75", "75");
  const bad = event(
    "payment",
    [
      c,
      f,
      line(empty, "credit", "101", "SGD", "0.75", "75.75", "carrying_value"),
      line(expense, "debit", "101", "SGD", "0.75", "75.75"),
    ],
    {
      settlements: [
        {
          id: uuid(),
          obligation_id: second.obligation.id,
          clearing_line_id: c.id,
          funding_line_id: f.id,
        },
      ],
    },
  );
  await assert.rejects(save(bad), /Insufficient foreign balance/);
  assert.equal(
    (await db.query("select 1 from transactions where id=$1", [bad.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await db.query("select 1 from settlements where obligation_id=$1", [
        second.obligation.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (await db.query("select 1 from journal_lines where account_id=$1", [empty]))
      .rowCount,
    0,
  );
});
test("opening receivable and payable link to equity without recognizing income or expenses", async () => {
  const inputs = [];
  for (const [control, side, amount, book] of [
    [receivable, "debit", "100", "75"],
    [payable, "credit", "40", "30"],
  ]) {
    const recognition = line(control, side, amount, "SGD", "0.75", book);
    const opening = event(
      "opening_balance",
      [
        recognition,
        line(
          equity,
          side === "debit" ? "credit" : "debit",
          amount,
          "SGD",
          "0.75",
          book,
        ),
      ],
      {
        party_id: party,
        obligation: {
          id: uuid(),
          recognition_line_id: recognition.id,
          reference: "OPENING",
          due_date: null,
        },
      },
    );
    await save(opening);
    inputs.push(opening);
  }
  for (const opening of inputs) {
    const rows = (
      await db.query(
        "select a.type,j.side,j.amount::text,j.book_amount::text from journal_lines j join accounts a on a.id=j.account_id where j.transaction_id=$1",
        [opening.id],
      )
    ).rows;
    assert.equal(
      rows.filter((r) => ["revenue", "expense"].includes(r.type)).length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from obligations where recognition_line_id=$1",
          [opening.lines[0].id],
        )
      ).rowCount,
      1,
    );
    assert.ok(
      rows.some(
        (r) =>
          r.type === "equity" &&
          r.book_amount === opening.lines[0].book_amount + ".00000000",
      ),
    );
  }
  const wrong = invoice(receivable, expense, party, "100", "0.75", "75");
  wrong.kind = "opening_balance";
  await assert.rejects(save(wrong), /equity counterpart/);
});
test("real reversal RPC preserves opposite postings, restores outstanding, and changes as-of financial totals", async () => {
  const workspace = uuid();
  await rpc("create_workspace", [
    {
      id: workspace,
      name: "Reversal audit",
      kind: "business",
      functional_currency_code: "USD",
      timezone: "Asia/Bangkok",
    },
  ]);
  async function localAccount(
    name,
    type,
    role = "general",
    currency_code = null,
  ) {
    const id = uuid();
    await rpc("save_account", [
      workspace,
      { id, name, type, role, currency_code, is_active: true },
    ]);
    return id;
  }
  const usd = await localAccount("USD collection", "asset", "bank", "USD"),
    ar = await localAccount("SGD control", "asset", "receivable", "SGD"),
    sales = await localAccount("Services", "revenue"),
    customer = uuid();
  await rpc("save_party", [workspace, { id: customer, name: "Customer" }]);
  const recognition = invoice(ar, sales, customer);
  recognition.accounting_date = "2026-10-20";
  await rpc("save_event", [workspace, recognition, true]);
  const receipt = payment(recognition, usd);
  receipt.accounting_date = "2026-10-21";
  await rpc("save_event", [workspace, receipt, true]);
  async function outstanding() {
    const result = await db.query(
      `select (r.amount-coalesce(sum(c.amount) filter(where public.event_active(c.transaction_id)),0))::text native,(r.book_amount-coalesce(sum(c.book_amount) filter(where public.event_active(c.transaction_id)),0))::text book from obligations o join journal_lines r on r.id=o.recognition_line_id left join settlements st on st.obligation_id=o.id left join journal_lines c on c.id=st.clearing_line_id where o.id=$1 group by r.amount,r.book_amount`,
      [recognition.obligation.id],
    );
    return result.rows[0];
  }
  assert.deepEqual(await outstanding(), {
    native: "3000.00000000",
    book: "2250.00000000",
  });
  const original = (
    await db.query(
      "select account_id,side,amount::text,currency_code,exchange_rate::text,book_amount::text,rate_source from journal_lines where transaction_id=$1 order by account_id",
      [receipt.id],
    )
  ).rows;
  const paymentReversal = uuid();
  await rpc("reverse_event", [
    workspace,
    receipt.id,
    paymentReversal,
    "2026-10-22",
  ]);
  const copied = (
    await db.query(
      "select account_id,side,amount::text,currency_code,exchange_rate::text,book_amount::text,rate_source from journal_lines where transaction_id=$1 order by account_id",
      [paymentReversal],
    )
  ).rows;
  assert.equal(copied.length, original.length);
  assert.equal(copied.length, 2);
  assert.deepEqual(
    copied,
    original.map((l) => ({
      ...l,
      side: l.side === "debit" ? "credit" : "debit",
    })),
  );
  assert.deepEqual(
    (
      await db.query(
        "select account_id,side,amount::text,currency_code,exchange_rate::text,book_amount::text,rate_source from journal_lines where transaction_id=$1 order by account_id",
        [receipt.id],
      )
    ).rows,
    original,
  );
  assert.deepEqual(await outstanding(), {
    native: "4000.00000000",
    book: "3000.00000000",
  });
  async function totals(onDate) {
    const { rows } = await db.query(
      `with posted as(select j.*,a.type,case j.side when 'debit' then j.book_amount else -j.book_amount end signed from journal_lines j join accounts a on a.id=j.account_id join transactions t on t.id=j.transaction_id where j.workspace_id=$1 and t.posted_at is not null and t.accounting_date<=$2::date) select coalesce(sum(signed) filter(where type='asset'),0)::text assets,coalesce(sum(signed) filter(where account_id=$3),0)::text bank,coalesce(sum(signed) filter(where account_id=$4),0)::text receivable,(-coalesce(sum(signed) filter(where type in ('revenue','expense')),0))::text profit,(-coalesce(sum(signed) filter(where type in ('equity','revenue','expense')),0))::text equity from posted`,
      [workspace, onDate, usd, ar],
    );
    return rows[0];
  }
  assert.deepEqual(await totals("2026-10-20"), {
    assets: "3000.00000000",
    bank: "0",
    receivable: "3000.00000000",
    profit: "3000.00000000",
    equity: "3000.00000000",
  });
  assert.deepEqual(await totals("2026-10-21"), {
    assets: "3000.00000000",
    bank: "750.00000000",
    receivable: "2250.00000000",
    profit: "3000.00000000",
    equity: "3000.00000000",
  });
  assert.deepEqual(await totals("2026-10-22"), {
    assets: "3000.00000000",
    bank: "0.00000000",
    receivable: "3000.00000000",
    profit: "3000.00000000",
    equity: "3000.00000000",
  });
  const recognitionReversal = uuid();
  await rpc("reverse_event", [
    workspace,
    recognition.id,
    recognitionReversal,
    "2026-10-23",
  ]);
  const recognitionLines = (
    await db.query(
      "select account_id,side,amount::text,currency_code,exchange_rate::text,book_amount::text,rate_source from journal_lines where transaction_id=$1 order by account_id",
      [recognition.id],
    )
  ).rows;
  assert.deepEqual(
    (
      await db.query(
        "select account_id,side,amount::text,currency_code,exchange_rate::text,book_amount::text,rate_source from journal_lines where transaction_id=$1 order by account_id",
        [recognitionReversal],
      )
    ).rows,
    recognitionLines.map((l) => ({
      ...l,
      side: l.side === "debit" ? "credit" : "debit",
    })),
  );
  assert.deepEqual(await totals("2026-10-23"), {
    assets: "0.00000000",
    bank: "0.00000000",
    receivable: "0.00000000",
    profit: "0.00000000",
    equity: "0.00000000",
  });
  assert.equal(
    (
      await db.query(
        "select 1 from obligations o join journal_lines j on j.id=o.recognition_line_id where o.id=$1 and public.event_active(j.transaction_id)",
        [recognition.obligation.id],
      )
    ).rowCount,
    0,
  );
});
