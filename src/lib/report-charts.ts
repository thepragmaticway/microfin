import { d, money } from "./money";
import { reports, workspaceToday } from "./reports";
import { reportSign, type ReportGroup, type ReportMode } from "./report-detail";
import type { Snapshot } from "./types";

export type ChartMetric = "revenue" | "expenses" | "profit" | "assets" | "liabilities" | "equity";
export interface ChartRow {
  id: string;
  label: string;
  value: string;
  group: ReportGroup;
  accountId?: string;
}
export interface ChartPeriod {
  label: string;
  from: string;
  to: string;
  values: Record<ChartMetric, string>;
}
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
function monthStart(index: number) {
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}-01`;
}
function monthEnd(index: number) {
  const year = Math.floor(index / 12), month = index % 12;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
  return monthStart(index).slice(0, 8) + days;
}
const monthLabel = (date: string) =>
  `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

export function reportChartData(s: Snapshot, mode: ReportMode, from: string, to: string) {
  if (mode === "profit_loss" && from && to && from > to)
    throw new Error("From date must be on or before through date.");
  const dates = s.transactions.filter((t) => t.posted_at).map((t) => t.accounting_date).sort();
  const end = to || dates.at(-1) || workspaceToday(s.workspace.timezone);
  const start = from || dates.find((date) => date <= end) || end;
  const full = reports(s, mode === "profit_loss" ? from : "", to);
  const rows = (type: "revenue" | "expense" | "asset" | "liability" | "equity"): ChartRow[] =>
    (mode === "profit_loss" ? full.period : full.all)
      .filter(({ account, balance }) => account.type === type && !d(balance).isZero())
      .map(({ account, balance }) => ({
        id: account.id, accountId: account.id, label: account.name,
        value: money(d(balance).times(reportSign(mode, account))), group: type,
      }))
      .sort((a, b) => d(b.value).abs().comparedTo(d(a.value).abs()) || a.label.localeCompare(b.label));
  const revenue = rows("revenue"), expenses = rows("expense"), assets = rows("asset");
  const funding = [...rows("liability"), ...rows("equity")];
  if (!d(full.unclosed).isZero()) funding.push({
    id: "accumulated", label: "Accumulated unclosed profit/loss", value: full.unclosed, group: "accumulated",
  });

  const periods: ChartPeriod[] = [];
  const first = mode === "balance_sheet" ? Math.max(12, monthIndex(end) - 11) : monthIndex(start);
  const last = monthIndex(end);
  // Keep long histories legible and bounded; labels expose any coarser grouping.
  const years = Math.floor(last / 12) - Math.floor(first / 12) + 1;
  const step = last - first < 36 ? 1 : 12 * Math.max(1, Math.ceil(years / 36));
  for (let index = step === 1 ? first : Math.floor(first / 12) * 12; index <= last; index += step) {
    const bucketFrom = monthStart(index), bucketTo = monthEnd(Math.min(index + step - 1, last));
    const clippedFrom = mode === "profit_loss" && start > bucketFrom ? start : bucketFrom;
    const clippedTo = end < bucketTo ? end : bucketTo;
    const result = reports(s, mode === "profit_loss" ? clippedFrom : "", clippedTo);
    const label = step === 1 ? monthLabel(bucketFrom) : step === 12 ? bucketFrom.slice(0, 4)
      : `${bucketFrom.slice(0, 4)}–${clippedTo.slice(0, 4)}`;
    periods.push({ label, from: mode === "profit_loss" ? clippedFrom : "", to: clippedTo, values: result });
  }
  return { full, revenue, expenses, assets, funding, periods, interval: step === 1 ? "month" : step === 12 ? "year" : "year group", end };
}

/** Only normalized display coordinates become JS numbers; money stays decimal text. */
export function chartDomain(values: string[]) {
  let min = d(0), max = d(0);
  for (const value of values) {
    if (d(value).lt(min)) min = d(value);
    if (d(value).gt(max)) max = d(value);
  }
  if (min.eq(max)) max = min.plus(1);
  const span = max.minus(min);
  return { min, max, fraction: (value: string) => d(value).minus(min).div(span).toNumber() };
}
