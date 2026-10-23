"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { d, displayMoney, money } from "@/lib/money";
import {
  accountBalance,
  openItems,
  reports,
  workspaceToday,
} from "@/lib/reports";
import type {
  Account,
  Kind,
  Snapshot,
  Transaction,
  Workspace,
} from "@/lib/types";
import { Action, Empty, Field, Notice, ThemeToggle } from "./ui";
import { Dialog } from "./dialog";
import { AccountForm, PartyForm, WorkspaceForm } from "./setup-forms";
import { actionLabels, EntryForm } from "./entry-form";
import { PaymentForm } from "./payment-form";
import { TransactionDetail } from "./transaction-detail";
import { ReportView } from "./report-view";
type View =
  "overview" | "accounts" | "activity" | "unpaid" | "reports" | "contacts";
type Modal =
  | { type: "workspace" }
  | { type: "account"; account?: Account }
  | { type: "party" }
  | { type: "entry"; kind: Kind }
  | { type: "payment"; selected?: string }
  | { type: "detail"; transaction: Transaction };
const navigation: [View, string, string][] = [
  ["overview", "Overview", "◫"],
  ["accounts", "Accounts", "▱"],
  ["activity", "Activity", "↔"],
  ["unpaid", "Unpaid", "◷"],
  ["reports", "Reports", "▥"],
  ["contacts", "Contacts", "♧"],
];
export function FinanceApp() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspaceId, setWorkspaceId] = useState(""),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [view, setView] = useState<View>("overview"),
    [modal, setModal] = useState<Modal | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [accountFilter, setAccountFilter] = useState(""),
    [status, setStatus] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const loadWorkspaces = useCallback(
    async (selected?: string) => {
      try {
        const rows = await api<Workspace[]>("/api/workspaces");
        setWorkspaces(rows);
        const saved = selected ?? localStorage.getItem("microfin-workspace");
        setWorkspaceId(
          rows.some((w) => w.id === saved) ? saved! : (rows[0]?.id ?? ""),
        );
        if (!rows.length) setLoading(false);
      } catch (error) {
        if ((error as { status?: number }).status === 401) {
          router.replace("/login");
          return;
        }
        setError((error as Error).message);
        setLoading(false);
      }
    },
    [router],
  );
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadWorkspaces();
    });
    return () => {
      active = false;
    };
  }, [loadWorkspaces]);
  const loadSnapshot = useCallback(async (id: string) => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setSnapshot(null);
    try {
      const data = await api<Snapshot>(`/api/workspaces/${id}`);
      if (current !== generation.current) return;
      setSnapshot(data);
      const today = workspaceToday(data.workspace.timezone);
      setTo(today);
      setFrom(`${today.slice(0, 7)}-01`);
      localStorage.setItem("microfin-workspace", id);
    } catch (error) {
      if (current === generation.current) setError((error as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (workspaceId && active) {
        setAccountFilter("");
        setSearch("");
        setStatus("all");
        setModal(null);
        void loadSnapshot(workspaceId);
      }
    });
    return () => {
      active = false;
      invalidate();
    };
  }, [workspaceId, loadSnapshot, invalidate]);
  function refresh() {
    setModal(null);
    if (workspaceId) void loadSnapshot(workspaceId);
  }
  const workspace = workspaces.find((w) => w.id === workspaceId),
    s = snapshot,
    code = s?.workspace.functional_currency_code ?? "THB";
  const result = s ? reports(s, from, to) : null,
    items = s ? openItems(s) : [];
  const moneyAccounts =
    s?.accounts.filter((a) =>
      ["bank", "cash", "wallet", "credit_card"].includes(a.role),
    ) ?? [];
  const cash = moneyAccounts
    .filter((a) => a.type === "asset")
    .reduce((v, a) => v.plus(accountBalance(s!, a.id).book), d(0));
  const due = items
      .filter((x) => x.account.role === "receivable")
      .reduce((v, x) => v.plus(x.outstanding_book), d(0)),
    owed = items
      .filter((x) => x.account.role === "payable")
      .reduce((v, x) => v.plus(x.outstanding_book), d(0));
  const activity =
    s?.transactions.filter(
      (t) =>
        (!from || t.accounting_date >= from) &&
        (!to || t.accounting_date <= to) &&
        (!search ||
          t.description.toLowerCase().includes(search.toLowerCase())) &&
        (!accountFilter ||
          s.lines.some(
            (l) => l.transaction_id === t.id && l.account_id === accountFilter,
          )) &&
        (status === "all" ||
          (status === "draft" ? !t.posted_at : !!t.posted_at)),
    ) ?? [];
  function navigate(target: View) {
    setView(target);
    setAccountFilter("");
  }
  function transactionAmount(t: Transaction) {
    if (accountFilter && view === "activity")
      return money(
        s!.lines
          .filter(
            (l) => l.transaction_id === t.id && l.account_id === accountFilter,
          )
          .reduce(
            (v, l) =>
              v.plus(d(l.book_amount).times(l.side === "debit" ? 1 : -1)),
            d(0),
          ),
      );
    const bank = s!.lines.filter(
      (l) =>
        l.transaction_id === t.id &&
        moneyAccounts.some((a) => a.id === l.account_id),
    );
    const lines = bank.length
      ? bank
      : s!.lines.filter((l) => l.transaction_id === t.id && l.side === "debit");
    return money(
      lines.reduce(
        (v, l) =>
          v.plus(
            d(l.book_amount).times(bank.length && l.side === "credit" ? -1 : 1),
          ),
        d(0),
      ),
    );
  }
  function recentRows(rows: Transaction[]) {
    return rows.length ? (
      <div className="rows">
        {rows.map((t) => (
          <button
            key={t.id}
            className="row text-left"
            style={{
              background: "none",
              borderLeft: 0,
              borderRight: 0,
              borderTop: 0,
              color: "inherit",
              width: "100%",
            }}
            onClick={() => setModal({ type: "detail", transaction: t })}
          >
            <span className="row-icon">
              {["income", "invoice", "contribution"].includes(t.kind)
                ? "↙"
                : "↗"}
            </span>
            <span className="row-main">
              <strong>{t.description}</strong>
              <small>
                {t.accounting_date} ·{" "}
                {t.posted_at ? t.kind.replaceAll("_", " ") : "Draft"}
              </small>
            </span>
            <span
              className={`row-amount ${d(transactionAmount(t)).lt(0) ? "" : "positive"}`}
            >
              {displayMoney(transactionAmount(t), code)}
              {accountFilter &&
                view === "activity" &&
                s!.accounts.find((a) => a.id === accountFilter)
                  ?.currency_code && (
                  <>
                    <br />
                    <small>
                      {displayMoney(
                        money(
                          s!.lines
                            .filter(
                              (l) =>
                                l.transaction_id === t.id &&
                                l.account_id === accountFilter,
                            )
                            .reduce(
                              (v, l) =>
                                v.plus(
                                  d(l.amount).times(
                                    l.side === "debit" ? 1 : -1,
                                  ),
                                ),
                              d(0),
                            ),
                        ),
                        s!.accounts.find((a) => a.id === accountFilter)!
                          .currency_code!,
                      )}
                    </small>
                  </>
                )}
            </span>
          </button>
        ))}
      </div>
    ) : (
      <Empty title="Your story starts here">
        Record your first entry. We’ll keep the amounts and currencies together.
      </Empty>
    );
  }
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">m</span> microfin
        </Link>
        <div>
          {workspaces.length > 0 && (
            <select
              aria-label="Current workspace"
              className="workspace-picker"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="text-action"
            style={{ marginTop: 10 }}
            onClick={() => setModal({ type: "workspace" })}
          >
            + New workspace
          </button>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => navigate(key)}
              className={`nav-item ${view === key ? "active" : ""}`}
              aria-current={view === key ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden>
                {icon}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="insight" style={{ marginTop: 0 }}>
            One clear space for every part of your life.
          </div>
          <button
            className="text-action spacer"
            onClick={async () => {
              try {
                await api("/api/auth", { action: "logout" });
                router.replace("/login");
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Sign out ↗
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span className="muted">
            Your space /{" "}
            <strong style={{ color: "var(--ink)" }}>
              {navigation.find((n) => n[0] === view)?.[1]}
            </strong>
          </span>
          <div className="topbar-right">
            {workspace && <span className="tag">{workspace.kind}</span>}
            <ThemeToggle />
            <button
              className="text-action mobile-only"
              onClick={async () => {
                await api("/api/auth", { action: "logout" });
                router.replace("/login");
                router.refresh();
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main id="main" className="content">
          <Notice message={error} error />
          {error && (
            <Action
              variant="secondary"
              onPress={() =>
                workspaceId
                  ? void loadSnapshot(workspaceId)
                  : void loadWorkspaces()
              }
            >
              Try again
            </Action>
          )}
          {loading ? (
            <div aria-busy="true" className="stack">
              <p className="muted">Gathering your finances…</p>
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : !workspaces.length ? (
            <section className="workspace-intro panel">
              <div className="eyebrow">A PLACE FOR YOUR MONEY</div>
              <h1>Let’s make your first space.</h1>
              <p className="muted">
                Keep your business and personal life separate. Start with one;
                you can add more anytime.
              </p>
              <WorkspaceForm done={(id) => void loadWorkspaces(id)} />
            </section>
          ) : (
            s && (
              <>
                <div className="heading-row">
                  <div>
                    <div className="eyebrow">
                      {s.workspace.name} · {code}
                    </div>
                    <h1>
                      {view === "overview"
                        ? "A little more clarity."
                        : view === "accounts"
                          ? "Your money, in its places."
                          : view === "activity"
                            ? "Every little movement."
                            : view === "unpaid"
                              ? "Keep the loose ends close."
                              : view === "reports"
                                ? "See the bigger picture."
                                : "The people in your finances."}
                    </h1>
                    <p>
                      {view === "overview"
                        ? "What you have, what’s moving, and what’s next."
                        : view === "accounts"
                          ? "Balances, categories, and currencies. All in one place."
                          : view === "activity"
                            ? "Recorded entries and drafts, with their original rates."
                            : view === "unpaid"
                              ? "Invoices to collect. Bills to pay. Nothing counted twice."
                              : view === "reports"
                                ? `Your recorded finances, in ${s.workspace.timezone}.`
                                : "Customers, suppliers, and everyone in between."}
                    </p>
                  </div>
                  <Action
                    onPress={() =>
                      setModal(
                        view === "accounts"
                          ? { type: "account" }
                          : view === "contacts"
                            ? { type: "party" }
                            : { type: "entry", kind: "expense" },
                      )
                    }
                  >
                    +{" "}
                    {view === "accounts"
                      ? "Add account"
                      : view === "contacts"
                        ? "Add contact"
                        : "Add entry"}
                  </Action>
                </div>
                {view === "overview" && (
                  <>
                    <div className="stats">
                      <div className="stat featured">
                        <div className="stat-label">Money available</div>
                        <div className="stat-value">
                          {displayMoney(cash.toString(), code)}
                        </div>
                        <div className="stat-foot">
                          Across your bank, cash & wallets · historical value
                        </div>
                      </div>
                      <div className="stat">
                        <div className="stat-label">
                          {s.workspace.kind === "personal"
                            ? "Left over for selected period"
                            : "Profit for selected period"}
                        </div>
                        <div className="stat-value">
                          {displayMoney(result!.profit, code)}
                        </div>
                        <div className="stat-foot">
                          {from} — {to}
                        </div>
                      </div>
                      <div className="stat">
                        <div className="stat-label">Still to collect</div>
                        <div className="stat-value">
                          {displayMoney(due.toString(), code)}
                        </div>
                        <div className="stat-foot">
                          {displayMoney(owed.toString(), code)} to pay
                        </div>
                      </div>
                    </div>
                    <div className="two-col">
                      <section className="panel">
                        <div className="section-head">
                          <h2>Recent activity</h2>
                          <button
                            className="text-action"
                            onClick={() => navigate("activity")}
                          >
                            View all ↗
                          </button>
                        </div>
                        {recentRows(s.transactions.slice(0, 6))}
                      </section>
                      <section className="panel">
                        <div className="section-head">
                          <h2>Make a small move</h2>
                        </div>
                        <div className="quick-actions">
                          {(
                            [
                              "income",
                              "expense",
                              "transfer",
                              "invoice",
                            ] as Kind[]
                          ).map((kind) => (
                            <button
                              key={kind}
                              className="quick-action"
                              onClick={() => setModal({ type: "entry", kind })}
                            >
                              <span>
                                {kind === "income"
                                  ? "↙"
                                  : kind === "expense"
                                    ? "↗"
                                    : kind === "transfer"
                                      ? "⇄"
                                      : "◷"}
                              </span>
                              {actionLabels[kind]}
                            </button>
                          ))}
                        </div>
                        <div className="insight">
                          ✦ Start with your accounts and a few categories.
                          Recording the next thing gets easier.
                        </div>
                      </section>
                    </div>
                    <section className="spacer">
                      <div className="section-head">
                        <h2>Your money accounts</h2>
                        <button
                          className="text-action"
                          onClick={() => navigate("accounts")}
                        >
                          All accounts ↗
                        </button>
                      </div>
                      {moneyAccounts.length ? (
                        <div className="account-grid">
                          {moneyAccounts.slice(0, 3).map((a) => (
                            <AccountCard
                              key={a.id}
                              account={a}
                              snapshot={s}
                              open={() => {
                                navigate("activity");
                                setAccountFilter(a.id);
                                setFrom("");
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="panel">
                          <Empty title="Give your money a home">
                            Add a bank account, cash balance, or wallet to start
                            recording.
                          </Empty>
                          <Action
                            variant="secondary"
                            onPress={() => setModal({ type: "account" })}
                          >
                            Add your first account
                          </Action>
                        </div>
                      )}
                    </section>
                  </>
                )}
                {view === "accounts" && (
                  <>
                    <div className="account-grid">
                      {s.accounts
                        .filter((a) =>
                          ["bank", "cash", "wallet", "credit_card"].includes(
                            a.role,
                          ),
                        )
                        .map((a) => (
                          <AccountCard
                            key={a.id}
                            account={a}
                            snapshot={s}
                            open={() =>
                              setModal({ type: "account", account: a })
                            }
                          />
                        ))}
                    </div>
                    <section className="panel spacer">
                      <div className="section-head">
                        <h2>Categories & other balances</h2>
                      </div>
                      {s.accounts.filter(
                        (a) =>
                          !["bank", "cash", "wallet", "credit_card"].includes(
                            a.role,
                          ),
                      ).length ? (
                        <div className="rows">
                          {s.accounts
                            .filter(
                              (a) =>
                                ![
                                  "bank",
                                  "cash",
                                  "wallet",
                                  "credit_card",
                                ].includes(a.role),
                            )
                            .map((a) => (
                              <div className="row" key={a.id}>
                                <span className="row-icon">
                                  {a.type === "expense" ? "↗" : "◈"}
                                </span>
                                <div className="row-main">
                                  <strong>{a.name}</strong>
                                  <small>
                                    {a.type} · {a.role.replace("_", " ")} ·{" "}
                                    {a.currency_code ?? "any currency"}
                                    {!a.is_active ? " · inactive" : ""}
                                  </small>
                                </div>
                                <button
                                  className="text-action"
                                  onClick={() =>
                                    setModal({ type: "account", account: a })
                                  }
                                >
                                  Edit
                                </button>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <Empty title="A category for what matters">
                          Add income and expense categories, equipment, owner
                          equity, and unpaid balances.
                        </Empty>
                      )}
                    </section>
                  </>
                )}
                {view === "activity" && (
                  <section className="panel">
                    <div className="filters">
                      <Field label="Search entries">
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search description"
                        />
                      </Field>
                      <Field label="Account">
                        <select
                          value={accountFilter}
                          onChange={(e) => setAccountFilter(e.target.value)}
                        >
                          <option value="">All accounts</option>
                          {s.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Status">
                        <select
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                        >
                          <option value="all">All entries</option>
                          <option value="posted">Recorded</option>
                          <option value="draft">Drafts</option>
                        </select>
                      </Field>
                    </div>
                    <DateFilters
                      from={from}
                      to={to}
                      setFrom={setFrom}
                      setTo={setTo}
                    />
                    {recentRows(activity)}
                  </section>
                )}
                {view === "unpaid" && (
                  <section className="panel">
                    <div className="section-head">
                      <h2>Invoices & bills</h2>
                      <Action
                        variant="secondary"
                        isDisabled={!items.some((x) => x.state !== "paid")}
                        onPress={() => setModal({ type: "payment" })}
                      >
                        Record payment
                      </Action>
                    </div>
                    {items.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Item / contact</th>
                              <th>Due</th>
                              <th>Outstanding</th>
                              <th>Status</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((x) => (
                              <tr key={x.obligation.id}>
                                <td>
                                  <button
                                    className="text-action"
                                    onClick={() =>
                                      setModal({
                                        type: "detail",
                                        transaction: x.transaction,
                                      })
                                    }
                                  >
                                    {x.obligation.reference ??
                                      x.transaction.description}
                                  </button>
                                  <br />
                                  <small>
                                    {x.party?.name} ·{" "}
                                    {x.account.role === "receivable"
                                      ? "To collect"
                                      : "To pay"}
                                  </small>
                                </td>
                                <td>{x.obligation.due_date ?? "—"}</td>
                                <td>
                                  {displayMoney(
                                    x.outstanding,
                                    x.line.currency_code,
                                  )}
                                  <br />
                                  <small>
                                    {displayMoney(x.outstanding_book, code)}
                                  </small>
                                </td>
                                <td>
                                  <span className="pill">
                                    {x.state.replace("_", " ")}
                                  </span>
                                </td>
                                <td>
                                  {x.state !== "paid" && (
                                    <button
                                      className="text-action"
                                      onClick={() =>
                                        setModal({
                                          type: "payment",
                                          selected: x.obligation.id,
                                        })
                                      }
                                    >
                                      Pay / collect ↗
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="No loose ends yet">
                        Record an earned client invoice or an incurred supplier
                        bill to follow what’s still unpaid.
                      </Empty>
                    )}
                  </section>
                )}
                {view === "reports" && (
                  <>
                    <DateFilters
                      from={from}
                      to={to}
                      setFrom={setFrom}
                      setTo={setTo}
                    />
                    <ReportView
                      snapshot={s}
                      from={from}
                      to={to}
                      drill={(id, period) => {
                        setView("activity");
                        setAccountFilter(id);
                        setSearch("");
                        setStatus("posted");
                        if (!period) setFrom("");
                      }}
                    />
                  </>
                )}
                {view === "contacts" && (
                  <section className="panel">
                    {s.parties.length ? (
                      <div className="rows">
                        {s.parties.map((p) => (
                          <div key={p.id} className="row">
                            <span className="row-icon">♧</span>
                            <div className="row-main">
                              <strong>{p.name}</strong>
                              <small>Customer / supplier</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty title="Good finances have familiar faces">
                        Add a customer or supplier before recording an unpaid
                        invoice or bill.
                      </Empty>
                    )}
                  </section>
                )}
              </>
            )
          )}
        </main>
      </div>
      {modal && (
        <Dialog
          title={
            modal.type === "workspace"
              ? "A new space"
              : modal.type === "account"
                ? modal.account
                  ? "Edit account"
                  : "Give your money a home"
                : modal.type === "party"
                  ? "Add a contact"
                  : modal.type === "entry"
                    ? "Record a money moment"
                    : modal.type === "payment"
                      ? "Close an unpaid item"
                      : "Entry details"
          }
          close={() => setModal(null)}
        >
          {modal.type === "workspace" ? (
            <WorkspaceForm
              done={(id) => {
                setModal(null);
                void loadWorkspaces(id);
              }}
            />
          ) : s && modal.type === "account" ? (
            <AccountForm
              workspace={s.workspace}
              account={modal.account}
              done={refresh}
            />
          ) : s && modal.type === "party" ? (
            <PartyForm workspace={s.workspace} done={refresh} />
          ) : s && modal.type === "entry" ? (
            <EntryForm snapshot={s} initialKind={modal.kind} done={refresh} />
          ) : s && modal.type === "payment" ? (
            <PaymentForm
              snapshot={s}
              selected={modal.selected}
              done={refresh}
            />
          ) : s && modal.type === "detail" ? (
            <TransactionDetail
              snapshot={s}
              transaction={modal.transaction}
              done={refresh}
            />
          ) : (
            <p className="muted">Choose a workspace first.</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
function DateFilters({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  return (
    <div className="filters">
      <Field label="From">
        <input
          aria-label="From date"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <Field label="Through / as of">
        <input
          aria-label="Through date"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </Field>
    </div>
  );
}
function AccountCard({
  account: a,
  snapshot: s,
  open,
}: {
  account: Account;
  snapshot: Snapshot;
  open: () => void;
}) {
  const balance = accountBalance(s, a.id);
  return (
    <article className="account-card">
      <div className="account-currency">
        {a.currency_code} · {a.role.replace("_", " ")}
      </div>
      <h3>{a.name}</h3>
      <div className="account-amount">
        {displayMoney(
          balance.native,
          a.currency_code ?? s.workspace.functional_currency_code,
        )}
      </div>
      {a.currency_code !== s.workspace.functional_currency_code && (
        <div className="account-book">
          {displayMoney(balance.book, s.workspace.functional_currency_code)}{" "}
          historical value
        </div>
      )}
      <div className="account-footer">
        <span>{a.is_active ? "Available" : "Inactive"}</span>
        <button className="text-action" onClick={open}>
          Open ↗
        </button>
      </div>
    </article>
  );
}
