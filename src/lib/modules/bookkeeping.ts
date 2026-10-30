import { buildGuided } from "../guided";
import { buildManual } from "../manual-journal";
import { buildPayment } from "../accounting/settlement";
import { buildInvoiceOrBill } from "./invoicing";
import type { AccountingCommand } from "../accounting/contracts";
import type { Kind, Snapshot } from "../types";

export function prepareBookkeeping(s: Snapshot, p: AccountingCommand) {
  if (p.type === "manual") return buildManual(s, p.input, p.post);
  if (p.type === "payment") return buildPayment(s, p.input);
  const choices = guidedChoices(s, p.input.kind);
  if (!choices.source.some((a) => a.id === p.input.source_id)) throw new Error("Choose a permitted source account for this action");
  const targets = p.input.splits.length ? p.input.splits : [{account_id: p.input.destination_id}];
  if (targets.some((part) => !choices.target.some((a) => a.id === part.account_id))) throw new Error("Choose a permitted destination account for this action");
  return p.input.kind === "invoice" || p.input.kind === "bill"
    ? buildInvoiceOrBill(s, p.input)
    : buildGuided(s, p.input);
}


export function guidedChoices(s: Snapshot, kind: Kind) {
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
