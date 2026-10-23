import { z } from "zod";
const id = z.uuid();
const name = z.string().trim().min(1).max(100);
export const decimal = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,19})(?:\.\d{1,8})?$/,
    "Enter a positive decimal amount (up to 8 decimals)",
  );
export const rate = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/,
    "Enter a positive exchange rate",
  )
  .refine((v) => !/^0(?:\.0+)?$/.test(v));
export const currency = z.enum(["THB", "SGD", "MMK", "USD"]);
export const workspaceInput = z
  .object({
    id,
    name,
    kind: z.enum(["personal", "business"]),
    functional_currency_code: currency,
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid timezone"),
    display_name: name.optional(),
  })
  .strict();
export const accountInput = z
  .object({
    id,
    name,
    type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
    role: z.enum([
      "general",
      "bank",
      "cash",
      "wallet",
      "credit_card",
      "receivable",
      "payable",
    ]),
    currency_code: currency.nullable(),
    is_active: z.boolean(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.role !== "general" && !a.currency_code)
      ctx.addIssue({
        code: "custom",
        message: "Money and unpaid accounts need a currency",
      });
    if (
      ["bank", "cash", "wallet", "receivable"].includes(a.role) &&
      a.type !== "asset"
    )
      ctx.addIssue({
        code: "custom",
        message: "This account must be an asset",
      });
    if (["credit_card", "payable"].includes(a.role) && a.type !== "liability")
      ctx.addIssue({
        code: "custom",
        message: "This account must be a liability",
      });
  });
export const partyInput = z.object({ id, name }).strict();
export const date = z.iso.date();
export const lineInput = z
  .object({
    id,
    account_id: id,
    side: z.enum(["debit", "credit"]),
    amount: decimal.refine(
      (v) => !/^0(?:\.0+)?$/.test(v),
      "Amount must be greater than zero",
    ),
    currency_code: currency,
    exchange_rate: rate,
    book_amount: decimal,
    rate_source: z.enum(["manual", "bank", "carrying_value"]).nullable(),
  })
  .strict();
export const eventInput = z
  .object({
    id,
    accounting_date: date,
    kind: z.enum([
      "income",
      "expense",
      "transfer",
      "contribution",
      "withdrawal",
      "asset_purchase",
      "deposit",
      "invoice",
      "bill",
      "payment",
      "opening_balance",
      "adjustment",
    ]),
    description: z.string().trim().min(1).max(500),
    party_id: id.nullable(),
    lines: z.array(lineInput).max(100),
    obligation: z
      .object({
        id,
        recognition_line_id: id,
        reference: z.string().max(100).nullable(),
        due_date: date.nullable(),
      })
      .strict()
      .nullable(),
    settlements: z
      .array(
        z
          .object({
            id,
            obligation_id: id,
            clearing_line_id: id,
            funding_line_id: id,
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export const saveEventInput = z
  .object({ event: eventInput, post: z.boolean() })
  .strict();
export const reversalInput = z
  .object({ original: id, reversal: id, on_date: date })
  .strict();
export const queryInput = z.object({ workspace: id });
