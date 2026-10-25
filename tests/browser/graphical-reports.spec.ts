import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test("graphical reports reconcile charts, category/group drill-downs, dates and negative equity on mobile", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { origin }, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  }
  const email = `charts-${randomUUID()}@example.test`, password = "A-chart-test-password-123!";
  await post("/api/auth", { action: "register", email, password, display_name: "Chart owner" });
  await post("/api/auth", { action: "login", email, password });
  const workspace = randomUUID(), path = `/api/workspaces/${workspace}`;
  await post("/api/workspaces", { id: workspace, name: "Chart studio", kind: "business", functional_currency_code: "USD", timezone: "UTC" });
  const bank = randomUUID(), foreign = randomUUID(), capital = randomUUID(), revenue = randomUUID(), costs = randomUUID(), debt = randomUUID();
  for (const [id, name, type, role, currency_code] of [
    [bank, "USD bank", "asset", "bank", "USD"], [foreign, "SGD bank", "asset", "bank", "SGD"],
    [capital, "Capital", "equity", "general", null], [revenue, "Services", "revenue", "general", null],
    [costs, "Office costs", "expense", "general", "USD"], [debt, "Payroll due", "liability", "general", "USD"],
  ]) await post(path + "/accounts", { id, name, type, role, currency_code, is_active: true });
  function line(account_id: string, side: string, amount: string) {
    return { id: randomUUID(), account_id, side, amount, book_amount: amount, currency_code: "USD", exchange_rate: "1", rate_source: null };
  }
  async function entry(description: string, date: string, lines: unknown[], posted = true) {
    const id = randomUUID();
    await post(path + "/events", { post: posted, event: { id, accounting_date: date, kind: "adjustment", description,
      party_id: null, obligation: null, settlements: [], lines } });
    return id;
  }
  await entry("Opening funds", "2026-09-30", [line(bank, "debit", "1000"), line(capital, "credit", "1000")]);
  await entry("Earlier costs", "2026-09-01", [line(costs, "debit", "50"), line(bank, "credit", "50")]);
  await entry("Foreign services", "2026-10-01", [
    { ...line(foreign, "debit", "100"), currency_code: "SGD", book_amount: "75", exchange_rate: "0.75", rate_source: "manual" },
    { ...line(revenue, "credit", "100"), currency_code: "SGD", book_amount: "75", exchange_rate: "0.75", rate_source: "manual" },
  ]);
  await entry("Local services", "2026-10-02", [line(bank, "debit", "200"), line(revenue, "credit", "200")]);
  await entry("Salary accrued", "2026-10-03", [line(costs, "debit", "100"), line(debt, "credit", "100")]);
  const reversed = await entry("Reversed costs", "2026-10-04", [line(costs, "debit", "20"), line(bank, "credit", "20")]);
  await post(path + "/reversals", { original: reversed, reversal: randomUUID(), on_date: "2026-10-05" });
  await entry("Draft costs", "2026-10-06", [line(costs, "debit", "999"), line(bank, "credit", "999")], false);
  await entry("Future services", "2026-11-01", [line(bank, "debit", "900"), line(revenue, "credit", "900")]);
  await page.goto("/");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByLabel("Search entries").fill("stale search");
  await page.getByLabel("Account", { exact: true }).selectOption(bank);
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByLabel("From date").fill("2026-09-15");
  await page.getByLabel("Through date").fill("2026-10-31");
  const presentation = page.getByRole("group", { name: "Report presentation", exact: true });
  const reportTabs = page.getByRole("group", { name: "Graphical report", exact: true });
  await expect(presentation.getByRole("button", { name: "Detailed", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("USD 175.00", { exact: true }).first()).toBeVisible();
  await presentation.getByRole("button", { name: "Graphical", exact: true }).click();
  const summary = page.getByRole("region", { name: "Graphical report summary", exact: true });
  const card = (name: string) => summary.locator(".graph-stat").filter({ hasText: name });
  await expect(card("Revenue")).toContainText("USD 275.00");
  await expect(card("Expenses")).toContainText("USD 100.00");
  await expect(card("Net profit / loss")).toContainText("USD 175.00");
  const trend = page.getByRole("region", { name: "Interactive report trend", exact: true });
  await expect(trend.getByRole("button", { name: "Revenue, Oct 2026: USD 275.00", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Category type", exact: true }).getByRole("button", { name: "Revenue", exact: true }).click();
  await card("Revenue").click();
  await expect(page.getByLabel("Activity view")).toHaveValue("profit_loss");
  await expect(page.getByLabel("Report group")).toHaveValue("revenue");
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Search entries")).toHaveValue("");
  await expect(page.getByLabel("From date")).toHaveValue("2026-09-15");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  const matching = page.getByRole("region", { name: "Matching subtotal", exact: true });
  await expect(matching.locator(".stat").filter({ hasText: "Total income" })).toContainText("USD 275.00");
  await expect(matching.locator(".stat").filter({ hasText: "Total expenses" })).toContainText("USD 0.00");
  const back = page.getByRole("button", { name: "← Back to Reports", exact: true });
  await back.click();
  await expect(presentation.getByRole("button", { name: "Graphical", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Revenue categories", exact: true })).toBeVisible();
  // SVG marks are keyboard-operable and select the exact month, rather than the full report period.
  const october = trend.getByRole("button", { name: "Revenue, Oct 2026: USD 275.00", exact: true });
  await october.focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("From date")).toHaveValue("2026-10-01");
  await page.getByLabel("Through date").fill("2026-10-10");
  await back.click();
  await expect(page.getByLabel("From date")).toHaveValue("2026-09-15");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  await page.getByRole("button", { name: "View Services: USD 275.00", exact: true }).click();
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue(revenue);
  await page.getByRole("region", { name: "Matching account details", exact: true }).locator("summary").click();
  await expect(page.getByRole("table")).toContainText("SGD 100.00");
  await page.getByRole("button", { name: "Foreign services", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveClass(/dialog-sheet/);
  await page.keyboard.press("Escape"); await back.click();
  await reportTabs.getByRole("button", { name: "Balance sheet", exact: true }).click();
  await expect(page.getByLabel("From date")).toHaveCount(0);
  await expect(page.getByLabel("As of date")).toHaveValue("2026-10-31");
  await expect(card("Assets")).toContainText("USD 1,225.00");
  await expect(card("Liabilities")).toContainText("USD 100.00");
  await expect(card("Total equity")).toContainText("USD 1,125.00");
  await card("Total equity").click();
  await expect(page.getByLabel("Activity view")).toHaveValue("balance_sheet");
  await expect(page.getByLabel("Report group")).toHaveValue("equity");
  await expect(matching.locator(".stat").filter({ hasText: "Total equity" })).toContainText("USD 1,125.00");
  await expect(page.getByRole("region", { name: "Matching account details", exact: true }).locator("details")).toHaveCount(3);
  await back.click();
  const composition = page.getByRole("region", { name: "Balance sheet composition", exact: true });
  await composition.getByRole("button", { name: "USD bank: USD 1,150.00", exact: true }).click();
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue(bank);
  await expect(page.getByLabel("As of date")).toHaveValue("2026-10-31");
  await back.click();
  await trend.getByRole("button", { name: "Equity, Sep 2026: USD 950.00", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("As of date")).toHaveValue("2026-09-30");
  await expect(matching.locator(".stat").filter({ hasText: "Total equity" })).toContainText("USD 950.00");
  await back.click();
  await page.getByRole("button", { name: "View accumulated unclosed profit/loss details", exact: true }).click();
  await expect(page.getByLabel("Activity view")).toHaveValue("profit_loss");
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expect(matching.locator(".stat").filter({ hasText: "Net profit / loss" })).toContainText("USD 125.00");
  await back.click();
  await presentation.getByRole("button", { name: "Detailed", exact: true }).click();
  await expect(page.getByLabel("From date")).toHaveValue("2026-09-15");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  await expect(page.getByText("USD 175.00", { exact: true }).first()).toBeVisible();
  await mkdir("test-results/visual", { recursive: true });

  // A larger unpaid expense produces negative equity without making the bank overdrawn.
  await entry("Extra accrued costs", "2026-10-10", [line(costs, "debit", "1200"), line(debt, "credit", "1200")]);
  await page.reload();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByLabel("From date").fill("2026-09-15"); await page.getByLabel("Through date").fill("2026-10-31");
  await presentation.getByRole("button", { name: "Graphical", exact: true }).click();
  await expect(card("Net profit / loss")).toContainText("USD -1,025.00");
  await page.screenshot({ path: "test-results/visual/graphical-profit-desktop.png", fullPage: true });
  await reportTabs.getByRole("button", { name: "Balance sheet", exact: true }).click();
  await expect(card("Total equity")).toContainText("USD -75.00");
  await expect(summary).toContainText("✓ Assets = liabilities + equity");
  await expect(composition.getByRole("button", { name: "Accumulated unclosed profit/loss: USD -1,075.00", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/visual/graphical-balance-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Switch color theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await trend.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/visual/graphical-balance-mobile-dark.png", fullPage: true });
  await page.getByRole("region", { name: "Assets and funding", exact: true }).getByText("View composition data", { exact: true }).click();
  await expect(page.getByRole("table", { name: "Balance sheet components in USD", exact: true })).toContainText("USD -1,075.00");
  await page.getByRole("region", { name: "Report trends", exact: true }).getByText("View trend data", { exact: true }).click();
  await expect(page.getByRole("table", { name: "Exact report trend values in USD", exact: true })).toContainText("USD -75.00");
  const personal = randomUUID();
  await post("/api/workspaces", { id: personal, name: "Empty charts", kind: "personal", functional_currency_code: "THB", timezone: "Asia/Bangkok" });
  await page.reload(); await page.getByLabel("Current workspace").selectOption(personal);
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await presentation.getByRole("button", { name: "Graphical", exact: true }).click();
  await expect(card("Revenue")).toContainText("THB 0.00");
  await expect(page.getByText("No nonzero posted account balances in this scope.", { exact: true })).toBeVisible();
  await page.getByLabel("From date").fill("1900-01-01");
  await expect(page.getByRole("heading", { name: "Revenue, expenses and profit by year group", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
