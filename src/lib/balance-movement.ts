import { d, money } from "./money";
import { reports } from "./reports";
import type { ReportDrill, ReportGroup } from "./report-detail";
import type { Snapshot } from "./types";

export function previousDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
export function balanceMovement(snapshot: Snapshot, from: string, to: string) {
  if (!from || !to || from > to) throw new Error("Choose a start date on or before the end date.");
  const before = { ...snapshot, transactions: snapshot.transactions.filter((t) => t.accounting_date < from) };
  const opening = reports(before, "", to), closing = reports(snapshot, "", to);
  const change = (a: string, b: string) => money(d(b).minus(a));
  const rows = snapshot.accounts.filter((a) => ["asset", "liability", "equity"].includes(a.type)).map((account) => {
    const sign = account.type === "asset" ? 1 : -1;
    const start = money(d(opening.all.find((r) => r.account.id === account.id)!.balance).times(sign));
    const end = money(d(closing.all.find((r) => r.account.id === account.id)!.balance).times(sign));
    return { id: account.id, label: account.name, group: account.type as ReportGroup, opening: start, movement: change(start, end), closing: end, accountId: account.id };
  });
  rows.push({ id: "unclosed-result", label: "Accumulated unclosed profit/loss", group: "accumulated", opening: opening.unclosed,
    movement: change(opening.unclosed, closing.unclosed), closing: closing.unclosed, accountId: "" });
  const totals = (["assets", "liabilities", "equity"] as const).map((key) => ({
    id: key, label: key === "equity" ? "Total equity" : key === "assets" ? "Total assets" : "Total liabilities",
    group: (key === "assets" ? "asset" : key === "liabilities" ? "liability" : "equity") as ReportGroup,
    opening: opening[key], movement: change(opening[key], closing[key]), closing: closing[key],
  }));
  return { rows, totals };
}
export function movementDrill(from: string, to: string, column: "opening" | "movement" | "closing", accountId?: string, group?: ReportGroup): ReportDrill {
  return { mode: column === "movement" ? "balance_movement" : "balance_sheet", from: column === "movement" ? from : "",
    to: column === "opening" ? previousDate(from) : to, accountId: accountId || undefined, group: accountId ? "all" : group };
}
