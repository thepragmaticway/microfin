import { describe, expect, it } from "vitest";
import { chartDomain, reportChartData } from "../../src/lib/report-charts";
import { reportDetail } from "../../src/lib/report-detail";
import { d } from "../../src/lib/money";
import type { Account, AccountType, Snapshot } from "../../src/lib/types";

function fixture() {
  const accounts: Account[] = ([
    ["bank", "asset"], ["capital", "equity"], ["income", "revenue"], ["costs", "expense"], ["debt", "liability"],
  ] as [string, AccountType][]).map(([id, type]) => ({ id, name: id, type, workspace_id: "w", role: "general", currency_code: null, is_active: true }));
  const s: Snapshot = {
    workspace: { id: "w", name: "Studio", owner_user_id: "u", kind: "business", functional_currency_code: "USD", timezone: "UTC", created_at: "2026-01-01" },
    accounts, transactions: [], lines: [], parties: [], obligations: [], settlements: [],
  };
  function entry(id: string, date: string, debit: string, credit: string, value: string, posted = true) {
    s.transactions.push({ id, workspace_id: "w", accounting_date: date, kind: "adjustment", description: id, party_id: null,
      posted_at: posted ? date : null, created_at: date, reversal_of_id: null });
    for (const [account_id, side] of [[debit, "debit"], [credit, "credit"]] as const)
      s.lines.push({ id: id + side, workspace_id: "w", transaction_id: id, account_id, side, amount: value,
        currency_code: "USD", exchange_rate: "1", book_amount: value, rate_source: null });
  }
  entry("capital", "2025-12-31", "bank", "capital", "1000");
  entry("earlier loss", "2026-01-01", "costs", "bank", "50");
  entry("before period", "2026-02-14", "bank", "income", "30");
  entry("foreign income", "2026-02-16", "bank", "income", "75");
  for (const line of s.lines.filter((l) => l.transaction_id === "foreign income")) {
    line.amount = "100"; line.currency_code = "SGD"; line.exchange_rate = "0.75"; line.rate_source = "manual";
  }
  entry("accrual", "2026-02-17", "costs", "debt", "100");
  entry("March income", "2026-03-01", "bank", "income", "200");
  entry("expense", "2026-03-02", "costs", "bank", "20");
  entry("reversal", "2026-03-03", "bank", "costs", "20");
  s.transactions.at(-1)!.kind = "reversal"; s.transactions.at(-1)!.reversal_of_id = "expense";
  entry("draft", "2026-03-04", "costs", "bank", "999", false);
  entry("future", "2026-03-11", "bank", "income", "900");
  return { s, entry };
}

