import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Snapshot } from "../../src/lib/types";

test("manual journals retain mixed-currency drafts, post balanced entries and preserve carrying and reversal rules", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  async function post(path: string, data: unknown, status = 200) {
    const response = await page.request.post(path, {
      headers: { origin },
      data,
    });
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(status);
    return body.data;
  }
  const email = `manual-${randomUUID()}@example.test`,
    password = "A-manual-test-password-123!";
  await post("/api/auth", {
    action: "register",
    email,
    password,
    display_name: "Manual owner",
  });
  await post("/api/auth", { action: "login", email, password });
  const workspace = randomUUID(),
    path = `/api/workspaces/${workspace}`;
  await post("/api/workspaces", {
    id: workspace,
    name: "Manual payroll",
    kind: "business",
    functional_currency_code: "USD",
    timezone: "Asia/Bangkok",
  });
  const accounts = [
    { name: "USD bank", type: "asset", role: "bank", currency_code: "USD" },
    { name: "Capital", type: "equity", role: "general", currency_code: "USD" },
    {
      name: "MMK salary",
      type: "expense",
      role: "general",
      currency_code: "MMK",
    },
    {
      name: "THB salary",
      type: "expense",
      role: "general",
      currency_code: "THB",
    },
    {
      name: "MMK payroll liability",
      type: "liability",
      role: "general",
      currency_code: "MMK",
    },
    {
      name: "THB payroll liability",
      type: "liability",
      role: "general",
      currency_code: "THB",
    },
    {
      name: "Supplier THB",
      type: "liability",
      role: "payable",
      currency_code: "THB",
    },
    {
      name: "Customer SGD",
      type: "asset",
      role: "receivable",
      currency_code: "SGD",
    },
    {
      name: "Any-currency expense",
      type: "expense",
      role: "general",
      currency_code: null,
    },
    {
      name: "Inactive expense",
      type: "expense",
      role: "general",
      currency_code: null,
      is_active: false,
    },
  ].map((a) => ({ id: randomUUID(), is_active: true, ...a }));
  for (const account of accounts) await post(path + "/accounts", account);
  const accountId = (name: string) => accounts.find((a) => a.name === name)!.id;
  const seed = {
    id: randomUUID(),
    kind: "contribution",
    accounting_date: "2026-10-24",
    description: "Owner funding",
    party_id: null,
    obligation: null,
    settlements: [],
    lines: [
      { account_id: accountId("USD bank"), side: "debit" },
      { account_id: accountId("Capital"), side: "credit" },
    ].map((l) => ({
      ...l,
      id: randomUUID(),
      amount: "10000",
      currency_code: "USD",
      exchange_rate: "1",
      book_amount: "10000",
      rate_source: null,
    })),
  };
  await post(path + "/events", { event: seed, post: true });
  async function snapshot(): Promise<Snapshot> {
    return (await (await page.request.get(path)).json()).data;
  }
  await page.goto("/");
  await page.getByRole("button", { name: "+ Add entry", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("What happened?", { exact: true })
    .selectOption("adjustment");
  await dialog
    .getByLabel("A short description")
    .fill("T08 manual salary accrual");
  await dialog
    .getByLabel("Accounting date", { exact: true })
    .fill("2026-10-24");
  const line = (n: number) =>
    dialog.getByRole("group", { name: `Line ${n}`, exact: true });
  async function fillLine(
    group: Locator,
    account: string,
    side: string,
    amount: string,
    rate?: string,
  ) {
    await group
      .getByLabel("Account", { exact: true })
      .selectOption(accountId(account));
    await group.getByLabel("Posting side").selectOption(side);
    await group.getByLabel("Original amount").fill(amount);
    if (rate)
      await group.getByLabel("Exchange rate", { exact: true }).fill(rate);
  }
  await expect(
    line(1).getByRole("option", {
      name: /Supplier THB|Customer SGD|Inactive expense/,
    }),
  ).toHaveCount(0);
  await line(1)
    .getByLabel("Account", { exact: true })
    .selectOption(accountId("Any-currency expense"));
  await expect(line(1).getByLabel("Currency", { exact: true })).toBeEnabled();
  await line(1).getByLabel("Currency", { exact: true }).selectOption("THB");
  await fillLine(line(1), "MMK salary", "debit", "2000000", "0.00025");
  await expect(line(1).getByLabel("Currency", { exact: true })).toHaveValue(
    "MMK",
  );
  await expect(line(1).getByLabel("Currency", { exact: true })).toBeDisabled();
  await fillLine(line(2), "THB salary", "debit", "30000", "0.03");
  await dialog
    .getByRole("button", { name: "+ Add journal line", exact: true })
    .click();
  await fillLine(
    line(3),
    "MMK payroll liability",
    "credit",
    "2000000",
    "0.00025",
  );
  await dialog
    .getByRole("button", { name: "+ Add journal line", exact: true })
    .click();
  await fillLine(line(4), "THB payroll liability", "credit", "30000", "0.02");
  await expect(
    dialog.getByRole("region", { name: "Journal totals" }),
  ).toContainText("USD 300.00");
  await expect(
    dialog.getByRole("button", { name: "Post journal entry →", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = await snapshot();
  const draft = before.transactions.find(
    (t) => t.description === "T08 manual salary accrual",
  )!;
  expect(draft.posted_at).toBeNull();
  const draftLines = before.lines.filter((l) => l.transaction_id === draft.id);
  expect(draftLines).toHaveLength(4);
  await expect(
    page.locator(".stat").filter({ hasText: "Profit for selected period" }),
  ).toContainText("USD 0.00");
  const raw = {
    id: randomUUID(),
    kind: "adjustment",
    accounting_date: "2026-10-24",
    description: "Unbalanced bypass",
    party_id: null,
    obligation: null,
    settlements: [],
    lines: draftLines.map(
      ({
        account_id,
        side,
        amount,
        currency_code,
        exchange_rate,
        book_amount,
        rate_source,
      }) => ({
        id: randomUUID(),
        account_id,
        side,
        amount,
        currency_code,
        exchange_rate,
        book_amount,
        rate_source,
      }),
    ),
  };
  await post(path + "/events", { event: raw, post: true }, 409);
  const rawControl = {
    ...raw,
    id: randomUUID(),
    description: "Unlinked control bypass",
    lines: [
      {
        id: randomUUID(),
        account_id: accountId("THB salary"),
        side: "debit",
        amount: "30000",
        currency_code: "THB",
        exchange_rate: "0.03",
        book_amount: "900",
        rate_source: "manual",
      },
      {
        id: randomUUID(),
        account_id: accountId("Supplier THB"),
        side: "credit",
        amount: "30000",
        currency_code: "THB",
        exchange_rate: "0.03",
        book_amount: "900",
        rate_source: "manual",
      },
    ],
  };
  await post(path + "/events", { event: rawControl, post: true }, 409);
  const rejected = await snapshot();
  expect(rejected.transactions).toHaveLength(before.transactions.length);
  expect(rejected.lines).toHaveLength(before.lines.length);
  await page.getByRole("button", { name: /T08 manual salary accrual/ }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Manual journal entry", exact: true }),
  ).toBeVisible();
  for (let n = 1; n <= 4; n++) {
    const selected = await line(n)
      .getByLabel("Account", { exact: true })
      .inputValue();
    const currency = before.accounts.find(
      (a) => a.id === selected,
    )!.currency_code;
    const type = before.accounts.find((a) => a.id === selected)!.type;
    if (currency === "THB" && type === "liability")
      await line(n).getByLabel("Exchange rate", { exact: true }).fill("0.03");
  }
  await expect(
    dialog.getByRole("region", { name: "Journal totals" }),
  ).toContainText("Balanced and ready to post");
  await dialog
    .getByRole("button", { name: "Post journal entry →", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const posted = await snapshot();
  expect(
    posted.transactions.filter((t) => t.description === draft.description),
  ).toHaveLength(1);
  expect(
    posted.transactions.find((t) => t.id === draft.id)!.posted_at,
  ).not.toBeNull();
  expect(
    posted.lines
      .filter((l) => l.transaction_id === draft.id)
      .map((l) => l.id)
      .sort(),
  ).toEqual(draftLines.map((l) => l.id).sort());
  await page.getByRole("button", { name: "+ Add entry", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("What happened?", { exact: true })
    .selectOption("adjustment");
  await dialog
    .getByLabel("A short description")
    .fill("T09 manual salary payment");
  await fillLine(line(1), "MMK payroll liability", "debit", "2000000");
  await fillLine(line(2), "THB payroll liability", "debit", "30000");
  await dialog
    .getByRole("button", { name: "+ Add journal line", exact: true })
    .click();
  await fillLine(line(3), "USD bank", "credit", "1400");
  await expect(
    line(1).getByLabel("Exchange rate", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await expect(
    line(1).getByLabel("Exchange rate", { exact: true }),
  ).toHaveValue("0.000250000000000000");
  await expect(
    line(2).getByLabel("Exchange rate", { exact: true }),
  ).toHaveValue("0.030000000000000000");
  await expect(
    dialog.getByRole("region", { name: "Journal totals" }),
  ).toContainText("Balanced and ready to post");
  await mkdir("test-results/visual", { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog
    .getByRole("region", { name: "Journal totals" })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/visual/manual-journal-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await line(3).scrollIntoViewIfNeeded();
  await dialog.screenshot({
    path: "test-results/visual/manual-journal-desktop.png",
  });
  const postButton = dialog.getByRole("button", {
    name: "Post journal entry →",
    exact: true,
  });
  await postButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const paid = await snapshot();
  const payment = paid.transactions.find(
    (t) => t.description === "T09 manual salary payment",
  )!;
  const paymentLines = paid.lines.filter(
    (l) => l.transaction_id === payment.id,
  );
  expect(paymentLines).toHaveLength(3);
  expect(
    paymentLines.find((l) => l.account_id === accountId("USD bank")),
  ).toMatchObject({
    side: "credit",
    amount: "1400.00000000",
    book_amount: "1400.00000000",
  });
  for (const [name, book] of [
    ["MMK payroll liability", "500.00000000"],
    ["THB payroll liability", "900.00000000"],
  ])
    expect(
      paymentLines.find((l) => l.account_id === accountId(name)),
    ).toMatchObject({
      side: "debit",
      book_amount: book,
      rate_source: "carrying_value",
    });
  await page.getByRole("button", { name: /T09 manual salary payment/ }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toHaveClass(/dialog-sheet/);
  await expect(
    dialog.getByLabel("Original amount", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Correct with a reversal", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm full reversal", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const reversed = await snapshot();
  expect(
    reversed.transactions.filter((t) => t.reversal_of_id === payment.id),
  ).toHaveLength(1);
});
