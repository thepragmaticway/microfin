import { describe, expect, it } from "vitest";
import { reportDetail } from "../../src/lib/report-detail";
import { reports } from "../../src/lib/reports";
import type { Account, JournalLine, Snapshot } from "../../src/lib/types";

function fixture() {
  const accounts: Account[] = [
    { id: "bank", workspace_id: "w", name: "USD bank", type: "asset", role: "bank", currency_code: "USD", is_active: true },
    { id: "sgd", workspace_id: "w", name: "SGD bank", type: "asset", role: "bank", currency_code: "SGD", is_active: true },
    { id: "capital", workspace_id: "w", name: "Capital", type: "equity", role: "general", currency_code: null, is_active: true },
    { id: "revenue", workspace_id: "w", name: "Services", type: "revenue", role: "general", currency_code: null, is_active: true },
    { id: "costs", workspace_id: "w", name: "Costs", type: "expense", role: "general", currency_code: null, is_active: false },
    { id: "payroll", workspace_id: "w", name: "Payroll due", type: "liability", role: "general", currency_code: "USD", is_active: true },
  ];
  const s: Snapshot = {
    workspace: { id: "w", owner_user_id: "u", name: "Studio", kind: "business", functional_currency_code: "USD", timezone: "UTC", created_at: "2026-01-01" },
    accounts, transactions: [], lines: [], parties: [], obligations: [], settlements: [],
  };
  function entry(id: string, date: string, lines: Pick<JournalLine, "account_id" | "side" | "book_amount">[], posted = true) {
    s.transactions.push({
      id, workspace_id: "w", accounting_date: date, kind: "adjustment", description: id,
      party_id: null, posted_at: posted ? `${date}T12:00:00Z` : null,
      reversal_of_id: null, created_at: `${date}T12:00:00Z`,
    });
    s.lines.push(...lines.map((line, i) => ({
      id: `${id}-${i}`, workspace_id: "w", transaction_id: id, ...line,
      amount: line.book_amount, currency_code: "USD" as const, exchange_rate: "1", rate_source: null,
    })));
  }
  function pair(id: string, date: string, debit: string, credit: string, amount: string, posted = true) {
    entry(id, date, [
      { account_id: debit, side: "debit", book_amount: amount },
      { account_id: credit, side: "credit", book_amount: amount },
    ], posted);
  }
  pair("Opening funds", "2026-09-30", "bank", "capital", "1000");
  pair("Prior costs", "2026-09-30", "costs", "bank", "50");
  pair("Foreign income", "2026-10-01", "sgd", "revenue", "75");
  for (const line of s.lines.filter((line) => line.transaction_id === "Foreign income")) {
    line.currency_code = "SGD";
    line.amount = "100";
    line.exchange_rate = "0.75";
    line.rate_source = "manual";
  }
  pair("USD income", "2026-10-02", "bank", "revenue", "200");
  entry("Salary", "2026-10-03", [
    { account_id: "costs", side: "debit", book_amount: "60" },
    { account_id: "costs", side: "debit", book_amount: "40" },
    { account_id: "payroll", side: "credit", book_amount: "100" },
  ]);
  pair("Expense", "2026-10-04", "costs", "bank", "20");
  pair("Reverse expense", "2026-10-05", "bank", "costs", "20");
  s.transactions.at(-1)!.kind = "reversal";
  s.transactions.at(-1)!.reversal_of_id = "Expense";
  pair("Draft", "2026-10-06", "costs", "bank", "999", false);
  pair("Future income", "2026-11-01", "bank", "revenue", "900");
  return s;
}
const dates = { from: "2026-10-01", to: "2026-10-31" };

