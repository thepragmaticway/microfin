import { z } from "zod";
import { date } from "./contracts";
export const signedBalance = z.string().regex(/^-?(?:0|[1-9]\d{0,19})(?:\.\d{1,8})?$/, "Use a signed decimal balance with up to 8 decimal places");
const openingBalance = z.object({
  account_id: z.union([z.uuid(), z.literal("accumulated")]),
  book_balance: signedBalance,
  native_balance: signedBalance.nullable(),
}).strict();
export const scenarioInput = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(100),
  start_date: date, end_date: date,
  opening_mode: z.enum(["actual", "custom"]),
  opening_balances: z.array(openingBalance).max(2000),
  selected_transaction_ids: z.array(z.uuid()).max(2000),
}).strict().superRefine((value, ctx) => {
  if (value.start_date > value.end_date) ctx.addIssue({ code: "custom", message: "Start date must be on or before end date" });
  if (new Set(value.selected_transaction_ids).size !== value.selected_transaction_ids.length ||
    new Set(value.opening_balances.map((b) => b.account_id)).size !== value.opening_balances.length)
    ctx.addIssue({ code: "custom", message: "Accounts and replay entries must be unique" });
  if (value.opening_mode === "actual" && value.opening_balances.length)
    ctx.addIssue({ code: "custom", message: "Actual opening balances are copied from the source" });
});
export type ScenarioConfig = z.infer<typeof scenarioInput>;
export type OpeningBalance = ScenarioConfig["opening_balances"][number];
