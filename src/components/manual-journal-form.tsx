"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  buildManual,
  previewManual,
  usesCarryingValue,
  type ManualLine,
} from "@/lib/manual-journal";
import { d, displayMoney } from "@/lib/money";
import { workspaceToday } from "@/lib/reports";
import {
  currencies,
  type Currency,
  type EventInput,
  type Kind,
  type Snapshot,
} from "@/lib/types";
import { Action, Field, Notice } from "./ui";

const emptyLine = (
  home: Currency,
  side: ManualLine["side"] = "debit",
): ManualLine => ({
  id: crypto.randomUUID(),
  account_id: "",
  side,
  amount: "",
  currency_code: home,
  exchange_rate: "1",
});
export function ManualJournalForm({
  snapshot: initialSnapshot,
  initialEvent,
  actions,
  onKindChange,
  done,
}: {
  snapshot: Snapshot;
  initialEvent?: EventInput;
  actions?: Partial<Record<Kind, string>>;
  onKindChange?: (kind: Kind) => void;
  done: () => void;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const home = snapshot.workspace.functional_currency_code;
  const [rows, setRows] = useState<ManualLine[]>(
    () =>
      initialEvent?.lines.map(
        ({ id, account_id, side, amount, currency_code, exchange_rate }) => ({
          id,
          account_id,
          side,
          amount,
          currency_code,
          exchange_rate,
        }),
      ) ?? [emptyLine(home), emptyLine(home, "credit")],
  );
  const [date, setDate] = useState(
    initialEvent?.accounting_date ??
      workspaceToday(snapshot.workspace.timezone),
  );
  const [description, setDescription] = useState(
    initialEvent?.description ?? "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null),
    id = useRef(initialEvent?.id ?? crypto.randomUUID()),
    pending = useRef<EventInput | null>(null);
  const accounts = snapshot.accounts.filter(
    (a) => a.is_active && !["receivable", "payable"].includes(a.role),
  );
  let preview: ReturnType<typeof previewManual> | null = null,
    validation = "";
  try {
    preview = previewManual(snapshot, rows);
  } catch (e) {
    validation = (e as Error).message;
  }
  const balanced = preview !== null && d(preview.difference).isZero();
  const hasCarrying = rows.some((row) =>
    usesCarryingValue(
      accounts.find((a) => a.id === row.account_id),
      row.side,
      row.currency_code,
      home,
    ),
  );
  function changed() {
    pending.current = null;
    setError("");
  }
  function update(index: number, values: Partial<ManualLine>) {
    changed();
    setRows(rows.map((row, i) => (i === index ? { ...row, ...values } : row)));
  }
  async function save(post: boolean) {
    if (!form.current?.reportValidity()) return;
    setError("");
    setBusy(true);
    try {
      const event =
        pending.current ??
        buildManual(
          snapshot,
          {
            id: id.current,
            accounting_date: date,
            description,
            party_id: initialEvent?.party_id ?? null,
            lines: rows,
          },
          post,
        );
      // A retry reuses the same event and row identities. Posting is still
      // validated by the database, including a draft saved on a previous try.
      if (post && !balanced)
        throw new Error("Balance the journal before posting");
      pending.current = event;
      await api(`/api/workspaces/${snapshot.workspace.id}/commands`, {
        type: "manual",
        input: {id: id.current, accounting_date: date, description, party_id: initialEvent?.party_id ?? null, lines: rows},
        post,
      });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshBalances() {
    setBusy(true);
    setError("");
    pending.current = null;
    try {
      setSnapshot(
        await api<Snapshot>(`/api/workspaces/${snapshot.workspace.id}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        void save(true);
      }}
    >
      <div className="form-grid">
        {onKindChange && actions ? (
          <Field label="What happened?">
            <select
              value="adjustment"
              onChange={(e) => onKindChange(e.target.value as Kind)}
              disabled={busy}
            >
              {Object.entries(actions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <h3>Manual journal entry</h3>
        )}
        <Field
          label="Accounting date"
          hint={`In ${snapshot.workspace.timezone}`}
        >
          <input
            type="date"
            disabled={busy}
            value={date}
            required
            onChange={(e) => {
              changed();
              setDate(e.target.value);
            }}
          />
        </Field>
        <div className="full">
          <Field label="A short description">
            <input
              value={description}
              disabled={busy}
              required
              maxLength={500}
              onChange={(e) => {
                changed();
                setDescription(e.target.value);
              }}
            />
          </Field>
        </div>
      </div>
      <p className="muted">
        Each line keeps its original currency and home value. Customer amounts
        due and supplier amounts owed use the invoice, bill and payment forms to
        keep unpaid items linked.
      </p>
      <div className="manual-lines">
        {rows.map((row, index) => {
          const account = accounts.find((a) => a.id === row.account_id);
          const carrying = usesCarryingValue(
            account,
            row.side,
            row.currency_code,
            home,
          );
          const calculated = preview?.lines.find((l) => l.id === row.id);
          return (
            <fieldset className="manual-line" key={row.id} disabled={busy}>
              <legend>Line {index + 1}</legend>
              <div className="form-grid">
                <Field label="Account">
                  <select
                    value={row.account_id}
                    required
                    onChange={(e) => {
                      const next = accounts.find(
                        (a) => a.id === e.target.value,
                      );
                      const code = next?.currency_code ?? row.currency_code;
                      update(index, {
                        account_id: e.target.value,
                        currency_code: code,
                        exchange_rate:
                          code === home || code !== row.currency_code
                            ? "1"
                            : row.exchange_rate,
                      });
                    }}
                  >
                    <option value="">Choose account</option>
                    {accounts.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                        {a.currency_code
                          ? ` · ${a.currency_code}`
                          : " · Any currency"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Posting side">
                  <select
                    value={row.side}
                    onChange={(e) =>
                      update(index, {
                        side: e.target.value as ManualLine["side"],
                      })
                    }
                  >
                    <option value="debit">Debit</option>
                    <option value="credit">Credit</option>
                  </select>
                </Field>
                <Field label="Original amount">
                  <input
                    inputMode="decimal"
                    required
                    value={row.amount}
                    onChange={(e) => update(index, { amount: e.target.value })}
                  />
                </Field>
                <Field
                  label="Currency"
                  hint={
                    account?.currency_code
                      ? "Fixed by the selected account"
                      : "Choose the original currency"
                  }
                >
                  <select
                    value={row.currency_code}
                    disabled={!!account?.currency_code}
                    onChange={(e) =>
                      update(index, {
                        currency_code: e.target.value as Currency,
                        exchange_rate: "1",
                      })
                    }
                  >
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Exchange rate"
                  hint={
                    carrying
                      ? "Calculated from historical carrying value"
                      : `1 ${row.currency_code} = how many ${home}?`
                  }
                >
                  <input
                    inputMode="decimal"
                    value={
                      carrying
                        ? (calculated?.exchange_rate ?? "")
                        : row.currency_code === home
                          ? "1"
                          : row.exchange_rate
                    }
                    readOnly={carrying || row.currency_code === home}
                    placeholder={carrying ? "Automatic" : ""}
                    required={!carrying}
                    onChange={(e) =>
                      update(index, { exchange_rate: e.target.value })
                    }
                  />
                </Field>
                <div className="field">
                  <span>Home value ({home})</span>
                  <output
                    className="manual-value"
                    aria-label={`Line ${index + 1} home value`}
                  >
                    {calculated
                      ? displayMoney(calculated.book_amount, home)
                      : "—"}
                  </output>
                </div>
              </div>
              <button
                type="button"
                className="text-action spacer"
                aria-label={`Remove line ${index + 1}`}
                disabled={rows.length <= 2}
                onClick={() => {
                  changed();
                  setRows(rows.filter((_, i) => i !== index));
                }}
              >
                Remove line
              </button>
            </fieldset>
          );
        })}
      </div>
      <button
        type="button"
        className="text-action spacer"
        disabled={busy || rows.length >= 100}
        onClick={() => {
          changed();
          setRows([...rows, emptyLine(home)]);
        }}
      >
        + Add journal line
      </button>
      {hasCarrying && (
        <div className="spacer">
          <p className="muted">
            Foreign balance reductions use historical carried values. Refresh
            balances if other entries have changed. Add an FX gain/loss as an
            explicit journal line when needed.
          </p>
          <Action
            type="button"
            variant="secondary"
            isDisabled={busy}
            onPress={() => void refreshBalances()}
          >
            Refresh balances
          </Action>
        </div>
      )}
      <section
        className="preview"
        aria-label="Journal totals"
        aria-live="polite"
      >
        <div className="report-line">
          <span>Total debits</span>
          <strong>{preview ? displayMoney(preview.debits, home) : "—"}</strong>
        </div>
        <div className="report-line">
          <span>Total credits</span>
          <strong>{preview ? displayMoney(preview.credits, home) : "—"}</strong>
        </div>
        <div className="report-line">
          <span>Difference (debits − credits)</span>
          <strong>
            {preview ? displayMoney(preview.difference, home) : "—"}
          </strong>
        </div>
        <small>
          {validation ||
            (balanced
              ? "Balanced and ready to post"
              : "Save as a draft or correct the difference before posting. No balancing line is added automatically.")}
        </small>
      </section>
      <Notice message={error} error />
      <div className="dialog-actions">
        <Action
          type="button"
          variant="secondary"
          isDisabled={busy || !preview}
          onPress={() => void save(false)}
        >
          Save draft
        </Action>
        <Action type="submit" isDisabled={busy || !balanced}>
          {busy ? "Saving…" : "Post journal entry →"}
        </Action>
      </div>
    </form>
  );
}
