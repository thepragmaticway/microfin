"use client";
import { useRef, useState } from "react";
import { buildPayment, type PaymentInput, type PaymentAllocation } from "@/lib/guided";
import { api } from "@/lib/api";
import { openItems, workspaceToday } from "@/lib/reports";
import { displayMoney } from "@/lib/money";
import type { EventInput, Snapshot } from "@/lib/types";
import { AccountOptions } from "./entry-form";
import { Action, Field, Notice } from "./ui";
export function PaymentForm({
  snapshot: s,
  selected,
  done,
}: {
  snapshot: Snapshot;
  selected?: string;
  done: () => void;
}) {
  const items = openItems(s).filter((x) => x.state !== "paid"),
    banks = s.accounts.filter(
      (a) =>
        a.is_active &&
        ["bank", "cash", "wallet", "credit_card"].includes(a.role),
    );
  const empty = (): PaymentAllocation => ({
    obligation_id: selected ?? items[0]?.obligation.id ?? "",
    amount: "",
    funding_account_id: banks[0]?.id ?? "",
    funding_amount: "",
    funding_rate: "1",
  });
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([
      empty(),
    ]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<EventInput | null>(null);
  const form = useRef<HTMLFormElement>(null),
    id = useRef(crypto.randomUUID()),
    pending = useRef<EventInput | null>(null);
  function paymentInput(): PaymentInput {
    const f = new FormData(form.current!);
    return {
      id: id.current,
      accounting_date: String(f.get("date")),
      description: String(f.get("description")),
      allocations,
      fx_account_id: String(f.get("fx")) || undefined,
      ...(f.get("fee_amount")
        ? {
            fee: {
              amount: String(f.get("fee_amount")),
              rate: String(f.get("fee_rate")),
              account_id: String(f.get("fee_category")),
              funding_account_id: String(f.get("fee_bank")),
            },
          }
        : {}),
    };
  }
  function build() { return buildPayment(s, paymentInput()); }
  function change(index: number, key: keyof PaymentAllocation, value: string) {
    setAllocations(
      allocations.map((a, i) => (i === index ? { ...a, [key]: value } : a)),
    );
    pending.current = null;
    setPreview(null);
  }
  return (
    <form
      ref={form}
      onChange={() => {
        pending.current = null;
        setPreview(null);
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const event = pending.current ?? build();
          pending.current = event;
          await api(`/api/workspaces/${s.workspace.id}/commands`, {
            type: "payment", input: paymentInput(),
            post: true,
          });
          done();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="Payment date">
          <input
            name="date"
            type="date"
            defaultValue={workspaceToday(s.workspace.timezone)}
            required
          />
        </Field>
        <Field label="Description">
          <input
            name="description"
            defaultValue="Invoice / bill payment"
            maxLength={500}
            required
          />
        </Field>
      </div>
      {allocations.map((a, i) => (
        <div className="preview" key={i}>
          <div className="section-head">
            <strong>Payment {i + 1}</strong>
            {allocations.length > 1 && (
              <button
                type="button"
                className="text-action"
                onClick={() => {
                  setAllocations(allocations.filter((_, n) => n !== i));
                  pending.current = null;
                }}
              >
                Remove
              </button>
            )}
          </div>
          <Field label="Unpaid item">
            <select
              value={a.obligation_id}
              onChange={(e) => change(i, "obligation_id", e.target.value)}
              required
            >
              <option value="">Choose unpaid item</option>
              {items.map((x) => (
                <option key={x.obligation.id} value={x.obligation.id}>
                  {x.obligation.reference ?? x.transaction.description} ·{" "}
                  {x.party?.name} ·{" "}
                  {displayMoney(x.outstanding, x.line.currency_code)} left
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Amount cleared" hint="In the unpaid item’s currency">
              <input
                inputMode="decimal"
                value={a.amount}
                onChange={(e) => change(i, "amount", e.target.value)}
                required
              />
            </Field>
            <Field label="Money account">
              <select
                value={a.funding_account_id}
                onChange={(e) =>
                  change(i, "funding_account_id", e.target.value)
                }
                required
              >
                <option value="">Choose account</option>
                <AccountOptions accounts={banks} />
              </select>
            </Field>
            <Field
              label="Actual money received / paid"
              hint="In the money account’s currency"
            >
              <input
                inputMode="decimal"
                value={a.funding_amount}
                onChange={(e) => change(i, "funding_amount", e.target.value)}
                required
              />
            </Field>
            <Field
              label="Money-account exchange rate"
              hint={`Home units (${s.workspace.functional_currency_code}) per native unit`}
            >
              <input
                inputMode="decimal"
                value={a.funding_rate}
                onChange={(e) => change(i, "funding_rate", e.target.value)}
                required
              />
            </Field>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="text-action spacer"
        onClick={() => {
          setAllocations([...allocations, empty()]);
          pending.current = null;
        }}
      >
        + Add another item / funding source
      </button>
      <div className="spacer">
        <Field label="FX / rounding category">
          <select name="fx">
            <option value="">Choose when values differ</option>
            <AccountOptions
              accounts={s.accounts.filter(
                (a) =>
                  a.is_active &&
                  a.role === "general" &&
                  ["revenue", "expense"].includes(a.type),
              )}
            />
          </select>
        </Field>
      </div>
      <details>
        <summary>Include a bank or payment fee</summary>
        <div className="form-grid spacer">
          <Field label="Fee amount">
            <input name="fee_amount" inputMode="decimal" />
          </Field>
          <Field label="Fee exchange rate">
            <input name="fee_rate" defaultValue="1" inputMode="decimal" />
          </Field>
          <Field label="Fee paid from">
            <select name="fee_bank">
              <AccountOptions accounts={banks} />
            </select>
          </Field>
          <Field label="Fee category">
            <select name="fee_category">
              <AccountOptions
                accounts={s.accounts.filter(
                  (a) =>
                    a.is_active && a.type === "expense" && a.role === "general",
                )}
              />
            </select>
          </Field>
        </div>
      </details>
      <Notice message={error} error />
      {preview && (
        <div className="notice success">
          {preview.settlements.length} allocation(s), {preview.lines.length}{" "}
          postings. Income and expense are not recognized again.
        </div>
      )}
      <div className="dialog-actions">
        <Action
          variant="secondary"
          type="button"
          onPress={() => {
            try {
              setPreview(build());
              setError("");
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          Check payment
        </Action>
        <Action type="submit" isDisabled={busy || items.length === 0}>
          {busy ? "Recording…" : "Record payment →"}
        </Action>
      </div>
    </form>
  );
}
