"use client";
import { displayMoney } from "@/lib/money";

export function AccumulatedResult({ amount, currency, open }: {
  amount: string;
  currency: string;
  open: () => void;
}) {
  return <>
    <div className="report-line">
      <span>Accumulated unclosed profit/loss</span>
      <button onClick={open} aria-label="View accumulated unclosed profit/loss details">
        {displayMoney(amount, currency)} ↗
      </button>
    </div>
    <p className="muted">
      <small>All unclosed income less expenses through this date; included in total equity.</small>
    </p>
  </>;
}