describe("Activity accounting report detail", () => {
  it("reconciles posted period income, expenses and profit with Reports", () => {
    const s = fixture(), detail = reportDetail(s, "profit_loss", dates);
    expect(detail.full).toMatchObject({ revenue: "275.00", expenses: "100.00", profit: "175.00" });
    expect(detail.full).toEqual(reports(s, dates.from, dates.to));
    expect(detail.matching.profit).toBe("175.00");
    expect(detail.lineCount).toBe(6);
    expect(detail.transactionCount).toBe(5);
    expect(detail.breakdown.find((row) => row.account.id === "revenue")).toMatchObject({ debit: "0.00", credit: "275.00", net: "275.00", fullNet: "275.00" });
    const costs = detail.breakdown.find((row) => row.account.id === "costs")!;
    expect(costs).toMatchObject({ debit: "120.00", credit: "20.00", net: "100.00", sign: 1 });
    expect(costs.entries.some((row) => row.transaction.id === "Draft")).toBe(false);
  });

  it("retains complete totals while case-insensitive search and account filters scope matching lines", () => {
    const s = fixture(), detail = reportDetail(s, "profit_loss", { ...dates, search: "SALARY", accountId: "costs" });
    expect(detail.full.profit).toBe("175.00");
    expect(detail.matching).toMatchObject({ revenue: "0.00", expenses: "100.00", profit: "-100.00" });
    expect(detail.lineCount).toBe(2);
    expect(detail.transactionCount).toBe(1);
    expect(detail.breakdown).toHaveLength(1);
    expect(detail.breakdown[0]).toMatchObject({ debit: "100.00", credit: "0.00", net: "100.00", fullNet: "100.00" });
    const none = reportDetail(s, "profit_loss", { ...dates, search: "Salary", accountId: "revenue" });
    expect(none.full.profit).toBe("175.00");
    expect(none.matching.profit).toBe("0.00");
    expect(none.breakdown).toEqual([]);
  });

  it("includes earlier balances and accumulated results once, ignoring From in the balance sheet", () => {
    const s = fixture(), detail = reportDetail(s, "balance_sheet", dates);
    expect(detail.full).toMatchObject({ assets: "1225.00", liabilities: "100.00", contributedEquity: "1000.00", unclosed: "125.00", equity: "1125.00" });
    expect(detail.full).toEqual(reports(s, "", dates.to));
    const costs = detail.breakdown.find((row) => row.account.id === "costs")!;
    expect(costs).toMatchObject({ debit: "170.00", credit: "20.00", net: "-150.00", fullNet: "-150.00", sign: -1 });
    expect(costs.entries[0].transaction.id).toBe("Prior costs");
    const earlier = reportDetail(s, "balance_sheet", { from: "2026-12-01", to: "2026-09-30" });
    expect(earlier.full).toMatchObject({ assets: "950.00", liabilities: "0.00", equity: "950.00", unclosed: "-50.00" });
  });

  it("reconciles all-history accumulated detail before and after closing journals without increasing equity", () => {
    const s = fixture();
    const detail = (to = dates.to) => reportDetail(s, "profit_loss", { to });
    expect(detail().full).toMatchObject({ revenue: "275.00", expenses: "150.00", profit: "125.00" });
    expect(detail("2026-09-30").full.profit).toBe("-50.00");
    expect(detail("2025-01-01").full.profit).toBe("0.00");
    // Add a prior year's receipt, then close only that result to an equity account.
    s.transactions.push({ ...s.transactions[0], id: "prior-income", accounting_date: "2025-12-30", description: "Prior-year income" });
    const template = s.lines[0];
    s.lines.push(
      { ...template, id: "prior-bank", transaction_id: "prior-income", account_id: "bank", side: "debit", amount: "30", book_amount: "30" },
      { ...template, id: "prior-revenue", transaction_id: "prior-income", account_id: "revenue", side: "credit", amount: "30", book_amount: "30" },
    );
    expect(detail().full.profit).toBe("155.00");
    expect(reports(s, dates.from, dates.to).equity).toBe("1155.00");
    s.transactions.push({ ...s.transactions[0], id: "prior-close", accounting_date: "2025-12-31", description: "Prior-year closing" });
    s.lines.push(
      { ...template, id: "close-revenue", transaction_id: "prior-close", account_id: "revenue", side: "debit", amount: "30", book_amount: "30" },
      { ...template, id: "close-equity", transaction_id: "prior-close", account_id: "capital", side: "credit", amount: "30", book_amount: "30" },
    );
    expect(detail().full.profit).toBe("125.00");
    expect(reports(s, dates.from, dates.to)).toMatchObject({ contributedEquity: "1030.00", unclosed: "125.00", equity: "1155.00" });
    expect(detail().breakdown.find((row) => row.account.id === "revenue")!.entries.map((row) => row.transaction.id)).toContain("prior-close");
    // Closing the remaining revenue/expense balances leaves zero unclosed result.
    s.transactions.push({ ...s.transactions[0], id: "final-close", accounting_date: dates.to, description: "Remaining closing" });
    s.lines.push(
      { ...template, id: "final-revenue", transaction_id: "final-close", account_id: "revenue", side: "debit", amount: "275", book_amount: "275" },
      { ...template, id: "final-costs", transaction_id: "final-close", account_id: "costs", side: "credit", amount: "150", book_amount: "150" },
      { ...template, id: "final-equity", transaction_id: "final-close", account_id: "capital", side: "credit", amount: "125", book_amount: "125" },
    );
    expect(detail().full).toMatchObject({ revenue: "0.00", expenses: "0.00", profit: "0.00" });
    expect(detail().matching.profit).toBe("0.00");
    expect(reports(s, dates.from, dates.to)).toMatchObject({ contributedEquity: "1155.00", unclosed: "0.00", equity: "1155.00" });
  });

  it("keeps credit-positive liability and equity contributions separate from complete balance-sheet totals", () => {
    const detail = reportDetail(fixture(), "balance_sheet", { ...dates, search: "Salary", accountId: "payroll" });
    expect(detail.full.equity).toBe("1125.00");
    expect(detail.matching).toMatchObject({ assets: "0.00", liabilities: "100.00", equity: "0.00" });
    expect(detail.breakdown[0]).toMatchObject({ debit: "0.00", credit: "100.00", net: "100.00", sign: -1 });
  });

  it("retains zero-net reversal detail and original foreign amounts without merging native currencies", () => {
    const s = fixture();
    const reversed = reportDetail(s, "profit_loss", { ...dates, search: "expense" });
    expect(reversed.breakdown[0]).toMatchObject({ debit: "20.00", credit: "20.00", net: "0.00" });
    expect(reversed.breakdown[0].entries.map((row) => row.net)).toEqual(["20.00", "-20.00"]);
    const foreign = reportDetail(s, "profit_loss", { ...dates, search: "Foreign" });
    expect(foreign.matching.revenue).toBe("75.00");
    expect(foreign.breakdown[0].entries[0]).toMatchObject({ net: "75.00", line: { amount: "100", currency_code: "SGD", book_amount: "75" } });
  });

  it("rejects an invalid profit period and handles no matches or an empty workspace without losing complete totals", () => {
    const s = fixture();
    expect(() => reportDetail(s, "profit_loss", { from: "2026-11-01", to: "2026-10-01" })).toThrow(/From date/);
    const empty = reportDetail(s, "balance_sheet", { ...dates, search: "no such entry" });
    expect(empty.full.assets).toBe("1225.00");
    expect(empty.matching).toMatchObject({ assets: "0.00", liabilities: "0.00", equity: "0.00" });
    expect(empty.lineCount).toBe(0);
    expect(empty.breakdown).toEqual([]);
    const other = reportDetail({ ...s, accounts: [], lines: [], transactions: [] }, "profit_loss", dates);
    expect(other.full.profit).toBe("0.00");
    expect(other.breakdown).toEqual([]);
  });
});
