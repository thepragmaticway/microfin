import "server-only";
import { verifiedClient } from "../auth";
import * as dal from "../dal/finance";
import { queryInput } from "@/lib/contracts";
import { sourceRequest } from "@/lib/accounting/contracts";
import { payrollAccrualInput, payrollPaymentInput, buildPayrollAccrual, buildPayrollPayment } from "@/lib/modules/payroll";
import { priorOperation, prepareEvent, commitOperation } from "../accounting/commands";
import { AppError } from "../errors";

export async function accrueSalary(workspace: string, input: unknown) {
  const {workspace: w} = queryInput.parse({workspace});
  const p = payrollAccrualInput.parse(input);
  const {client} = await verifiedClient();
  const snapshot = await dal.snapshot(client, w);
  const request = sourceRequest(p);
  const prior = await priorOperation(client, w, p.source_id, "recognition", request, "payroll");
  if (prior) return prior;
  const event = prepareEvent(() => buildPayrollAccrual(snapshot, p));
  return commitOperation(client, "save_payroll_accrual", {w, request, p: event});
}
export async function paySalary(workspace: string, input: unknown) {
  const {workspace: w} = queryInput.parse({workspace});
  const p = payrollPaymentInput.parse(input);
  const {client} = await verifiedClient();
  const snapshot = await dal.snapshot(client, w);
  const request = sourceRequest(p);
  const operation = "payment:" + p.operation_id;
  const prior = await priorOperation(client, w, p.source_id, operation, request, "payroll");
  if (prior) return prior;
  const source = await dal.payrollSource(client, w, p.source_id);
  const recognition = await dal.accountingOperation(client, w, p.source_id, "recognition");
  if (!source || !recognition?.obligation_id) throw new AppError("Payroll source not found", 404);
  const event = prepareEvent(() => {
    const prepared = buildPayrollPayment(snapshot, {...source, recognition_obligation_id: recognition.obligation_id!}, p);
    return prepared.event;
  });
  return commitOperation(client, "save_payroll_payment", {w, request, p: event});
}
