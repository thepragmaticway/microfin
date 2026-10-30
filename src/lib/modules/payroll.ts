import { z } from "zod";
import { currency, date, rate } from "../contracts";
import { amountInput, feeInput } from "../accounting/contracts";
import { buildRecognition } from "../accounting/recognition";
import { buildPayment, transferRate } from "../accounting/settlement";
import { openItems } from "../reports";
import type { Snapshot } from "../types";

const id = z.uuid();
const header = {id, source_id: id, accounting_date: date, description: z.string().trim().min(1).max(500)};
export const payrollAccrualInput = z.object({
  ...header,
  employee_party_id: id,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  reference: z.string().max(100).optional(),
  due_date: date.optional(),
  payable_account_id: id,
  expense_account_id: id,
  amount: amountInput,
  currency_code: currency,
  exchange_rate: rate,
}).strict();
const payrollAllocation = z.object({
  amount: amountInput,
  funding_account_id: id,
  funding_amount: amountInput,
  funding_rate: rate,
  provider_rate: rate.optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  reference: z.string().max(100).optional(),
}).strict();
export const payrollPaymentInput = z.object({
  ...header,
  operation_id: id,
  allocations: z.array(payrollAllocation).min(1).max(50),
  fx_account_id: id.optional(),
  fee: feeInput.optional(),
}).strict();
export type PayrollAccrual = z.infer<typeof payrollAccrualInput>;
export type PayrollPayment = z.infer<typeof payrollPaymentInput>;
export interface PayrollSource {
  id: string;
  employee_party_id: string;
  period: string;
  recognition_obligation_id: string;
}
export function buildPayrollAccrual(s: Snapshot, p: PayrollAccrual) {
  const account = s.accounts.find((a) => a.id === p.payable_account_id);
  if (account?.role !== "payable") throw new Error("Salary recognition requires a payable account");
  const expense = s.accounts.find((a) => a.id === p.expense_account_id);
  if (expense?.currency_code && expense.currency_code !== p.currency_code)
    throw new Error("Salary expense currency must match the salary");
  return buildRecognition(s, {
    id: p.id, accounting_date: p.accounting_date, description: p.description,
    party_id: p.employee_party_id, control_account_id: p.payable_account_id,
    category_account_id: p.expense_account_id, amount: p.amount,
    currency_code: p.currency_code, exchange_rate: p.exchange_rate,
    reference: p.reference, due_date: p.due_date,
  });
}
export function buildPayrollPayment(s: Snapshot, source: PayrollSource, p: PayrollPayment) {
  if (source.id !== p.source_id) throw new Error("Payroll source does not match");
  const item = openItems(s).find((x) => x.obligation.id === source.recognition_obligation_id);
  if (!item || item.transaction.party_id !== source.employee_party_id || item.account.role !== "payable")
    throw new Error("Salary obligation not found");
  const event = buildPayment(s, {
    ...p,
    allocations: p.allocations.map((a) => ({...a, obligation_id: item.obligation.id})),
  });
  const transfers = p.allocations.map((a) => {
    const funding = s.accounts.find((account) => account.id === a.funding_account_id)!;
    return {
      source_currency: funding.currency_code,
      target_currency: item.line.currency_code,
      effective_rate: transferRate(a.funding_amount, a.amount),
      provider_rate: a.provider_rate ?? null,
      provider: a.provider ?? null,
      reference: a.reference ?? null,
    };
  });
  return {event, transfers};
}
