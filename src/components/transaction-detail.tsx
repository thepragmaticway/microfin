"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { convert, displayMoney } from "@/lib/money";
import { workspaceToday } from "@/lib/reports";
import { refreshDraftCarrying } from "@/lib/guided";
import type { EventInput, Snapshot, Transaction } from "@/lib/types";
import { Action, Field, Notice } from "./ui";
export function TransactionDetail({
  snapshot: s,
  transaction: t,
  done,
}: {
  snapshot: Snapshot;
  transaction: Transaction;
  done: () => void;
}) {
  const lines = s.lines.filter((l) => l.transaction_id === t.id),
    obligation = s.obligations.find((o) =>
      lines.some((l) => l.id === o.recognition_line_id),
    );
  const [event, setEvent] = useState<EventInput>({
    id: t.id,
    accounting_date: t.accounting_date,
    kind: t.kind,
    description: t.description,
    party_id: t.party_id,
    lines: lines.map(
      ({
        id,
        account_id,
        side,
        amount,
        currency_code,
        exchange_rate,
        book_amount,
        rate_source,
      }) => ({
        id,
        account_id,
        side,
        amount,
        currency_code,
        exchange_rate,
        book_amount,
        rate_source,
      }),
    ),
    obligation: obligation
      ? {
          id: obligation.id,
          recognition_line_id: obligation.recognition_line_id,
          reference: obligation.reference,
          due_date: obligation.due_date,
        }
      : null,
    settlements: s.settlements
      .filter((x) => lines.some((l) => l.id === x.clearing_line_id))
      .map(({ id, obligation_id, clearing_line_id, funding_line_id }) => ({
        id,
        obligation_id,
        clearing_line_id,
        funding_line_id,
      })),
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reversalDate, setReversalDate] = useState(
      workspaceToday(s.workspace.timezone),
    ),
    [confirm, setConfirm] = useState(false);
  const fxCandidates = event.lines.filter(
    (l) =>
      l.currency_code === s.workspace.functional_currency_code &&
      s.accounts.some(
        (a) =>
          a.id === l.account_id &&
          a.role === "general" &&
          ["revenue", "expense"].includes(a.type),
      ),
  );
  const [fxLineId, setFxLineId] = useState(""),
    [fxAccountId, setFxAccountId] = useState(""),
    [notice, setNotice] = useState("");
  const hasForeignDischarge = event.lines.some(
    (l) =>
      l.currency_code !== s.workspace.functional_currency_code &&
      s.accounts.some(
        (a) =>
          a.id === l.account_id &&
          ["asset", "liability"].includes(a.type) &&
          (a.type === "asset" ? l.side === "credit" : l.side === "debit"),
      ),
  );
  async function refreshCarrying() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const latest = await api<Snapshot>(`/api/workspaces/${s.workspace.id}`);
      setEvent(
        refreshDraftCarrying(latest, event, fxAccountId, fxLineId || undefined),
      );
      setNotice(
        "Carrying values refreshed. Review the home values and FX difference, then record the draft.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const reversed = s.transactions.find((r) => r.reversal_of_id === t.id);
  async function save(post: boolean) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/workspaces/${s.workspace.id}/events`, { event, post });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="section-head">
        <span className="pill">
          {t.posted_at ? (reversed ? "Reversed" : "Recorded") : "Draft"}
        </span>
        <small>{t.accounting_date}</small>
      </div>
      {!t.posted_at ? (
        <>
          <Field label="Description">
            <input
              value={event.description}
              onChange={(e) =>
                setEvent({ ...event, description: e.target.value })
              }
            />
          </Field>
          <Field label="Accounting date">
            <input
              type="date"
              value={event.accounting_date}
              onChange={(e) =>
                setEvent({ ...event, accounting_date: e.target.value })
              }
            />
          </Field>
        </>
      ) : (
        <h3>{t.description}</h3>
      )}
      <div className="table-wrap">
        <table className="detail-lines">
          <thead>
            <tr>
              <th>Account</th>
              <th>Original amount</th>
              <th>Rate</th>
              <th className="align-right">Home value</th>
            </tr>
          </thead>
          <tbody>
            {event.lines.map((l, index) => (
              <tr key={l.id}>
                <td>
                  {s.accounts.find((a) => a.id === l.account_id)?.name}
                  <br />
                  <small>
                    {l.side === "debit" ? "In / debit" : "Out / credit"}
                  </small>
                </td>
                <td>
                  {t.posted_at ? (
                    displayMoney(l.amount, l.currency_code)
                  ) : (
                    <label>
                      <span className="muted">{l.currency_code}</span>
                      <input
                        aria-label={`Posting ${index + 1} amount`}
                        className="filter-input"
                        value={l.amount}
                        onChange={(e) =>
                          setEvent({
                            ...event,
                            lines: event.lines.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    amount: e.target.value,
                                    book_amount: /^\d+(?:\.\d*)?$/.test(
                                      e.target.value,
                                    )
                                      ? convert(e.target.value, x.exchange_rate)
                                      : x.book_amount,
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                  )}
                </td>
                <td>
                  {l.exchange_rate}
                  <br />
                  <small>
                    {l.rate_source?.replace("_", " ") ?? "same currency"}
                  </small>
                </td>
                <td className="align-right">
                  {displayMoney(
                    l.book_amount,
                    s.workspace.functional_currency_code,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted spacer">
        <small>Entry ID: {t.id}</small>
      </p>
      {t.reversal_of_id && (
        <p className="muted">This entry reverses {t.reversal_of_id}.</p>
      )}
      {reversed && (
        <p className="muted">
          Reversed on {reversed.accounting_date}. Both entries remain in your
          history.
        </p>
      )}
      <Notice message={error} error />
      <Notice message={notice} />
      {!t.posted_at && hasForeignDischarge && (
        <div className="preview">
          <h3>Review current carrying values</h3>
          <p className="muted">
            Other entries may have changed this account’s carried rate. Refresh
            before recording; your original amounts and expense rates stay the
            same.
          </p>
          <Field label="Existing FX / rounding posting to replace">
            <select
              value={fxLineId}
              onChange={(e) => {
                setFxLineId(e.target.value);
                const selected = event.lines.find(
                  (l) => l.id === e.target.value,
                );
                if (selected) setFxAccountId(selected.account_id);
              }}
            >
              <option value="">No existing FX / rounding posting</option>
              {fxCandidates.map((l) => (
                <option key={l.id} value={l.id}>
                  {s.accounts.find((a) => a.id === l.account_id)?.name} ·{" "}
                  {l.side} ·{" "}
                  {displayMoney(
                    l.book_amount,
                    s.workspace.functional_currency_code,
                  )}
                </option>
              ))}
            </select>
          </Field>
          <Field label="FX / rounding category">
            <select
              value={fxAccountId}
              onChange={(e) => setFxAccountId(e.target.value)}
            >
              <option value="">Choose a category for any difference</option>
              {s.accounts
                .filter(
                  (a) =>
                    a.is_active &&
                    a.role === "general" &&
                    ["revenue", "expense"].includes(a.type) &&
                    (!a.currency_code ||
                      a.currency_code === s.workspace.functional_currency_code),
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
          <Action
            variant="secondary"
            isDisabled={busy}
            onPress={() => void refreshCarrying()}
          >
            Refresh carrying values
          </Action>
        </div>
      )}
      {!t.posted_at ? (
        <div className="dialog-actions">
          <Action
            variant="secondary"
            isDisabled={busy}
            onPress={() => void save(false)}
          >
            Save draft changes
          </Action>
          <Action isDisabled={busy} onPress={() => void save(true)}>
            Record draft
          </Action>
        </div>
      ) : (
        !t.reversal_of_id &&
        !reversed && (
          <div className="spacer">
            {!confirm ? (
              <Action variant="secondary" onPress={() => setConfirm(true)}>
                Correct with a reversal
              </Action>
            ) : (
              <div className="preview">
                <p>
                  Reverse the full entry, then add a separate corrected entry.
                  Reverse any dependent payments first.
                </p>
                <Field label="Reversal date">
                  <input
                    type="date"
                    value={reversalDate}
                    min={t.accounting_date}
                    onChange={(e) => setReversalDate(e.target.value)}
                  />
                </Field>
                <Action
                  isDisabled={busy}
                  onPress={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/api/workspaces/${s.workspace.id}/reversals`, {
                        original: t.id,
                        reversal: crypto.randomUUID(),
                        on_date: reversalDate,
                      });
                      done();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirm full reversal
                </Action>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
