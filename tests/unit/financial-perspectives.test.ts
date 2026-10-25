import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { balanceMovement, movementDrill, previousDate } from "../../src/lib/balance-movement";
import { actualOpening, scenarioSnapshot, validateScenario } from "../../src/lib/scenarios";
import { scenarioInput, type ScenarioConfig } from "../../src/lib/scenario-contracts";
import { accountBalance, reports } from "../../src/lib/reports";
import { reportDetail } from "../../src/lib/report-detail";
import type { Account, Snapshot } from "../../src/lib/types";
function fixture() {
  const ids = { bank: randomUUID(), foreign: randomUUID(), capital: randomUUID(), income: randomUUID(), cost: randomUUID() };
  const accounts: Account[] = ([ [ids.bank, "asset", "USD"], [ids.foreign, "asset", "SGD"], [ids.capital, "equity", null], [ids.income, "revenue", null], [ids.cost, "expense", null] ] as const)
    .map(([id, type, currency_code]) => ({ id, name: id, type, currency_code, workspace_id: "w", role: "general", is_active: true }));
  const source: Snapshot = { workspace: { id: "w", owner_user_id: "owner", name: "Test", kind: "business", functional_currency_code: "USD", timezone: "UTC", created_at: "2026-01-01" },
    accounts, transactions: [], lines: [], parties: [], obligations: [], settlements: [] };
  function entry(date: string, debit: string, credit: string, book: string, amount = book, currency: "USD" | "SGD" = "USD", posted = true) {
    const id = randomUUID();
    source.transactions.push({ id, workspace_id: "w", accounting_date: date, description: id, kind: "adjustment", posted_at: posted ? date : null, party_id: null, created_at: date, reversal_of_id: null });
    source.lines.push(...([[debit, "debit"], [credit, "credit"]] as const).map(([account_id, side]) => ({
      id: randomUUID(), account_id, side, amount, book_amount: book, currency_code: currency, exchange_rate: "1", rate_source: null, workspace_id: "w", transaction_id: id,
    })));
    return id;
  }
  entry("2026-09-01", ids.bank, ids.capital, "1000");
  entry("2026-09-10", ids.bank, ids.income, "100");
  entry("2026-09-15", ids.foreign, ids.income, "75", "100", "SGD");
  const expense = entry("2026-10-01", ids.cost, ids.bank, "50");
  const income = entry("2026-10-02", ids.bank, ids.income, "200");
  const reversal = entry("2026-10-03", ids.bank, ids.cost, "50");
  source.transactions.at(-1)!.kind = "reversal"; source.transactions.at(-1)!.reversal_of_id = expense;
  const draft = entry("2026-10-05", ids.cost, ids.bank, "999", "999", "USD", false);
  const future = entry("2026-11-01", ids.bank, ids.income, "900");
  const config: ScenarioConfig = { id: randomUUID(), name: "Experiment", start_date: "2026-10-01", end_date: "2026-10-31", opening_mode: "actual", opening_balances: [], selected_transaction_ids: [expense, income, reversal] };
  return { source, ids, config, entry, income, expense, reversal, draft, future };
}
describe("financial perspectives", () => {
  it("reconciles strict opening, inclusive movement and closing, including accumulated results and Activity signs", () => {
    const { source, ids } = fixture();
    const movement = balanceMovement(source, "2026-10-01", "2026-10-31");
    expect(movement.totals[0]).toMatchObject({ opening: "1175.00", movement: "200.00", closing: "1375.00" });
    expect(movement.totals[2]).toMatchObject({ opening: "1175.00", movement: "200.00", closing: "1375.00" });
    expect(movement.rows.find((r) => r.group === "accumulated")).toMatchObject({ opening: "175.00", movement: "200.00", closing: "375.00" });
    const detail = reportDetail(source, "balance_movement", { from: "2026-10-01", to: "2026-10-31", group: "asset" });
    expect(detail.full.assets).toBe("200.00"); expect(detail.matching.assets).toBe("200.00");
    expect(detail.breakdown.map((r) => r.account.id)).toEqual([ids.bank]);
    expect(detail.breakdown[0]).toMatchObject({ debit: "250.00", credit: "50.00", net: "200.00", fullNet: "200.00" });
    expect(reportDetail(source, "balance_movement", { from: "2026-10-01", to: "2026-10-01", group: "accumulated" }).breakdown[0].net).toBe("-50.00");
    expect(movementDrill("2026-10-01", "2026-10-31", "opening", ids.bank)).toMatchObject({ mode: "balance_sheet", to: "2026-09-30" });
    expect(previousDate("2024-03-01")).toBe("2024-02-29");
    expect(() => balanceMovement(source, "", "2026-10-31")).toThrow(/Choose/);
    expect(() => balanceMovement(source, "2026-11-01", "2026-10-31")).toThrow(/Choose/);
  });
  it("copies an actual opening trial balance and reproduces closing totals without repeating prior P&L or losing native values", () => {
    const { source, ids, config } = fixture(), before = JSON.stringify(source);
    const simulated = scenarioSnapshot({ ...config, source_snapshot: source });
    expect(reports(simulated, config.start_date, config.end_date)).toMatchObject({ assets: "1375.00", equity: "1375.00", profit: "200.00", unclosed: "200.00" });
    expect(actualOpening(source, config.start_date).find((r) => r.account_id === "accumulated")!.book_balance).toBe("175.00000000");
    expect(accountBalance(simulated, ids.foreign)).toEqual({ native: "100.00", book: "75.00" });
    const movement = balanceMovement(simulated, config.start_date, config.end_date);
    expect(new Set(movement.rows.map((row) => row.id)).size).toBe(movement.rows.length);
    expect(movement.rows.find((row) => row.id === "accumulated")).toMatchObject({ opening: "175.00", closing: "175.00" });
    expect(movement.rows.find((row) => row.group === "accumulated")).toMatchObject({ opening: "0.00", closing: "200.00" });
    expect(JSON.stringify(source)).toBe(before);
    const frozen = structuredClone(source);
    source.transactions[0].description = "Changed actual description";
    expect(scenarioSnapshot({ ...config, source_snapshot: frozen }).transactions[1].description).not.toBe("Changed actual description");
  });
  it("replays selected whole entries over balanced custom and negative openings, preserving recorded FX values", () => {
    const { source, ids, config, expense, reversal } = fixture();
    const balances = actualOpening(source, config.start_date).map((row) => row.account_id === ids.bank ? { ...row, book_balance: "2100", native_balance: "2100" }
      : row.account_id === ids.capital ? { ...row, book_balance: "2000" } : row);
    const custom = { ...config, opening_mode: "custom" as const, opening_balances: balances };
    expect(reports(scenarioSnapshot({ ...custom, source_snapshot: source }), config.start_date, config.end_date)).toMatchObject({ assets: "2375.00", equity: "2375.00", profit: "200.00" });
    expect(reports(scenarioSnapshot({ ...custom, source_snapshot: source, selected_transaction_ids: [expense, reversal] }), config.start_date, config.end_date)).toMatchObject({ assets: "2175.00", profit: "0.00" });
    expect(reports(scenarioSnapshot({ ...custom, source_snapshot: source, selected_transaction_ids: [], opening_balances: [
      { account_id: ids.bank, book_balance: "-100", native_balance: "-100" }, { account_id: "accumulated", book_balance: "-100", native_balance: null },
    ] }), config.start_date, config.end_date)).toMatchObject({ assets: "-100.00", equity: "-100.00", profit: "0.00" });
  });
  it("rejects invalid opening accounts, unbalanced or mismatched currencies and unavailable replay entries", () => {
    const { source, ids, config, draft, future } = fixture();
    const custom = { ...config, opening_mode: "custom" as const };
    expect(() => validateScenario(source, { ...custom, opening_balances: [{ account_id: ids.income, book_balance: "0", native_balance: null }] })).toThrow(/workspace/);
    expect(() => validateScenario(source, { ...custom, opening_balances: [{ account_id: ids.bank, book_balance: "1", native_balance: "1" }] })).toThrow(/equal/);
    expect(() => validateScenario(source, { ...custom, opening_balances: [{ account_id: ids.bank, book_balance: "0", native_balance: null }] })).toThrow(/native/);
    expect(() => validateScenario(source, { ...custom, opening_balances: [{ account_id: ids.bank, book_balance: "0", native_balance: "1" }] })).toThrow(/match/);
    for (const id of [draft, future, randomUUID()]) expect(() => validateScenario(source, { ...config, selected_transaction_ids: [id] })).toThrow(/posted/);
    expect(scenarioInput.safeParse({ ...config, selected_transaction_ids: [config.selected_transaction_ids[0], config.selected_transaction_ids[0]] }).success).toBe(false);
    expect(scenarioInput.safeParse({ ...config, start_date: "2026-02-30" }).success).toBe(false);
  });
  it("keeps sub-cent and large opening values exact, handles empty periods and closing transfers without double counting", () => {
    const { source, ids, config, entry } = fixture();
    const custom = { ...config, source_snapshot: source, opening_mode: "custom" as const, selected_transaction_ids: [], opening_balances: [
      { account_id: ids.bank, book_balance: "9007199254740993.12345678", native_balance: "9007199254740993.12345678" },
      { account_id: ids.capital, book_balance: "9007199254740993.12345678", native_balance: null },
    ] };
    const simulated = scenarioSnapshot(custom);
    expect(simulated.lines.find((l) => l.account_id === ids.bank)!.book_amount).toBe("9007199254740993.12345678");
    expect(reports(simulated, config.start_date, config.end_date).profit).toBe("0.00");
    entry("2026-10-31", ids.income, ids.capital, "375");
    const movement = balanceMovement(source, "2026-10-04", "2026-10-31");
    expect(movement.totals[2]).toMatchObject({ opening: "1375.00", movement: "0.00", closing: "1375.00" });
    expect(movement.rows.find((r) => r.group === "accumulated")).toMatchObject({ movement: "-375.00", closing: "0.00" });
    const empty = { ...source, transactions: [], lines: [] };
    expect(reports(scenarioSnapshot({ ...config, selected_transaction_ids: [], source_snapshot: empty })).equity).toBe("0.00");
  });
});
