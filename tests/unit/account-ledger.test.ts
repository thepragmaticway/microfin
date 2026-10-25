import { describe, expect, it } from "vitest";
import { accountLedger } from "../../src/lib/account-ledger";
import { accountBalance } from "../../src/lib/reports";
import { d, money } from "../../src/lib/money";
import type { Account, Currency, Snapshot } from "../../src/lib/types";

function fixture(type: Account["type"] = "asset", currency: Currency | null = "SGD") {
  const s: Snapshot = {
    workspace: {
      id: "w", owner_user_id: "u", name: "Studio", kind: "business",
      functional_currency_code: "USD", timezone: "UTC", created_at: "2026-01-01",
    },
    accounts: [{ id: "a", workspace_id: "w", name: "Account", type, role: "general", currency_code: currency, is_active: true }],
    parties: [], transactions: [], lines: [], obligations: [], settlements: [],
  };
  function entry(
    id: string,
    date: string,
    side: "debit" | "credit",
    amount: string,
    book = amount,
    posted = true,
    currency_code: Currency = "SGD",
  ) {
    s.transactions.push({
      id, workspace_id: "w", accounting_date: date, kind: "adjustment",
      description: id, party_id: null, posted_at: posted ? `${date}T12:00:00Z` : null,
      reversal_of_id: null, created_at: `${date}T12:00:00Z`,
    });
    s.lines.push({
      id: `${id}-line`, workspace_id: "w", transaction_id: id, account_id: "a",
      side, amount, book_amount: book, currency_code,
      exchange_rate: "1", rate_source: "manual",
    });
  }
  return { s, entry };
}

describe("account ledger", () => {
  it("carries opening balances and includes period boundaries, with chronological running balances", () => {
    const { s, entry } = fixture();
    entry("last", "2026-10-31", "credit", "10", "8");
    entry("before", "2026-09-30", "debit", "100", "75");
    entry("draft", "2026-10-15", "debit", "999", "999", false);
    entry("first", "2026-10-01", "debit", "40", "32");
    entry("after", "2026-11-01", "debit", "900", "900");
    // Other accounts and orphaned lines cannot affect this account's ledger.
    s.lines.push({ ...s.lines[0], id: "other", account_id: "b" });
    s.lines.push({ ...s.lines[0], id: "orphan", transaction_id: "missing" });
    const result = accountLedger(s, "a", "2026-10-01", "2026-10-31");
    expect(result).toMatchObject({
      opening: "75.00", debit: "32.00", credit: "8.00", closing: "99.00",
      native: { currency: "SGD", opening: "100.00", debit: "40.00", credit: "10.00", closing: "130.00" },
    });
    expect(result.rows.map((r) => [r.transaction.id, r.balance, r.nativeBalance]))
      .toEqual([["first", "107.00", "140.00"], ["last", "99.00", "130.00"]]);
    expect(result.closing).toBe(accountBalance(s, "a", "2026-10-31").book);
    expect(money(d(result.opening).plus(result.debit).minus(result.credit)))
      .toBe(result.closing);
  });

  it("shows both a posted entry and its reversal, while excluding a draft reversal", () => {
    const { s, entry } = fixture();
    entry("original", "2026-09-30", "debit", "100", "75");
    entry("reverse", "2026-10-01", "credit", "100", "75");
    s.transactions[1].kind = "reversal";
    s.transactions[1].reversal_of_id = "original";
    entry("draft", "2026-10-02", "debit", "100", "75", false);
    s.transactions[2].reversal_of_id = "reverse";
    expect(accountLedger(s, "a")).toMatchObject({
      opening: "0.00", debit: "75.00", credit: "75.00", closing: "0.00",
      rows: [{ transaction: { id: "original" } }, { transaction: { id: "reverse" } }],
    });
    expect(accountLedger(s, "a", "2026-10-01")).toMatchObject({
      opening: "75.00", debit: "0.00", credit: "75.00", closing: "0.00",
    });
  });

  it.each(["asset", "expense", "liability", "equity", "revenue"] as const)(
    "keeps debit and credit sides explicit for %s accounts, including inactive accounts",
    (type) => {
      const { s, entry } = fixture(type);
      s.accounts[0].is_active = false;
      entry("credit", "2026-10-01", "credit", "100", "75");
      const result = accountLedger(s, "a");
      expect(result.closing).toBe("-75.00");
      const normalSign = ["asset", "expense"].includes(type) ? 1 : -1;
      expect(money(d(result.closing).times(normalSign))).toBe(accountBalance(s, "a").book);
    },
  );

  it("totals mixed currencies only in home currency and retains each original amount", () => {
    const { s, entry } = fixture("expense", null);
    entry("sgd", "2026-10-01", "debit", "100", "75");
    entry("thb", "2026-10-02", "debit", "1000", "30", true, "THB");
    const result = accountLedger(s, "a");
    expect(result).toMatchObject({ debit: "105.00", closing: "105.00", native: null });
    expect(result.rows.map((r) => [r.line.amount, r.line.currency_code, r.nativeBalance]))
      .toEqual([["100", "SGD", null], ["1000", "THB", null]]);
  });

  it("retains separate lines on both sides of one journal and orders ties consistently", () => {
    const { s, entry } = fixture();
    entry("a", "2026-10-01", "debit", "100");
    s.lines.push({ ...s.lines[0], id: "z-line", side: "credit", amount: "20", book_amount: "20" });
    entry("b", "2026-10-01", "credit", "10");
    s.transactions.reverse();
    s.lines.reverse();
    const result = accountLedger(s, "a");
    expect(result).toMatchObject({ debit: "100.00", credit: "30.00", closing: "70.00" });
    expect(result.rows.map((r) => r.balance)).toEqual(["100.00", "80.00", "70.00"]);
  });

  it("preserves exact large amounts and carries balances through an empty period", () => {
    const { s, entry } = fixture();
    entry("large", "2026-09-01", "debit", "9007199254740993.10");
    entry("small", "2026-09-02", "debit", "0.20");
    expect(accountLedger(s, "a", "2026-10-01", "2026-10-31")).toMatchObject({
      opening: "9007199254740993.30", debit: "0.00", credit: "0.00",
      closing: "9007199254740993.30", rows: [],
    });
    expect(accountLedger(s, "a", "", "2026-08-31")).toMatchObject({
      opening: "0.00", closing: "0.00", rows: [],
    });
  });

  it("rejects unknown accounts and reversed date ranges", () => {
    const { s } = fixture();
    expect(() => accountLedger(s, "missing")).toThrow("Account not found");
    expect(() => accountLedger(s, "a", "2026-11-01", "2026-10-01")).toThrow(/From date/);
  });
});
