"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { currencies, type Account, type Workspace } from "@/lib/types";
import { Action, Field, Notice } from "./ui";
export function WorkspaceForm({ done }: { done: (id: string) => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          const id = await api<string>("/api/workspaces", {
            id: crypto.randomUUID(),
            name: f.get("name"),
            kind: f.get("kind"),
            functional_currency_code: f.get("currency"),
            timezone: f.get("timezone"),
          });
          done(id);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Workspace name">
        <input
          name="name"
          placeholder="e.g. My software studio"
          maxLength={100}
          required
          autoFocus
        />
      </Field>
      <div className="form-grid">
        <Field label="This space is for">
          <select name="kind">
            <option value="business">My business</option>
            <option value="personal">My personal life</option>
          </select>
        </Field>
        <Field
          label="Home currency"
          hint="Reports use this currency. Choose before posting."
        >
          <select name="currency">
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Timezone">
        <select name="timezone">
          <option>Asia/Bangkok</option>
          <option>Asia/Yangon</option>
          <option>Asia/Singapore</option>
          <option>UTC</option>
        </select>
      </Field>
      <Notice message={error} error />
      <Action type="submit" isDisabled={busy} className="wide">
        {busy ? "Creating…" : "Create workspace →"}
      </Action>
    </form>
  );
}
export function AccountForm({
  workspace,
  account,
  done,
}: {
  workspace: Workspace;
  account?: Account;
  done: () => void;
}) {
  const [role, setRole] = useState(account?.role ?? "bank"),
    [type, setType] = useState(account?.type ?? "asset"),
    [currency, setCurrency] = useState<string>(
      account
        ? (account.currency_code ?? "")
        : workspace.functional_currency_code,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          await api(`/api/workspaces/${workspace.id}/accounts`, {
            id: account?.id ?? crypto.randomUUID(),
            name: f.get("name"),
            type,
            role,
            currency_code: f.get("currency") || null,
            is_active: f.get("active") === "on",
          });
          done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Give it a name">
        <input
          name="name"
          placeholder="e.g. Bangkok bank · THB"
          defaultValue={account?.name}
          maxLength={100}
          required
          autoFocus
        />
      </Field>
      <div className="form-grid">
        <Field label="What is it?">
          <select
            value={role}
            onChange={(e) => {
              const r = e.target.value as Account["role"];
              setRole(r);
              if (!account)
                setCurrency(
                  r === "general" ? "" : workspace.functional_currency_code,
                );
              if (["bank", "cash", "wallet", "receivable"].includes(r))
                setType("asset");
              if (["credit_card", "payable"].includes(r)) setType("liability");
            }}
          >
            <option value="bank">Bank account</option>
            <option value="cash">Cash</option>
            <option value="wallet">Digital wallet</option>
            <option value="credit_card">Credit card</option>
            <option value="receivable">Customer amounts due</option>
            <option value="payable">Supplier amounts owed</option>
            <option value="general">Category / other balance</option>
          </select>
        </Field>
        <Field label="Currency">
          <select
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {role === "general" && <option value="">Any currency</option>}
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {role === "general" && (
          <Field label="Used for">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Account["type"])}
            >
              <option value="expense">Expense category</option>
              <option value="revenue">Income category</option>
              <option value="asset">Equipment / deposit / asset</option>
              <option value="liability">Other amount owed</option>
              <option value="equity">Owner money / opening equity</option>
            </select>
          </Field>
        )}
      </div>
      <label className="row">
        <input
          type="checkbox"
          name="active"
          defaultChecked={account?.is_active ?? true}
        />{" "}
        Available for new entries
      </label>
      <p className="muted">
        Used accounts keep their original classification. You can rename or
        deactivate them.
      </p>
      <Notice message={error} error />
      <div className="dialog-actions">
        <Action type="submit" isDisabled={busy}>
          {busy ? "Saving…" : "Save account"}
        </Action>
      </div>
    </form>
  );
}
export function PartyForm({
  workspace,
  done,
}: {
  workspace: Workspace;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          await api(`/api/workspaces/${workspace.id}/parties`, {
            id: crypto.randomUUID(),
            name: f.get("name"),
          });
          done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Person or company">
        <input
          name="name"
          placeholder="e.g. Singapore client"
          maxLength={100}
          required
          autoFocus
        />
      </Field>
      <p className="muted">
        Reuse the same person or company for money received and money paid.
      </p>
      <Notice message={error} error />
      <Action type="submit" isDisabled={busy}>
        {busy ? "Saving…" : "Add contact"}
      </Action>
    </form>
  );
}
