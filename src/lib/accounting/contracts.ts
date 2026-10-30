import { z } from "zod";
import { currency, date, decimal, rate } from "../contracts";
import { d, money } from "../money";

export const amountInput = decimal
  .refine((value) => d(value).gt(0) && d(value).decimalPlaces() <= 2, "Use a positive amount with at most two decimal places")
  .transform((value) => money(value));
const id = z.uuid();
const description = z.string().trim().min(1).max(500);
export const feeInput = z.object({
  account_id: id,
  funding_account_id: id,
  amount: amountInput,
  rate,
}).strict();
export const allocationInput = z.object({
  obligation_id: id,
  amount: amountInput,
  funding_account_id: id,
  funding_amount: amountInput,
  funding_rate: rate,
}).strict();
export const paymentInput = z.object({
  id,
  accounting_date: date,
  description,
  allocations: z.array(allocationInput).min(1).max(50),
  fx_account_id: id.optional(),
  fee: feeInput.optional(),
}).strict();
const guidedInput = z.object({
  id,
  kind: z.enum(["income", "expense", "transfer", "contribution", "withdrawal", "asset_purchase", "deposit", "invoice", "bill", "opening_balance"]),
  accounting_date: date,
  description,
  party_id: id.nullable(),
  source_id: id,
  destination_id: z.union([id, z.literal("")]),
  amount: amountInput,
  currency,
  rate,
  destination_amount: amountInput.optional(),
  destination_rate: rate.optional(),
  fx_account_id: id.optional(),
  reference: z.string().max(100).optional(),
  due_date: date.optional(),
  splits: z.array(z.object({account_id: id, amount: amountInput}).strict()).max(99),
}).strict();
const manualInput = z.object({
  id,
  accounting_date: date,
  description,
  party_id: id.nullable(),
  lines: z.array(z.object({
    id, account_id: id, side: z.enum(["debit", "credit"]),
    amount: amountInput, currency_code: currency, exchange_rate: rate,
  }).strict()).min(2).max(100),
}).strict();
export const accountingCommandInput = z.discriminatedUnion("type", [
  z.object({type: z.literal("guided"), input: guidedInput, source_id: id.optional(), post: z.boolean()}).strict(),
  z.object({type: z.literal("manual"), input: manualInput, source_id: id.optional(), post: z.boolean()}).strict(),
  z.object({type: z.literal("payment"), input: paymentInput, source_id: id.optional(), post: z.literal(true)}).strict(),
]);
export type AccountingCommand = z.infer<typeof accountingCommandInput>;

/** Transaction IDs are transport identities; source operations identify business effects. */
export function sourceRequest(input: Record<string, unknown>): Record<string, unknown> {
  const {id: _id, ...request} = input;
  void _id;
  return JSON.parse(JSON.stringify(request));
}
export function sameRequest(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