describe("graphical report data", () => {
  it("clips monthly periods exactly, preserves empty periods, and uses historical book values and reversals", () => {
    const { s } = fixture();
    const data = reportChartData(s, "profit_loss", "2026-02-15", "2026-03-10");
    expect(data.full).toMatchObject({ revenue: "275.00", expenses: "100.00", profit: "175.00" });
    expect(data.periods.map((p) => [p.from, p.to, p.values.profit])).toEqual([
      ["2026-02-15", "2026-02-28", "-25.00"], ["2026-03-01", "2026-03-10", "200.00"],
    ]);
    expect(data.revenue[0].value).toBe("275.00");
    expect(data.expenses[0].value).toBe("100.00");
    const gap = reportChartData(s, "profit_loss", "2026-04-01", "2026-05-31");
    expect(gap.periods.map((p) => p.values.profit)).toEqual(["0.00", "0.00"]);
    expect(gap.revenue).toEqual([]);
  });
  it("uses cumulative monthly closing balances with equity counted once, even when equity is negative", () => {
    const { s, entry } = fixture();
    entry("unpaid costs", "2026-03-05", "costs", "debt", "1200");
    const data = reportChartData(s, "balance_sheet", "2026-03-01", "2026-03-10");
    expect(data.full).toMatchObject({ assets: "1255.00", liabilities: "1300.00", equity: "-45.00", unclosed: "-1045.00" });
    expect(data.funding.find((row) => row.id === "accumulated")!.value).toBe("-1045.00");
    expect(data.funding.reduce((v, row) => v.plus(row.value), d(0)).toFixed(2)).toBe("1255.00");
    expect(data.periods).toHaveLength(12);
    expect(data.periods.at(-1)!.to).toBe("2026-03-10");
    expect(data.periods.at(-1)!.values.equity).toBe("-45.00");
    expect(data.periods.find((p) => p.to === "2025-12-31")!.values.assets).toBe("1000.00");
  });
  it("reconciles aggregate Activity groups with chart metrics and keeps complete totals independent of filters", () => {
    const { s } = fixture();
    const scope = { from: "2026-02-15", to: "2026-03-10" };
    const expense = reportDetail(s, "profit_loss", { ...scope, group: "expense" });
    expect(expense.matching).toMatchObject({ revenue: "0.00", expenses: "100.00", profit: "-100.00" });
    expect(expense.full.profit).toBe("175.00");
    expect(expense.breakdown.map((r) => r.account.id)).toEqual(["costs"]);
    const equity = reportDetail(s, "balance_sheet", { ...scope, group: "equity" });
    expect(equity.matching.equity).toBe("1155.00");
    expect(equity.breakdown.map((r) => r.account.type)).toEqual(["equity", "revenue", "expense"]);
    const assets = reportDetail(s, "balance_sheet", { ...scope, group: "asset" });
    expect(assets.matching.assets).toBe("1255.00");
    expect(assets.matching.equity).toBe("0.00");
    const mismatch = reportDetail(s, "balance_sheet", { ...scope, group: "asset", accountId: "income" });
    expect(mismatch.breakdown).toEqual([]);
  });
  it("bounds long histories with labeled nonoverlapping periods without dropping amounts or partial endpoints", () => {
    const { s, entry } = fixture();
    entry("old income", "1970-04-20", "bank", "income", "10");
    const data = reportChartData(s, "profit_loss", "1970-04-15", "2026-03-10");
    expect(data.interval).toBe("year group");
    expect(data.periods.length).toBeLessThanOrEqual(36);
    expect(data.periods[0].from).toBe("1970-04-15");
    expect(data.periods.at(-1)!.to).toBe("2026-03-10");
    expect(data.periods.reduce((v, p) => v.plus(p.values.profit), d(0)).toFixed(2)).toBe(data.full.profit);
    const extreme = reportChartData(s, "profit_loss", "0001-01-01", "9999-12-31");
    expect(extreme.periods.length).toBeLessThanOrEqual(36);
    expect(extreme.periods.at(-1)!.to).toBe("9999-12-31");
  });
  it("keeps large money exact and chart coordinates finite with zero, negative and large values", () => {
    const { s, entry } = fixture();
    entry("large receipt", "2026-03-07", "bank", "income", "9007199254740993.25");
    expect(reportChartData(s, "profit_loss", "2026-03-07", "2026-03-07").full.revenue).toBe("9007199254740993.25");
    const domain = chartDomain(["9007199254740993.25", "-9007199254740993.25"]);
    expect(domain.fraction("0")).toBe(.5);
    expect(domain.fraction("9007199254740993.25")).toBe(1);
    expect(chartDomain(["0.00"]).fraction("0")).toBe(0);
  });
  it("handles blank dates, empty workspaces and leap months, and rejects invalid profit periods", () => {
    const { s } = fixture();
    expect(reportChartData(s, "profit_loss", "", "2026-03-10").full.profit).toBe("155.00");
    expect(reportChartData(s, "profit_loss", "2024-02-10", "2024-03-01").periods[0].to).toBe("2024-02-29");
    const empty = reportChartData({ ...s, transactions: [], lines: [] }, "balance_sheet", "", "2026-01-10");
    expect(empty.full.equity).toBe("0.00");
    expect(empty.assets).toEqual([]);
    expect(empty.periods).toHaveLength(12);
    expect(() => reportChartData(s, "profit_loss", "2026-03-11", "2026-03-10")).toThrow(/From date/);
  });
});
