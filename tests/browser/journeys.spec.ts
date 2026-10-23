import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
test("business and personal journeys, payments, reports, themes, keyboard and failures", async ({
  page,
}) => {
  await page.goto("/auth/confirm?token_hash=expired&type=recovery");
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Confirmation link expired. Request a fresh link." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("First customer");
  await page
    .getByLabel("Email address")
    .fill(`customer-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: false })
    .fill("A-test-password-123!");
  await page
    .getByRole("button", { name: "Create account →", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Sign in →", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Let’s make your first space." }),
  ).toBeVisible();
  await page.getByLabel("Workspace name").fill("Pragmatic software studio");
  await page.getByRole("button", { name: "Create workspace →" }).click();
  await expect(
    page.getByRole("heading", { name: "A little more clarity." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await addAccount(page, "Bangkok bank", "bank", "THB");
  await addAccount(page, "Owner capital", "general", "", "equity");
  await addAccount(page, "Office rent", "general", "", "expense");
  await addAccount(page, "Software services", "general", "", "revenue");
  await addAccount(page, "Client SGD", "receivable", "SGD");
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "+ Add contact" }).click();
  await page.getByLabel("Person or company").fill("Singapore client");
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await addEntry(
    page,
    "contribution",
    "Initial owner money",
    "Bangkok bank",
    "Owner capital",
    "100000",
  );
  await addEntry(
    page,
    "expense",
    "October office rent",
    "Bangkok bank",
    "Office rent",
    "1000",
  );
  await addEntry(
    page,
    "expense",
    "Unrecorded office rent",
    "Bangkok bank",
    "Office rent",
    "250",
    true,
  );
  await page.getByRole("button", { name: "+ Add entry" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("What happened?").selectOption("invoice");
  await dialog.getByLabel("A short description").fill("October software work");
  await dialog
    .getByLabel("Customer amounts due", { exact: true })
    .selectOption({ label: "Client SGD · SGD" });
  await dialog
    .getByLabel("Category / destination")
    .selectOption({ label: "Software services" });
  await dialog.getByLabel("Amount", { exact: true }).fill("4000");
  await dialog.getByLabel("Entry currency").selectOption("SGD");
  await dialog.getByLabel("Exchange rate", { exact: false }).fill("26");
  await dialog
    .getByLabel("Customer / supplier (optional)")
    .selectOption({ label: "Singapore client" });
  await dialog.getByLabel("Reference (optional)").fill("INV-001");
  await dialog.getByRole("button", { name: "Record entry →" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Unpaid", exact: true }).click();
  await expect(page.getByRole("cell", { name: /SGD 4,000.00/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount cleared", { exact: false }).fill("1000");
  await dialog
    .getByLabel("Actual money received / paid", { exact: false })
    .fill("26000");
  await dialog.getByRole("button", { name: "Record payment →" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: /SGD 3,000.00/ })).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const reportFrom = await page.getByLabel("From date").inputValue(),
    reportThrough = await page.getByLabel("Through date").inputValue();
  await page.getByLabel("Search entries").fill("Unrecorded");
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await expect(
    page.getByRole("button", { name: /Unrecorded office rent/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(
    page.getByText("THB 103,000.00", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("✓ Assets = liabilities + equity")).toBeVisible();
  await page.getByRole("button", { name: "Office rent ↗" }).click();
  await expect(
    page.getByRole("button", { name: /October office rent/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unrecorded office rent/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Search entries")).toHaveValue("");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
    "posted",
  );
  await expect(page.getByLabel("From date")).toHaveValue(reportFrom);
  await expect(page.getByLabel("Through date")).toHaveValue(reportThrough);
  await page.getByLabel("Search entries").fill("Unrecorded");
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page
    .getByRole("button", { name: "Bangkok bank ↗", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Initial owner money/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unrecorded office rent/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Search entries")).toHaveValue("");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
    "posted",
  );
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expect(page.getByLabel("Through date")).toHaveValue(reportThrough);
  await page.getByLabel("From date").fill(reportFrom);
  const currentFrom = await page.getByLabel("From date").inputValue(),
    currentThrough = await page.getByLabel("Through date").inputValue();
  await page.getByLabel("From date").fill("2020-01-01");
  await page.getByLabel("Through date").fill("2020-01-31");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  const profitCard = page
    .locator(".stat")
    .filter({ hasText: "Profit for selected period" });
  await expect(profitCard).toContainText("THB 0.00");
  await expect(profitCard).toContainText("2020-01-01 — 2020-01-31");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByLabel("From date").fill(currentFrom);
  await page.getByLabel("Through date").fill(currentThrough);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await mkdir("test-results/visual", { recursive: true });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    localStorage.setItem("microfin-theme", "light");
  });
  await verifyPrimaryContrast(page);
  await page.screenshot({
    path: "test-results/visual/business-desktop-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.getByRole("heading", { name: "A little more clarity." }),
  ).toBeVisible();
  await verifyPrimaryContrast(page);
  await page.screenshot({
    path: "test-results/visual/business-desktop-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/visual/business-mobile-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await page.screenshot({
    path: "test-results/visual/business-mobile-light.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "+ New workspace" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Workspace name").fill("Life in Thailand");
  await dialog.getByLabel("This space is for").selectOption("personal");
  await dialog.getByRole("button", { name: "Create workspace →" }).click();
  await expect(
    page.getByRole("heading", { name: "A little more clarity." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.getByText("Bangkok bank", { exact: true })).toHaveCount(0);
  await addAccount(page, "My cash", "cash", "THB");
  await addAccount(page, "Personal income", "general", "", "revenue");
  await addEntry(
    page,
    "income",
    "Living money",
    "My cash",
    "Personal income",
    "20000",
  );
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByText("THB 20,000.00", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByLabel("Current workspace")
    .selectOption({ label: "Pragmatic software studio" });
  await expect(page.getByText("Living money", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("October office rent", { exact: true }),
  ).toBeVisible();
  // The dialog contains keyboard focus and Escape restores the prior context.
  await page.getByRole("button", { name: "+ Add entry" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Add entry" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.route("**/api/workspaces/*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Please try again" }),
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Please try again" }),
  ).toContainText("Please try again");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
async function addAccount(
  page: Page,
  name: string,
  role: string,
  currency: string,
  type?: string,
) {
  await page.getByRole("button", { name: "+ Add account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Give it a name").fill(name);
  await dialog.getByLabel("What is it?").selectOption(role);
  await dialog.getByLabel("Currency", { exact: true }).selectOption(currency);
  if (type) await dialog.getByLabel("Used for").selectOption(type);
  await dialog.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}
async function verifyPrimaryContrast(page: Page) {
  const button = page.getByRole("button", { name: "+ Add entry" });
  const contrast = () =>
    button.evaluate((element) => {
      const style = getComputedStyle(element),
        canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d")!;
      canvas.width = canvas.height = 1;
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        const linear = [...data].slice(0, 3).map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const a = luminance(style.color),
        b = luminance(style.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  await page.mouse.move(0, 0);
  await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
  await button.hover();
  await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
  await page.mouse.down();
  await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(0, 0);
  await page.mouse.up();
}
async function addEntry(
  page: Page,
  kind: string,
  description: string,
  source: string,
  target: string,
  amount: string,
  draft = false,
) {
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "+ Add entry" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What happened?").selectOption(kind);
  await dialog.getByLabel("A short description").fill(description);
  await dialog
    .getByLabel("Money account", { exact: true })
    .selectOption({ label: `${source} · THB` });
  await dialog
    .getByLabel("Category / destination")
    .selectOption({ label: target });
  await dialog.getByLabel("Amount", { exact: true }).fill(amount);
  await dialog
    .getByRole("button", {
      name: draft ? "Save draft" : "Record entry →",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("a foreign draft refreshes carrying values and its used unrestricted category stays editable", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, {
      headers: { origin },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  }
  const email = `draft-${randomUUID()}@example.test`,
    password = "A-draft-test-password-123!";
  await post("/api/auth", {
    action: "register",
    email,
    password,
    display_name: "Draft owner",
  });
  await post("/api/auth", { action: "login", email, password });
  const workspace = randomUUID();
  await post("/api/workspaces", {
    id: workspace,
    name: "Draft carrying review",
    kind: "business",
    functional_currency_code: "USD",
    timezone: "Asia/Bangkok",
  });
  async function account(
    name: string,
    type: string,
    role = "general",
    currency_code: string | null = null,
  ) {
    const id = randomUUID();
    await post(`/api/workspaces/${workspace}/accounts`, {
      id,
      name,
      type,
      role,
      currency_code,
      is_active: true,
    });
    return id;
  }
  const bank = await account("SGD bank", "asset", "bank", "SGD"),
    income = await account("Services", "revenue"),
    fx = await account("FX differences", "expense");
  function receipt(rate: string, book: string) {
    return {
      id: randomUUID(),
      accounting_date: "2026-10-24",
      kind: "income",
      description: "Foreign receipt",
      party_id: null,
      obligation: null,
      settlements: [],
      lines: [
        {
          id: randomUUID(),
          account_id: bank,
          side: "debit",
          amount: "100",
          currency_code: "SGD",
          exchange_rate: rate,
          book_amount: book,
          rate_source: "manual",
        },
        {
          id: randomUUID(),
          account_id: income,
          side: "credit",
          amount: "100",
          currency_code: "SGD",
          exchange_rate: rate,
          book_amount: book,
          rate_source: "manual",
        },
      ],
    };
  }
  await post(`/api/workspaces/${workspace}/events`, {
    event: receipt("0.75", "75"),
    post: true,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A little more clarity." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await addAccount(page, "Purchases", "general", "", "expense");
  const created = (
    await (await page.request.get(`/api/workspaces/${workspace}`)).json()
  ).data.accounts.find((a: { name: string }) => a.name === "Purchases");
  expect(created.currency_code).toBeNull();
  const expense = created.id;
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "+ Add entry" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("A short description").fill("Draft foreign purchase");
  await dialog.getByLabel("Money account", { exact: true }).selectOption(bank);
  await dialog.getByLabel("Category / destination").selectOption(expense);
  await dialog.getByLabel("Amount", { exact: true }).fill("50");
  await dialog.getByLabel("Entry currency").selectOption("SGD");
  await dialog.getByLabel("Exchange rate", { exact: true }).fill("0.8");
  await dialog
    .getByLabel("FX / rounding category (if values differ)")
    .selectOption(fx);
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = (
    await (await page.request.get(`/api/workspaces/${workspace}`)).json()
  ).data;
  const draft = before.transactions.find(
    (t: { description: string }) => t.description === "Draft foreign purchase",
  );
  expect(draft.posted_at).toBeNull();
  await expect(
    page.getByText("USD 75.00", { exact: true }).first(),
  ).toBeVisible();
  await post(`/api/workspaces/${workspace}/events`, {
    event: receipt("1", "100"),
    post: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A little more clarity." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Draft foreign purchase/ }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Existing FX / rounding posting to replace")
    .selectOption({ label: "FX differences · credit · USD 2.50" });
  await dialog
    .getByRole("button", { name: "Refresh carrying values", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Carrying values refreshed",
  );
  await expect(dialog.getByText("USD 43.75", { exact: true })).toBeVisible();
  await expect(dialog.getByText("USD 40.00", { exact: true })).toBeVisible();
  await expect(dialog.getByText("USD 3.75", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Record draft", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = (
    await (await page.request.get(`/api/workspaces/${workspace}`)).json()
  ).data;
  expect(
    after.transactions.filter(
      (t: { description: string }) =>
        t.description === "Draft foreign purchase",
    ),
  ).toHaveLength(1);
  expect(
    after.transactions.find((t: { id: string }) => t.id === draft.id).posted_at,
  ).not.toBeNull();
  const lines = after.lines.filter(
    (l: { transaction_id: string }) => l.transaction_id === draft.id,
  );
  expect(
    lines.find((l: { account_id: string }) => l.account_id === bank),
  ).toMatchObject({
    amount: "50.00000000",
    book_amount: "43.75000000",
    rate_source: "carrying_value",
  });
  expect(
    lines.find((l: { account_id: string }) => l.account_id === expense),
  ).toMatchObject({
    amount: "50.00000000",
    book_amount: "40.00000000",
    exchange_rate: "0.800000000000000000",
  });
  expect(
    lines.find((l: { account_id: string }) => l.account_id === fx),
  ).toMatchObject({
    side: "debit",
    amount: "3.75000000",
    book_amount: "3.75000000",
  });
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page
    .locator(".row")
    .filter({ has: page.getByText("Purchases", { exact: true }) })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Currency", { exact: true })).toHaveValue("");
  await expect(
    dialog.getByRole("option", { name: "Any currency", exact: true }),
  ).toHaveAttribute("value", "");
  await dialog.getByLabel("Give it a name").fill("Purchases renamed");
  await dialog.getByLabel("Available for new entries").uncheck();
  await dialog
    .getByRole("button", { name: "Save account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Purchases renamed", { exact: true }),
  ).toBeVisible();
  const edited = (
    await (await page.request.get(`/api/workspaces/${workspace}`)).json()
  ).data.accounts.find((a: { id: string }) => a.id === expense);
  expect(edited).toMatchObject({
    name: "Purchases renamed",
    type: "expense",
    role: "general",
    currency_code: null,
    is_active: false,
  });
});
