import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test("Activity reports retain complete totals and reconcile filtered journal details with Reports", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { origin }, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  }
  const email = `activity-reports-${randomUUID()}@example.test`;
  const password = "An-activity-report-test-password-123!";
  await post("/api/auth", { action: "register", email, password, display_name: "Report owner" });
  await post("/api/auth", { action: "login", email, password });
  const workspace = randomUUID(), path = `/api/workspaces/${workspace}`;
  await post("/api/workspaces", {
    id: workspace, name: "Report studio", kind: "business",
    functional_currency_code: "USD", timezone: "Asia/Bangkok",
  });
  const bank = randomUUID(), sgd = randomUUID(), capital = randomUUID();
  const revenue = randomUUID(), costs = randomUUID(), payroll = randomUUID();
  const accounts = [
    { id: bank, name: "USD bank", type: "asset", role: "bank", currency_code: "USD" },
    { id: sgd, name: "SGD bank", type: "asset", role: "bank", currency_code: "SGD" },
    { id: capital, name: "Capital", type: "equity", role: "general", currency_code: null },
    { id: revenue, name: "Services", type: "revenue", role: "general", currency_code: null },
    { id: costs, name: "Operating costs", type: "expense", role: "general", currency_code: null },
    { id: payroll, name: "Payroll due", type: "liability", role: "general", currency_code: "USD" },
  ];
  for (const account of accounts) await post(path + "/accounts", { ...account, is_active: true });
  function line(account_id: string, side: string, amount: string) {
    return {
      id: randomUUID(), account_id, side, amount, book_amount: amount,
      currency_code: "USD", exchange_rate: "1", rate_source: null,
    };
  }
  async function entry(description: string, date: string, kind: string, lines: unknown[], posted = true) {
    const id = randomUUID();
    await post(path + "/events", {
      post: posted,
      event: { id, accounting_date: date, kind, description, party_id: null, obligation: null, settlements: [], lines },
    });
    return id;
  }
  await entry("Opening funds", "2026-09-30", "contribution", [line(bank, "debit", "1000"), line(capital, "credit", "1000")]);
  await entry("Prior costs", "2026-09-30", "expense", [line(costs, "debit", "50"), line(bank, "credit", "50")]);
  await entry("Foreign services", "2026-10-01", "income", [
    { ...line(sgd, "debit", "100"), currency_code: "SGD", exchange_rate: "0.75", book_amount: "75", rate_source: "manual" },
    { ...line(revenue, "credit", "100"), currency_code: "SGD", exchange_rate: "0.75", book_amount: "75", rate_source: "manual" },
  ]);
  await entry("USD services", "2026-10-02", "income", [line(bank, "debit", "200"), line(revenue, "credit", "200")]);
  await entry("October salary", "2026-10-03", "adjustment", [line(costs, "debit", "60"), line(costs, "debit", "40"), line(payroll, "credit", "100")]);
  const expense = await entry("October expense", "2026-10-04", "expense", [line(costs, "debit", "20"), line(bank, "credit", "20")]);
  await post(path + "/reversals", { original: expense, reversal: randomUUID(), on_date: "2026-10-05" });
  await entry("Draft costs", "2026-10-06", "adjustment", [line(costs, "debit", "999"), line(bank, "credit", "999")], false);
  await entry("Future services", "2026-11-01", "income", [line(bank, "debit", "900"), line(revenue, "credit", "900")]);
  // Inactive accounts must retain their historical report detail.
  await post(path + "/accounts", { ...accounts.find((a) => a.id === costs), is_active: false });

  await page.goto("/");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByLabel("From date").fill("2026-10-01");
  await page.getByLabel("Through date").fill("2026-10-31");
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await expect(page.getByRole("region", { name: "Activity summary" })).toContainText("USD -999.00");
  await page.getByLabel("Activity view").selectOption("profit_loss");
  await expect(page.getByLabel("Status", { exact: true })).toHaveCount(0);
  const full = page.getByRole("region", { name: "Complete report totals", exact: true });
  const matching = page.getByRole("region", { name: "Matching subtotal", exact: true });
  const fullStat = (label: string) => full.locator(".stat").filter({ hasText: label });
  const matchedStat = (label: string) => matching.locator(".stat").filter({ hasText: label });
  await expect(fullStat("Total income")).toContainText("USD 275.00");
  await expect(fullStat("Total expenses")).toContainText("USD 100.00");
  await expect(fullStat("Net profit / loss")).toContainText("USD 175.00");
  await page.getByLabel("Search entries").fill("SALARY");
  await expect(fullStat("Net profit / loss")).toContainText("USD 175.00");
  await expect(matchedStat("Net profit / loss")).toContainText("USD -100.00");
  await expect(matching).toContainText("2 journal lines across 1 entry");
  const details = page.getByRole("region", { name: "Matching account details", exact: true });
  const costsDetail = details.locator("details").filter({ hasText: "Operating costs" });
  await costsDetail.locator("summary").click();
  const journal = details.getByRole("region", { name: "Operating costs journal lines", exact: true });
  await expect(journal.locator("tbody tr")).toHaveCount(2);
  await expect(journal.locator("tfoot")).toContainText("USD 100.00");
  await expect(costsDetail).toContainText("inactive");
  await journal.getByRole("button", { name: "October salary", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "Entry details", exact: true });
  await expect(sheet).toContainText("October salary");
  await expect(sheet).toHaveClass(/dialog-sheet/);
  await expect.poll(async () => {
    const bounds = await sheet.boundingBox();
    return bounds ? Math.abs(bounds.x + bounds.width - 1440) : Infinity;
  }).toBeLessThan(1);
  await expect(sheet).toHaveCSS("height", "1000px");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(journal.getByRole("button", { name: "October salary", exact: true }).first()).toBeFocused();
  await page.getByLabel("Search entries").fill("no such entry");
  await expect(fullStat("Net profit / loss")).toContainText("USD 175.00");
  await expect(matchedStat("Net profit / loss")).toContainText("USD 0.00");
  await expect(page.getByRole("heading", { name: "No posted journal lines match" })).toBeVisible();
  await page.getByLabel("Search entries").fill("Foreign");
  await details.locator("summary").click();
  await expect(details.getByRole("table")).toContainText("SGD 100.00");
  await expect(details.getByRole("table")).toContainText("USD 75.00");
  await page.getByLabel("Search entries").fill("");
  await page.getByLabel("Account", { exact: true }).selectOption(revenue);
  await expect(matchedStat("Total income")).toContainText("USD 275.00");
  await expect(matchedStat("Total expenses")).toContainText("USD 0.00");
  await expect(fullStat("Total expenses")).toContainText("USD 100.00");
  await mkdir("test-results/visual", { recursive: true });
  await page.screenshot({ path: "test-results/visual/activity-profit-desktop.png", fullPage: true });

  await page.getByLabel("Activity view").selectOption("balance_sheet");
  await expect(page.getByLabel("From date")).toHaveCount(0);
  await expect(page.getByLabel("As of date")).toHaveValue("2026-10-31");
  await expect(fullStat("Total assets")).toContainText("USD 1,225.00");
  await expect(fullStat("Total liabilities")).toContainText("USD 100.00");
  await expect(fullStat("Total equity")).toContainText("USD 1,125.00");
  const accumulatedLink = page.getByRole("button", { name: "View accumulated unclosed profit/loss details", exact: true });
  await expect(accumulatedLink).toContainText("USD 125.00");
  await expect(full).toContainText("✓ Assets = liabilities + equity");
  await page.getByLabel("Search entries").fill("salary");
  await page.getByLabel("Account", { exact: true }).selectOption(payroll);
  await expect(matchedStat("Total liabilities")).toContainText("USD 100.00");
  await expect(fullStat("Total equity")).toContainText("USD 1,125.00");
  await details.locator("summary").click();
  await expect(details).toContainText("Net = credits − debits");
  await page.getByLabel("Search entries").fill("");
  await page.getByLabel("Account", { exact: true }).selectOption(costs);
  await costsDetail.locator("summary").click();
  await expect(costsDetail.locator("summary")).toContainText("USD -150.00");
  await expect(journal).toContainText("Prior costs");
  await expect(journal.locator("tfoot")).toContainText("USD 170.00");
  await expect(journal.locator("tfoot")).toContainText("USD 20.00");
  await expect(journal.locator("tfoot")).toContainText("USD -150.00");
  await page.getByLabel("As of date").fill("2026-09-30");
  await expect(fullStat("Total assets")).toContainText("USD 950.00");
  await expect(fullStat("Total equity")).toContainText("USD 950.00");
  await expect(journal).toContainText("Prior costs");
  await page.getByLabel("As of date").fill("2026-10-31");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/visual/activity-balance-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: "Reports", exact: true }).click();
  const profitReport = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Profit & loss", exact: true }) });
  const balanceReport = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Balance sheet", exact: true }) });
  await expect(profitReport).toContainText("USD 175.00");
  await expect(balanceReport).toContainText("USD 1,225.00");
  await expect(balanceReport).toContainText("USD 1,125.00");
  await profitReport.getByRole("button", { name: "Services ↗", exact: true }).click();
  await expect(page.getByLabel("Activity view")).toHaveValue("profit_loss");
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue(revenue);
  await expect(page.getByLabel("Search entries")).toHaveValue("");
  await expect(page.getByLabel("From date")).toHaveValue("2026-10-01");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  await expect(matchedStat("Total income")).toContainText("USD 275.00");
  await expect(fullStat("Net profit / loss")).toContainText("USD 175.00");
  for (const [name, id, metric, amount] of [
    ["USD bank", bank, "Total assets", "USD 1,150.00"],
    ["Payroll due", payroll, "Total liabilities", "USD 100.00"],
    ["Capital", capital, "Total equity", "USD 1,000.00"],
  ]) {
    await page.getByLabel("Search entries").fill("stale search");
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await balanceReport.getByRole("button", { name: `${name} ↗`, exact: true }).click();
    await expect(page.getByLabel("Activity view")).toHaveValue("balance_sheet");
    await expect(page.getByLabel("Account", { exact: true })).toHaveValue(id);
    await expect(page.getByLabel("Search entries")).toHaveValue("");
    await expect(page.getByLabel("From date")).toHaveCount(0);
    await expect(page.getByLabel("As of date")).toHaveValue("2026-10-31");
    await expect(matchedStat(metric)).toContainText(amount);
    await expect(fullStat("Total assets")).toContainText("USD 1,225.00");
  }
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByLabel("From date")).toHaveValue("2026-10-01");
  await profitReport.getByRole("button", { name: "Operating costs ↗", exact: true }).click();
  await expect(page.getByLabel("Activity view")).toHaveValue("profit_loss");
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue(costs);
  await expect(matchedStat("Total expenses")).toContainText("USD 100.00");
  await page.getByLabel("From date").fill("2026-11-01");
  await expect(page.getByRole("alert").filter({ hasText: "From date must be on or before through date" })).toBeVisible();
  await page.getByLabel("From date").fill("2026-10-01");
  await expect(fullStat("Net profit / loss")).toContainText("USD 175.00");

  // A calculated equity component opens all history, clearing unrelated Activity filters.
  const beforeDrill = (await (await page.request.get(path)).json()).data;
  await page.getByLabel("Activity view").selectOption("transactions");
  await page.getByLabel("Account", { exact: true }).selectOption(payroll);
  await page.getByLabel("Search entries").fill("Draft costs");
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(accumulatedLink).toContainText("USD 125.00");
  await expect(balanceReport).toContainText("included in total equity");
  await accumulatedLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Activity view")).toHaveValue("profit_loss");
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Search entries")).toHaveValue("");
  await expect(page.getByLabel("Status", { exact: true })).toHaveCount(0);
  await expect(fullStat("Total income")).toContainText("USD 275.00");
  await expect(fullStat("Total expenses")).toContainText("USD 150.00");
  await expect(fullStat("Net profit / loss")).toContainText("USD 125.00");
  await expect(matchedStat("Net profit / loss")).toContainText("USD 125.00");
  await costsDetail.locator("summary").click();
  await expect(journal).toContainText("Prior costs");
  await expect(journal.locator("tfoot")).toContainText("USD 170.00");
  await expect(journal.locator("tfoot")).toContainText("USD 20.00");
  await expect(journal.getByRole("button", { name: "Draft costs", exact: true })).toHaveCount(0);
  const revenueDetail = details.locator("details").filter({ hasText: "Services" });
  await revenueDetail.locator("summary").click();
  await expect(revenueDetail).toContainText("SGD 100.00");
  await expect(revenueDetail.getByRole("button", { name: "Future services", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const foreignEntry = revenueDetail.getByRole("button", { name: "Foreign services", exact: true });
  await foreignEntry.click();
  await expect(sheet).toHaveClass(/dialog-sheet/);
  await expect(sheet).toHaveCSS("width", "390px");
  await expect(sheet).toHaveCSS("height", "844px");
  await expect(sheet).toHaveCSS("animation-name", "none");
  await expect(sheet).toContainText("Foreign services");
  await expect(sheet).toContainText("SGD 100.00");
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/visual/transaction-detail-sheet-mobile.png", fullPage: true });
  await sheet.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(foreignEntry).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/visual/accumulated-result-detail-desktop.png", fullPage: true });
  // Editing the drill-down dates must not replace the saved Reports period.
  await page.getByLabel("Through date").fill("2026-09-30");
  await expect(fullStat("Net profit / loss")).toContainText("USD -50.00");
  await page.getByRole("button", { name: "← Back to Reports", exact: true }).click();
  await expect(page.getByLabel("From date")).toHaveValue("2026-10-01");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  await expect(accumulatedLink).toContainText("USD 125.00");
  await expect(balanceReport).toContainText("USD 1,125.00");
  // The identical link in Activity's Balance sheet uses that view's As of date.
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByLabel("Activity view").selectOption("balance_sheet");
  await page.getByLabel("As of date").fill("2026-09-30");
  await expect(accumulatedLink).toContainText("USD -50.00");
  await accumulatedLink.click();
  await expect(page.getByLabel("Activity view")).toHaveValue("profit_loss");
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-09-30");
  await expect(fullStat("Net profit / loss")).toContainText("USD -50.00");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByLabel("From date")).toHaveValue("2026-10-01");
  await expect(page.getByLabel("Through date")).toHaveValue("2026-09-30");
  const afterDrill = (await (await page.request.get(path)).json()).data;
  expect(afterDrill.transactions).toEqual(beforeDrill.transactions);
  expect(afterDrill.lines).toEqual(beforeDrill.lines);

  const personal = randomUUID();
  await post("/api/workspaces", { id: personal, name: "Personal reports", kind: "personal", functional_currency_code: "USD", timezone: "UTC" });
  await page.reload();
  await page.getByLabel("Current workspace").selectOption(personal);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByLabel("Activity view").selectOption("balance_sheet");
  await expect(fullStat("Total assets")).toContainText("USD 0.00");
  await expect(fullStat("Total equity")).toContainText("USD 0.00");
  await expect(details.locator("details")).toHaveCount(0);
  await expect(accumulatedLink).toContainText("USD 0.00");
  await accumulatedLink.click();
  await expect(page.getByLabel("Activity view")).toHaveValue("profit_loss");
  await expect(fullStat("Net profit / loss")).toContainText("USD 0.00");
  await expect(details.locator("details")).toHaveCount(0);
  await page.getByLabel("Current workspace").selectOption(workspace);
  await expect(page.getByLabel("Activity view")).toHaveValue("transactions");
  await expect(page.getByRole("button", { name: "← Back to Reports", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("From date")).not.toHaveValue("");
});
