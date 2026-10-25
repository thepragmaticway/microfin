import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test("account ledgers show posted debit, credit and running balances across dates and workspaces", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { origin }, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  }
  const email = `ledger-${randomUUID()}@example.test`;
  const password = "A-ledger-test-password-123!";
  await post("/api/auth", { action: "register", email, password, display_name: "Ledger owner" });
  await post("/api/auth", { action: "login", email, password });
  const workspace = randomUUID(), path = `/api/workspaces/${workspace}`;
  await post("/api/workspaces", {
    id: workspace, name: "Ledger studio", kind: "business",
    functional_currency_code: "USD", timezone: "Asia/Bangkok",
  });
  const bank = randomUUID(), capital = randomUUID(), expense = randomUUID(), empty = randomUUID();
  for (const account of [
    { id: bank, name: "SGD bank", type: "asset", role: "bank", currency_code: "SGD" },
    { id: capital, name: "Owner capital", type: "equity", role: "general", currency_code: null },
    { id: expense, name: "Office costs", type: "expense", role: "general", currency_code: null },
    { id: empty, name: "Unused category", type: "expense", role: "general", currency_code: null },
  ]) await post(path + "/accounts", { ...account, is_active: true });

  async function entry(description: string, date: string, debit: string, credit: string, amount: string, book: string, rate: string, posted = true) {
    const id = randomUUID();
    await post(path + "/events", {
      post: posted,
      event: {
        id, accounting_date: date, kind: "adjustment", description,
        party_id: null, obligation: null, settlements: [],
        lines: [
          { account_id: debit, side: "debit" },
          { account_id: credit, side: "credit" },
        ].map((line) => ({
          ...line, id: randomUUID(), amount, book_amount: book,
          currency_code: "SGD", exchange_rate: rate,
          rate_source: credit === bank ? "carrying_value" : "manual",
        })),
      },
    });
    return id;
  }
  await entry("Opening funding", "2026-09-30", bank, capital, "100", "75", "0.75");
  const spending = await entry("October supplies", "2026-10-01", expense, bank, "20", "15", "0.75");
  await entry("More funding", "2026-10-02", bank, capital, "40", "32", "0.8");
  await entry("Unposted funding", "2026-10-03", bank, capital, "999", "999", "1", false);
  await post(path + "/reversals", { original: spending, reversal: randomUUID(), on_date: "2026-10-04" });

  await page.goto("/");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Open ledger ↗", exact: true }).click();
  await expect(page.getByRole("heading", { name: "SGD bank", exact: true })).toBeVisible();
  const ledger = page.getByRole("region", { name: "Account ledger", exact: true });
  const summary = ledger.locator(".ledger-summary");
  const stat = (label: string) => summary.locator(".stat").filter({ hasText: label });
  await ledger.getByLabel("From date").fill("2026-10-01");
  await ledger.getByLabel("Through date").fill("2026-10-31");
  await expect(stat("Opening balance")).toContainText("USD 75.00 Dr");
  await expect(stat("Opening balance")).toContainText("SGD 100.00 Dr");
  await expect(stat("Total debits")).toContainText("USD 47.00");
  await expect(stat("Total credits")).toContainText("USD 15.00");
  await expect(stat("Closing balance")).toContainText("USD 107.00 Dr");
  await expect(stat("Closing balance")).toContainText("SGD 140.00 Dr");
  await expect(ledger.getByRole("button", { name: "Unposted funding", exact: true })).toHaveCount(0);
  await expect(ledger.getByRole("button", { name: "Opening funding", exact: true })).toHaveCount(0);
  const supplies = ledger.getByRole("row").filter({ hasText: "October supplies" }).first();
  await expect(supplies).toContainText("USD 15.00");
  await expect(supplies).toContainText("SGD 20.00");
  await expect(supplies).toContainText("USD 60.00 Dr");
  const dates = await ledger.locator("tbody .ledger-date").allTextContents();
  expect(dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-04"]);
  await ledger.getByRole("button", { name: "October supplies", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Reversed");
  await expect(page.getByRole("dialog")).toHaveClass(/dialog-sheet/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Switching accounts retains the selected period; credit balances are explicit.
  await ledger.getByLabel("Ledger account").selectOption(capital);
  await expect(page.getByRole("heading", { name: "Owner capital", exact: true })).toBeVisible();
  await expect(ledger.getByLabel("From date")).toHaveValue("2026-10-01");
  await expect(stat("Opening balance")).toContainText("USD 75.00 Cr");
  await expect(stat("Total credits")).toContainText("USD 32.00");
  await expect(stat("Closing balance")).toContainText("USD 107.00 Cr");
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit account", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Edit account", exact: true })).not.toHaveClass(/dialog-sheet/);
  await page.keyboard.press("Escape");
  await ledger.getByRole("button", { name: "← All accounts", exact: true }).click();
  await page.getByRole("button", { name: "View ledger for Office costs", exact: true }).click();
  await ledger.getByLabel("Through date").fill("2026-10-01");
  await expect(stat("Closing balance")).toContainText("USD 15.00 Dr");
  await ledger.getByLabel("From date").fill("2026-11-01");
  await expect(ledger.getByRole("alert")).toContainText("From date must be on or before through date");
  await expect(ledger.getByRole("table")).toHaveCount(0);
  await ledger.getByLabel("Through date").fill("2026-11-30");
  await expect(ledger.getByRole("heading", { name: "No posted entries in this period" })).toBeVisible();
  await expect(stat("Closing balance")).toContainText("USD 0.00");
  await ledger.getByLabel("Ledger account").selectOption(empty);
  await expect(stat("Opening balance")).toContainText("USD 0.00");

  // Long tables scroll within the panel without widening the mobile document.
  await ledger.getByLabel("Ledger account").selectOption(bank);
  await ledger.getByLabel("From date").fill("2026-10-01");
  await ledger.getByLabel("Through date").fill("2026-10-31");
  await mkdir("test-results/visual", { recursive: true });
  await page.screenshot({ path: "test-results/visual/account-ledger-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const entries = ledger.getByRole("region", { name: "Ledger entries", exact: true });
  expect(await entries.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/visual/account-ledger-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: "test-results/visual/account-ledger-mobile-dark.png", fullPage: true });

  const personal = randomUUID();
  await post("/api/workspaces", {
    id: personal, name: "Personal ledger", kind: "personal",
    functional_currency_code: "USD", timezone: "UTC",
  });
  await page.reload();
  await page.getByLabel("Current workspace").selectOption(personal);
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your money, in its places." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account ledger", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View ledger for Owner capital" })).toHaveCount(0);
});
