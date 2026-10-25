import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test("activity totals follow search, account, status and dates with separate drafts and native currency", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { origin }, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  }
  const email = `summary-${randomUUID()}@example.test`;
  const password = "An-activity-test-password-123!";
  await post("/api/auth", { action: "register", email, password, display_name: "Activity owner" });
  await post("/api/auth", { action: "login", email, password });
  const workspace = randomUUID(), path = `/api/workspaces/${workspace}`;
  await post("/api/workspaces", {
    id: workspace, name: "Activity studio", kind: "business",
    functional_currency_code: "USD", timezone: "Asia/Bangkok",
  });
  const bank = randomUUID(), sgd = randomUUID(), expense = randomUUID(), capital = randomUUID();
  for (const account of [
    { id: bank, name: "USD bank", type: "asset", role: "bank", currency_code: "USD" },
    { id: sgd, name: "SGD bank", type: "asset", role: "bank", currency_code: "SGD" },
    { id: expense, name: "Rent", type: "expense", role: "general", currency_code: null },
    { id: capital, name: "Capital", type: "equity", role: "general", currency_code: null },
  ]) await post(path + "/accounts", { ...account, is_active: true });
  async function entry(description: string, date: string, debit: string, credit: string, amount: string, posted = true, foreign = false) {
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
          ...line, id: randomUUID(), amount,
          currency_code: foreign ? "SGD" : "USD",
          book_amount: foreign ? "75" : amount,
          exchange_rate: foreign ? "0.75" : "1",
          rate_source: foreign ? "manual" : null,
        })),
      },
    });
    return id;
  }
  await entry("Opening funds", "2026-09-30", bank, capital, "1000");
  await entry("Office rent A", "2026-10-02", expense, bank, "100");
  const rent = await entry("Office rent B", "2026-10-03", expense, bank, "150");
  await entry("Office rent draft", "2026-10-04", expense, bank, "40", false);
  await entry("Foreign funds", "2026-10-05", sgd, capital, "100", true, true);
  await post(path + "/reversals", { original: rent, reversal: randomUUID(), on_date: "2026-10-06" });

  await page.goto("/");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByLabel("From date").fill("2026-10-01");
  await page.getByLabel("Through date").fill("2026-10-31");
  const summary = page.getByRole("region", { name: "Activity summary", exact: true });
  const stat = (label: string) => summary.locator(".stat").filter({ hasText: label });
  const count = stat("Matching entries").locator(".stat-value");
  await expect(count).toHaveText("5");
  await expect(stat("Recorded total")).toContainText("USD -25.00");
  await expect(stat("Draft total")).toContainText("USD -40.00");
  await page.getByLabel("Search entries").fill("RENT");
  await expect(count).toHaveText("4");
  await expect(stat("Recorded total")).toContainText("USD -100.00");
  await expect(stat("Draft total")).toContainText("USD -40.00");
  await page.getByLabel("Status", { exact: true }).selectOption("posted");
  await expect(count).toHaveText("3");
  await expect(stat("Draft total")).toContainText("USD 0.00");
  await page.getByLabel("Through date").fill("2026-10-03");
  await expect(count).toHaveText("2");
  await expect(stat("Recorded total")).toContainText("USD -250.00");
  await page.getByLabel("From date").fill("2026-10-03");
  await expect(count).toHaveText("1");
  await expect(stat("Recorded total")).toContainText("USD -150.00");
  await page.getByLabel("Account", { exact: true }).selectOption(expense);
  await expect(stat("Recorded total")).toContainText("USD 150.00");
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await expect(count).toHaveText("0");
  await expect(stat("Recorded total")).toContainText("USD 0.00");
  await expect(page.getByRole("heading", { name: "No entries match your filters" })).toBeVisible();

  await page.getByLabel("From date").fill("2026-10-01");
  await page.getByLabel("Through date").fill("2026-10-31");
  await expect(count).toHaveText("1");
  await expect(stat("Draft total")).toContainText("USD 40.00");
  await page.getByLabel("Account", { exact: true }).selectOption(sgd);
  await page.getByLabel("Status", { exact: true }).selectOption("all");
  await page.getByLabel("Search entries").fill("");
  await expect(count).toHaveText("1");
  await expect(stat("Recorded total")).toContainText("USD 75.00");
  await expect(stat("Recorded total")).toContainText("SGD 100.00");
  await expect(page.locator(".rows .row")).toHaveCount(1);
  await expect(page.locator(".rows .row")).toContainText("USD 75.00");
  await expect(page.locator(".rows .row")).toContainText("SGD 100.00");
  await page.getByLabel("Search entries").fill("no such entry");
  await expect(count).toHaveText("0");
  await expect(stat("Recorded total")).toContainText("SGD 0.00");
  await page.getByLabel("Search entries").fill("");
  await mkdir("test-results/visual", { recursive: true });
  await page.screenshot({ path: "test-results/visual/activity-summary-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/visual/activity-summary-mobile.png", fullPage: true });

  const personal = randomUUID();
  await post("/api/workspaces", {
    id: personal, name: "Personal activity", kind: "personal",
    functional_currency_code: "USD", timezone: "UTC",
  });
  await page.reload();
  await page.getByLabel("Current workspace").selectOption(personal);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(count).toHaveText("0");
  await expect(stat("Recorded total")).toContainText("USD 0.00");
  await expect(stat("Draft total")).toContainText("USD 0.00");
});
