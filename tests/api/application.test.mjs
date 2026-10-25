import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { localStack } from "../../scripts/local-stack.mjs";
import { uuid, line, event, invoice, payment } from "../fixtures/ledger.mjs";
let stack,
  url,
  one,
  two,
  cookies = "",
  otherCookies = "",
  workspace,
  bank,
  ar,
  revenue,
  party;
const password = "A-local-test-password-123!";
let currentPassword = password;
async function request(path, body, jar = cookies, origin = url) {
  const r = await fetch(`${url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: jar,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", origin }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response: r, value: await r.json() };
}
async function login(email) {
  const { response, value } = await request(
    "/api/auth",
    {
      action: "login",
      email,
      password: email === one ? currentPassword : password,
    },
    "",
  );
  assert.equal(response.status, 200, JSON.stringify(value));
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
before(async () => {
  stack = await localStack({ auth: true });
  url = await stack.startApp();
  one = `first-${uuid()}@example.test`;
  two = `other-${uuid()}@example.test`;
});
after(async () => {
  await stack?.stop();
});
test("actual Auth registration, verified SSR session, recovery confirmation, password change and logout", async () => {
  for (const email of [one, two]) {
    const { response, value } = await request(
      "/api/auth",
      { action: "register", email, password, display_name: "Test user" },
      "",
    );
    assert.equal(response.status, 200, JSON.stringify(value));
  }
  const loginResponse = await request(
    "/api/auth",
    { action: "login", email: one, password },
    "",
  );
  assert.equal(loginResponse.response.status, 200);
  const setCookies = loginResponse.response.headers.getSetCookie();
  assert.ok(setCookies.some((x) => x.includes("HttpOnly")));
  cookies = setCookies.map((c) => c.split(";")[0]).join("; ");
  otherCookies = await login(two);
  assert.equal((await request("/api/workspaces")).response.status, 200);
  const sessionCookie = setCookies
    .map((c) => c.split(";")[0])
    .find((c) => c.includes("=base64-"));
  assert.ok(
    sessionCookie,
    "Auth must set a readable session envelope for refresh test",
  );
  const [cookieName, encoded] = sessionCookie.split("=");
  const session = JSON.parse(
    Buffer.from(encoded.slice(7), "base64url").toString(),
  );
  session.expires_at = Math.floor(Date.now() / 1000) - 60;
  const expired = `${cookieName}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const refreshed = await request("/api/workspaces", undefined, expired);
  assert.equal(refreshed.response.status, 200);
  assert.ok(
    refreshed.response.headers
      .getSetCookie()
      .some((c) => c.startsWith(cookieName + "=")),
    "Expired session must refresh its real cookie",
  );
  assert.equal(
    (await request("/api/workspaces", undefined, "")).response.status,
    401,
  );
  const count = stack.mailbox.messages.length;
  const recovery = await request(
    "/api/auth",
    { action: "recover", email: one },
    "",
  );
  assert.equal(recovery.response.status, 200, JSON.stringify(recovery.value));
  assert.equal(
    stack.mailbox.messages.length,
    count + 1,
    "Public recovery must deliver a message through GoTrue",
  );
  const message = stack.mailbox.messages[count];
  assert.deepEqual(message.recipients, [one]);
  const body = message.raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  const delivered = new URL(
    body.match(/href=["']([^"']+)["']/i)[1].replaceAll("&amp;", "&"),
  );
  assert.equal(delivered.origin, stack.apiUrl);
  assert.equal(delivered.pathname, "/auth/v1/verify");
  assert.equal(delivered.searchParams.get("type"), "recovery");
  assert.equal(
    delivered.searchParams.get("redirect_to"),
    `${url}/auth/confirm?next=/reset-password`,
  );
  const verification = await fetch(delivered, { redirect: "manual" });
  assert.ok([302, 303].includes(verification.status));
  const callback = new URL(verification.headers.get("location"));
  assert.equal(callback.origin, url);
  assert.equal(callback.pathname, "/auth/confirm");
  assert.equal(callback.searchParams.get("next"), "/reset-password");
  assert.ok(callback.searchParams.get("code"));
  const verifierCookies = recovery.response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const confirmation = await fetch(callback, {
    redirect: "manual",
    headers: { cookie: verifierCookies },
  });
  assert.equal(confirmation.status, 307);
  assert.ok(confirmation.headers.get("location").endsWith("/reset-password"));
  const recovered = confirmation.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  currentPassword = "A-new-test-password-123!";
  assert.equal(
    (
      await request(
        "/api/auth",
        { action: "password", password: currentPassword },
        recovered,
      )
    ).response.status,
    200,
  );
  assert.equal(
    (await request("/api/auth", { action: "logout" }, recovered)).response
      .status,
    200,
  );
  cookies = await login(one);
});
test("full API/service/DAL/RPC journey with precise lines, partial receipt and owner isolation", async () => {
  workspace = uuid();
  let r = await request("/api/workspaces", {
    id: workspace,
    name: "Software studio",
    kind: "business",
    functional_currency_code: "USD",
    timezone: "Asia/Bangkok",
  });
  assert.equal(r.response.status, 200, JSON.stringify(r.value));
  const second = uuid();
  await request("/api/workspaces", {
    id: second,
    name: "Personal",
    kind: "personal",
    functional_currency_code: "THB",
    timezone: "Asia/Bangkok",
  });
  async function account(name, type, role, currency_code) {
    const id = uuid();
    const r = await request(`/api/workspaces/${workspace}/accounts`, {
      id,
      name,
      type,
      role,
      currency_code,
      is_active: true,
    });
    assert.equal(r.response.status, 200, JSON.stringify(r.value));
    return id;
  }
  bank = await account("USD bank", "asset", "bank", "USD");
  ar = await account("Client SGD", "asset", "receivable", "SGD");
  revenue = await account("Software services", "revenue", "general", null);
  party = uuid();
  await request(`/api/workspaces/${workspace}/parties`, {
    id: party,
    name: "Singapore client",
  });
  const inv = invoice(ar, revenue, party);
  r = await request(`/api/workspaces/${workspace}/events`, {
    event: inv,
    post: true,
  });
  assert.equal(r.response.status, 200, JSON.stringify(r.value));
  r = await request(`/api/workspaces/${workspace}/events`, {
    event: payment(inv, bank),
    post: true,
  });
  assert.equal(r.response.status, 200, JSON.stringify(r.value));
  const snapshot = (await request(`/api/workspaces/${workspace}`)).value.data;
  assert.equal(snapshot.transactions.length, 2);
  assert.equal(snapshot.settlements.length, 1);
  assert.ok(
    snapshot.lines.every(
      (l) => typeof l.amount === "string" && typeof l.book_amount === "string",
    ),
  );
  assert.equal(
    (await request(`/api/workspaces/${second}`)).value.data.accounts.length,
    0,
  );
  assert.equal(
    (await request(`/api/workspaces/${workspace}`, undefined, otherCookies))
      .response.status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/workspaces/${workspace}/accounts`,
        {
          id: uuid(),
          name: "Attack",
          type: "asset",
          role: "bank",
          currency_code: "USD",
          is_active: true,
        },
        otherCookies,
      )
    ).response.status,
    403,
  );
  const client = createClient(stack.apiUrl, stack.key, {
    auth: { persistSession: false },
  });
  assert.equal(
    (await client.auth.signInWithPassword({ email: two, password })).error,
    null,
  );
  assert.equal((await client.from("accounts").select("*")).data.length, 0);
  assert.ok(
    (
      await client.from("transactions").insert({
        id: uuid(),
        workspace_id: workspace,
        kind: "income",
        description: "Attack",
        accounting_date: "2026-10-23",
      })
    ).error,
  );
});
test("malformed input, forged origin, draft exclusion and conflicting retry are rejected", async () => {
  const p = event("income", [
    line(bank, "debit", "9007199254740993.01"),
    line(revenue, "credit", "9007199254740993.01"),
  ]);
  let r = await request(`/api/workspaces/${workspace}/events`, {
    event: p,
    post: true,
  });
  assert.equal(r.response.status, 200, JSON.stringify(r.value));
  r = await request(`/api/workspaces/${workspace}/events`, {
    event: p,
    post: true,
  });
  assert.equal(r.response.status, 200);
  assert.equal(
    (
      await request(`/api/workspaces/${workspace}/events`, {
        event: { ...p, description: "conflicting" },
        post: true,
      })
    ).response.status,
    409,
  );
  const stored = (
    await request(`/api/workspaces/${workspace}`)
  ).value.data.lines.find((l) => l.id === p.lines[0].id);
  assert.equal(stored.amount, "9007199254740993.01000000");
  assert.equal(
    (
      await request(
        `/api/workspaces/${workspace}/accounts`,
        {},
        cookies,
        "https://forged.example",
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await request(`/api/workspaces/${workspace}/events`, {
        event: { ...p, id: uuid(), lines: [{ ...p.lines[0], amount: 1 }] },
        post: true,
      })
    ).response.status,
    400,
  );
});
