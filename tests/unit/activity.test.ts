import { describe, expect, it } from "vitest";
import { activityAmount, summarizeActivity } from "../../src/lib/activity";
import type { JournalLine, Snapshot } from "../../src/lib/types";

function fixture() {
  const s: Snapshot = {
    workspace: {
      id: "w", owner_user_id: "u", name: "Studio", kind: "business",
      functional_currency_code: "USD", timezone: "UTC", created_at: "2026-01-01",
    },
    accounts: [
      { id: "bank", name: "USD bank", type: "asset", role: "bank", currency_code: "USD" },
      { id: "sgd", name: "SGD bank", type: "asset", role: "bank", currency_code: "SGD" },
      { id: "expense", name: "Costs", type: "expense", role: "general", currency_code: null },
      { id: "revenue", name: "Services", type: "revenue", role: "general", currency_code: null },
    ].map((a) => ({ workspace_id: "w", is_active: true, ...a })) as Snapshot["accounts"],
    transactions: [], lines: [], parties: [], obligations: [], settlements: [],
  };
  function entry(id: string, lines: (Pick<JournalLine, "account_id" | "side" | "book_amount"> & Partial<Pick<JournalLine, "amount" | "currency_code">>)[], posted = true) {
    const transaction = {
      id, workspace_id: "w", accounting_date: "2026-10-01", kind: "adjustment" as const,
      description: id, party_id: null, posted_at: posted ? "2026-10-01T12:00:00Z" : null,
      reversal_of_id: null, created_at: "2026-10-01T12:00:00Z",
    };
    s.transactions.push(transaction);
    s.lines.push(...lines.map((line, i) => ({
      id: `${id}-${i}`, workspace_id: "w", transaction_id: id,
      amount: line.book_amount, currency_code: "USD" as const,
      exchange_rate: "1", rate_source: null, ...line,
    })));
    return transaction;
  }
  return { s, entry };
}

describe("activity totals", () => {
  it("sums signed money movements once and separates drafts", () => {
    const { s, entry } = fixture();
    entry("income", [
      { account_id: "bank", side: "debit", book_amount: "1000" },
      { account_id: "revenue", side: "credit", book_amount: "1000" },
    ]);
    entry("split expense", [
      { account_id: "bank", side: "credit", book_amount: "300" },
      { account_id: "expense", side: "debit", book_amount: "100" },
      { account_id: "expense", side: "debit", book_amount: "200" },
    ]);
    entry("draft", [{ account_id: "bank", side: "credit", book_amount: "40" }], false);
    expect(summarizeActivity(s, s.transactions)).toEqual({
      recorded: { count: 2, book: "700.00", native: null },
      drafts: { count: 1, book: "-40.00", native: null },
    });
  });

  it("nets money-account transfers and exposes the selected account's movement", () => {
    const { s, entry } = fixture();
    const transfer = entry("transfer", [
      { account_id: "bank", side: "credit", book_amount: "75" },
      { account_id: "sgd", side: "debit", book_amount: "75", amount: "100", currency_code: "SGD" },
    ]);
    expect(activityAmount(s, transfer)).toEqual({ book: "0.00", native: null });
    expect(summarizeActivity(s, [transfer], "bank").recorded).toEqual({ count: 1, book: "-75.00", native: "-75.00" });
    expect(summarizeActivity(s, [transfer], "sgd").recorded).toEqual({ count: 1, book: "75.00", native: "100.00" });
  });

  it("uses a non-money journal's debit total without adding its matching credits", () => {
    const { s, entry } = fixture();
    const journal = entry("journal", [
      { account_id: "expense", side: "debit", book_amount: "75", amount: "100", currency_code: "SGD" },
      { account_id: "expense", side: "debit", book_amount: "25", amount: "800", currency_code: "THB" },
      { account_id: "revenue", side: "credit", book_amount: "100" },
    ]);
    expect(activityAmount(s, journal)).toEqual({ book: "100.00", native: null });
    expect(summarizeActivity(s, [journal], "expense").recorded).toEqual({ count: 1, book: "100.00", native: null });
    expect(summarizeActivity(s, [journal], "revenue").recorded.book).toBe("-100.00");
  });

  it("sums both sides within a selected account and only the supplied matching rows", () => {
    const { s, entry } = fixture();
    const match = entry("match", [
      { account_id: "bank", side: "debit", book_amount: "100" },
      { account_id: "bank", side: "credit", book_amount: "20" },
    ]);
    entry("outside search", [{ account_id: "bank", side: "debit", book_amount: "999" }]);
    expect(summarizeActivity(s, [match], "bank").recorded).toEqual({ count: 1, book: "80.00", native: "80.00" });
    expect(summarizeActivity(s, [], "bank")).toEqual({
      recorded: { count: 0, book: "0.00", native: "0.00" },
      drafts: { count: 0, book: "0.00", native: "0.00" },
    });
  });

  it("includes matching reversals and keeps exact large and fractional row values", () => {
    const { s, entry } = fixture();
    entry("large", [{ account_id: "bank", side: "debit", book_amount: "9007199254740993.10" }]);
    entry("fraction", [{ account_id: "bank", side: "debit", book_amount: "0.20" }]);
    const reversed = entry("reversal", [{ account_id: "bank", side: "credit", book_amount: "0.20" }]);
    s.transactions[s.transactions.length - 1] = { ...reversed, kind: "reversal", reversal_of_id: "fraction" };
    expect(summarizeActivity(s, s.transactions).recorded).toEqual({ count: 3, book: "9007199254740993.10", native: null });
    expect(summarizeActivity(s, s.transactions.slice(0, 2)).recorded.book).toBe("9007199254740993.30");
  });

  it("reconciles totals to the rounded amounts actually shown in the rows", () => {
    const { s, entry } = fixture();
    entry("first", [{ account_id: "bank", side: "debit", book_amount: "0.005" }]);
    entry("second", [{ account_id: "bank", side: "debit", book_amount: "0.005" }]);
    expect(summarizeActivity(s, s.transactions).recorded.book).toBe("0.02");
  });
});
