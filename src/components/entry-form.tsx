"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  buildGuided,
  previewTransfer,
  type GuidedInput,
  type Split,
  type TransferValues,
} from "@/lib/guided";
import { d, displayMoney } from "@/lib/money";
import { workspaceToday } from "@/lib/reports";
import type { Account, EventInput, Kind, Snapshot } from "@/lib/types";
import { Action, Field, Notice } from "./ui";
import { ManualJournalForm } from "./manual-journal-form";
export const actionLabels: Partial<Record<Kind, string>> = {
  income: "Receive money",
  expense: "Spend money",
  transfer: "Move money",
  contribution: "Add owner money",
  withdrawal: "Take owner money",
  asset_purchase: "Buy equipment",
  deposit: "Pay refundable deposit",
  invoice: "Record client invoice",
  bill: "Record supplier bill",
  opening_balance: "Add opening balance",
  adjustment: "Manual journal entry",
};
function choices(s: Snapshot, kind: Kind) {
  const active = s.accounts.filter((a) => a.is_active),
    money = active.filter((a) =>
      ["bank", "cash", "wallet", "credit_card"].includes(a.role),
    );
  const category = (type: string) =>
    active.filter((a) => a.role === "general" && a.type === type);
  if (kind === "invoice")
    return {
      source: active.filter((a) => a.role === "receivable"),
      target: category("revenue"),
    };
  if (kind === "bill")
    return {
      source: active.filter((a) => a.role === "payable"),
      target: category("expense"),
    };
  if (kind === "opening_balance") return { source: active, target: active };
  return {
    source: money,
    target:
      kind === "income"
        ? category("revenue")
        : kind === "expense"
          ? category("expense")
          : kind === "transfer"
            ? money
            : ["contribution", "withdrawal"].includes(kind)
              ? category("equity")
              : category("asset"),
  };
}
export function AccountOptions({ accounts }: { accounts: Account[] }) {
  return (
    <>
      {accounts.map((a) => (
        <option value={a.id} key={a.id}>
          {a.name}
          {a.currency_code ? ` · ${a.currency_code}` : ""}
        </option>
      ))}
    </>
  );
}
export function EntryForm({
  snapshot: s,
  initialKind = "expense",
  done,
}: {
  snapshot: Snapshot;
  initialKind?: Kind;
  done: () => void;
}) {
  const [kind, setKind] = useState(initialKind),
    [sourceId, setSourceId] = useState(""),
    [destinationId, setDestinationId] = useState(""),
    [splits, setSplits] = useState<Split[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<EventInput | null>(null),
    [transferValues, setTransferValues] = useState<TransferValues | null>(null);
  const form = useRef<HTMLFormElement>(null),
    id = useRef(crypto.randomUUID()),
    pending = useRef<EventInput | null>(null);
  const options = choices(s, kind),
    functional = s.workspace.functional_currency_code,
    source = s.accounts.find((a) => a.id === sourceId),
    destination = s.accounts.find((a) => a.id === destinationId),
    sourceCurrency = source?.currency_code,
    destinationCurrency = destination?.currency_code,
    transfer = kind === "transfer",
    difference = transferValues ? d(transferValues.difference) : null,
    needsFx = difference !== null && !difference.isZero();
  function input(): GuidedInput {
    const f = new FormData(form.current!);
    const optional = (key: string) => f.get(key)?.toString() || undefined;
    return {
      id: id.current,
      kind,
      accounting_date: String(f.get("date")),
      description: String(f.get("description")),
      party_id: String(f.get("party")) || null,
      source_id: String(f.get("source")),
      destination_id: String(f.get("destination")),
      amount: String(f.get("amount")),
      currency: transfer
        ? (sourceCurrency ?? functional)
        : String(f.get("currency")),
      rate: String(f.get("rate") ?? "1"),
      destination_amount: transfer
        ? String(f.get("destination_amount") ?? "")
        : optional("destination_amount"),
      destination_rate: optional("destination_rate"),
      fx_account_id: optional("fx"),
      reference: optional("reference"),
      due_date: optional("due"),
      splits: splits.filter((x) => x.account_id && x.amount),
    } as GuidedInput;
  }
  const updatePreview = () => {
    pending.current = null;
    setError("");
    setTransferValues(null);
    try {
      const p = input();
      if (transfer) setTransferValues(previewTransfer(s, p));
      setPreview(buildGuided(s, p));
    } catch {
      setPreview(null);
    }
  };
  async function save(post: boolean) {
    if (!form.current?.reportValidity()) return;
    setError("");
    setBusy(true);
    try {
      const event = pending.current ?? buildGuided(s, input());
      pending.current = event;
      await api(`/api/workspaces/${s.workspace.id}/events`, { event, post });
      done();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (kind === "adjustment")
    return (
      <ManualJournalForm
        snapshot={s}
        done={done}
        actions={actionLabels}
        onKindChange={(next) => {
          setKind(next);
          setSplits([]);
          setSourceId("");
          setDestinationId("");
          setTransferValues(null);
          setPreview(null);
          setError("");
          pending.current = null;
        }}
      />
    );
  return (
    <form
      ref={form}
      onChange={(e) => {
        if (!(
          e.target instanceof HTMLSelectElement && e.target.name === "kind"
        ))
          updatePreview();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void save(true);
      }}
    >
      <div className="form-grid">
        <Field label="What happened?">
          <select
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setSplits([]);
              setSourceId("");
              setDestinationId("");
              setTransferValues(null);
              setError("");
              pending.current = null;
              setPreview(null);
            }}
          >
            {Object.entries(actionLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" hint={`In ${s.workspace.timezone}`}>
          <input
            type="date"
            name="date"
            defaultValue={workspaceToday(s.workspace.timezone)}
            required
          />
        </Field>
        <div className="full">
          <Field label="A short description">
            <input
              name="description"
              placeholder="e.g. October office rent"
              required
              maxLength={500}
              autoFocus
            />
          </Field>
        </div>
        <Field
          label={
            kind === "invoice"
              ? "Customer amounts due"
              : kind === "bill"
                ? "Supplier amounts owed"
                : kind === "opening_balance"
                  ? "Balance coming from (credit)"
                  : "Money account"
          }
        >
          <select
            name="source"
            required
            key={`source-${kind}`}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Choose account</option>
            <AccountOptions accounts={options.source} />
          </select>
        </Field>
        <Field
          label={
            kind === "transfer"
              ? "Move to"
              : kind === "opening_balance"
                ? "Balance going to (debit)"
                : "Category / destination"
          }
        >
          <select
            name="destination"
            required={splits.length === 0}
            key={`destination-${kind}`}
            onChange={(e) => setDestinationId(e.target.value)}
          >
            <option value="">Choose account</option>
            <AccountOptions accounts={options.target} />
          </select>
        </Field>
        <Field
          label={
            transfer
              ? `Amount leaving${sourceCurrency ? ` (${sourceCurrency})` : ""}`
              : "Amount"
          }
          hint={
            transfer ? "Amount in the source account’s currency" : undefined
          }
        >
          <input
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            required
          />
        </Field>
        {!transfer && (
          <Field
            label="Entry currency"
            hint="Money accounts use their fixed currency"
          >
            <select name="currency" defaultValue={functional}>
              {["THB", "SGD", "MMK", "USD"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        )}
        {!transfer && (
          <Field
            label="Exchange rate"
            hint={`1 entry-currency unit = how many ${functional}?`}
          >
            <input name="rate" inputMode="decimal" defaultValue="1" required />
          </Field>
        )}
        {transfer &&
          source?.type === "liability" &&
          sourceCurrency !== functional && (
            <Field
              label={`Source exchange rate (${sourceCurrency} → ${functional})`}
              hint={`1 ${sourceCurrency} = how many ${functional}?`}
            >
              <input
                name="rate"
                inputMode="decimal"
                defaultValue="1"
                required
              />
            </Field>
          )}
        <Field label="Customer / supplier (optional)">
          <select name="party" required={["invoice", "bill"].includes(kind)}>
            <option value="">No contact</option>
            {s.parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {kind === "transfer" && (
          <>
            <Field
              label={`Amount arriving${destinationCurrency ? ` (${destinationCurrency})` : ""}`}
              hint={
                destinationCurrency === functional
                  ? `Amount in ${functional}, the home currency; no conversion is needed`
                  : "Amount in the destination account’s currency"
              }
            >
              <input name="destination_amount" inputMode="decimal" required />
            </Field>
            {destinationCurrency &&
              destinationCurrency !== functional &&
              destination?.type !== "liability" && (
                <Field
                  label={`Destination exchange rate (${destinationCurrency} → ${functional})`}
                  hint={`1 ${destinationCurrency} = how many ${functional}?`}
                >
                  <input
                    name="destination_rate"
                    inputMode="decimal"
                    defaultValue="1"
                    required
                  />
                </Field>
              )}
          </>
        )}
        {["invoice", "bill", "opening_balance"].includes(kind) && (
          <>
            <Field label="Reference (optional)">
              <input name="reference" maxLength={100} placeholder="INV-001" />
            </Field>
            <Field label="Due date (optional)">
              <input name="due" type="date" />
            </Field>
          </>
        )}
      </div>
      {kind === "opening_balance" && (
        <div className="notice success">
          For an existing asset, choose opening equity as the source and the
          asset as the destination. For an existing liability, choose the
          liability as the source and opening equity as the destination. Unpaid
          balances also need a contact.
        </div>
      )}
      {!["transfer", "opening_balance", "contribution", "withdrawal"].includes(
        kind,
      ) && (
        <div className="spacer">
          <div className="section-head">
            <strong>Split across categories</strong>
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setSplits([
                  ...splits,
                  { account_id: options.target[0]?.id ?? "", amount: "" },
                ]);
                pending.current = null;
                setPreview(null);
              }}
            >
              + Add split
            </button>
          </div>
          {splits.map((split, index) => (
            <div className="split-row" key={index}>
              <select
                aria-label={`Split ${index + 1} category`}
                value={split.account_id}
                onChange={(e) => {
                  setSplits(
                    splits.map((v, i) =>
                      i === index ? { ...v, account_id: e.target.value } : v,
                    ),
                  );
                  pending.current = null;
                  setPreview(null);
                }}
              >
                <AccountOptions accounts={options.target} />
              </select>
              <input
                aria-label={`Split ${index + 1} amount`}
                value={split.amount}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => {
                  setSplits(
                    splits.map((v, i) =>
                      i === index ? { ...v, amount: e.target.value } : v,
                    ),
                  );
                  pending.current = null;
                  setPreview(null);
                }}
              />
              <button
                type="button"
                aria-label={`Remove split ${index + 1}`}
                onClick={() => {
                  setSplits(splits.filter((_, i) => i !== index));
                  pending.current = null;
                  setPreview(null);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {transfer && transferValues && (
        <section
          className="preview"
          aria-label="Transfer home-currency values"
          aria-live="polite"
        >
          <small>TRANSFER IN {functional}</small>
          <div className="report-line">
            <span>Home value leaving</span>
            <strong>{displayMoney(transferValues.outgoing, functional)}</strong>
          </div>
          <div className="report-line">
            <span>Home value arriving</span>
            <strong>{displayMoney(transferValues.incoming, functional)}</strong>
          </div>
          <div className="report-line">
            <span>
              {needsFx
                ? `FX / rounding ${difference!.isPositive() ? "gain" : "loss"}`
                : "No FX / rounding difference"}
            </span>
            <strong>
              {displayMoney(difference!.abs().toString(), functional)}
            </strong>
          </div>
          <small>
            {sourceCurrency !== functional
              ? source?.type === "asset"
                ? `The outgoing ${sourceCurrency} uses its historical ${functional} book value, not today’s exchange rate.`
                : `The outgoing ${sourceCurrency} is converted using the source exchange rate.`
              : `The outgoing ${functional} is already in the home currency.`}
            {destination?.type === "liability" &&
              destinationCurrency !== functional &&
              ` The arriving ${destinationCurrency} reduces its historical ${functional} liability value.`}
            {needsFx &&
              " The home-currency values differ; choose a category below to record this gain or loss."}
          </small>
        </section>
      )}
      {(!transfer || needsFx) && (
        <Field
          label={
            transfer
              ? "FX / rounding category"
              : "FX / rounding category (if values differ)"
          }
          hint="The difference appears as a separate income or expense entry"
        >
          <select name="fx">
            <option value="">Choose only when needed</option>
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
      )}
      {!transfer && preview && (
        <div className="preview">
          <small>HOME-CURRENCY PREVIEW</small>
          <div className="report-line">
            <strong>
              {displayMoney(
                preview.lines
                  .filter((l) => l.side === "debit")
                  .reduce((v, l) => v.plus(l.book_amount), d(0))
                  .toString(),
                functional,
              )}
            </strong>
            <span>{preview.lines.length} postings</span>
          </div>
          <small>
            Historical rates stay with this entry. Foreign balances use their
            original carried value when spent.
          </small>
        </div>
      )}
      <Notice message={error} error />
      <div className="dialog-actions">
        <Action
          type="button"
          variant="secondary"
          isDisabled={busy}
          onPress={() => void save(false)}
        >
          Save draft
        </Action>
        <Action type="submit" isDisabled={busy}>
          {busy ? "Saving…" : "Record entry →"}
        </Action>
      </div>
    </form>
  );
}
