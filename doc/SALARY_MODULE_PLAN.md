# Salary module plan

Status: confirmed design, revision 2 (2026-11-07). It regroups the actions of revision 1 (2026-11-02) with the same behaviour, data and contracts. Not yet published or implemented, and no product tests have been run.

| Item | Value |
|---|---|
| Business source | [MIC-16](https://linear.app/thepragmaticway/issue/MIC-16/unify-the-accounting-core-and-support-application-extensions) (updated 2026-11-01T08:25:11Z) |
| Code baseline | `origin/codex/mic-16-accounting-core` at `97c944a192e8c698b5a0c859ab865f7b0bab4af0` (not merged into `main`) |
| Plan report | `.dev-loop/plans/salary-employees-20261102/plan-preview.json` (dev-loop 0.13.1 format), revision 2, SHA-256 `ca5903b6b29e3272dae59157bef43c25650ba9f2494fe27e21070079fbb8fd60`. Confirmed drafts: revision 2 `plan-preview.r2-draft.json` (SHA-256 `03c7b5b06b3b56f6ba796e65307ef58f0bea0c87c7e7a65141ec832a4a7785f4`), revision 1 `plan-preview.r1-draft.json` (SHA-256 `ad9e4b59a0fd1c3f8db1a6324fb1abb30d752aa06a9d54526342eefc5e4d7036`) |
| Excluded source | MIC-17 supplies no requirements, code or tests |

## Outcome

A workspace owner keeps dedicated employee records (not Contacts), creates a month's salaries for all active employees in one step, and records actual salary payments. Salary expense is recorded only when an employee is paid. These payments include partial, split-funded and cross-currency payments. Every write is protected against double submits, retries after a lost response and simultaneous edits.

## Decisions

| Decision | Status |
|---|---|
| Dedicated `employees` records. No Contact/Party is required or created. Minimal profile with no bank, national ID or tax numbers. | Selected by user |
| Expense when paid. No salary payable or obligation. | Selected by user |
| Bulk monthly run with one salary per employee per month. | Selected by user |
| Concurrency through the existing workspace lock, optimistic revisions and idempotent command receipts. | Selected by user |
| One Next.js app and one Supabase database (MIC-16 S1). | Confirmed |
| Payments post as the existing transaction kind `expense` with no party, so `validate_event` and reports are unchanged. | Confirmed |
| The salary expense home value is the carrying value of the funds used. Only rounding residue goes to the FX/rounding account. | Confirmed |
| Ledger-affecting commands reuse `accounting_sources` / `accounting_operations`. Other saves use a new generic `command_receipts` table. | Confirmed |
| Legacy MIC-16 Party-based payroll (`payroll-accruals`, `payroll-payments`, `payroll_items`) is left unchanged and not migrated. | Confirmed |
| Per-record row locks and a separate payroll service/database. | Not chosen |

Out of scope: salary groups/templates, funding routes and remittance providers, paying several employees in one batch, tax/statutory calculations, payslips, attendance/overtime/proration, automatic scheduling, storing bank/ID data and executing bank transfers.

## Requirements

Provisional IDs. MIC-16 IDs are kept where this plan satisfies them.

| ID | Specification |
|---|---|
| SAL-S1 | Dedicated employee records: code, name, status, start/end dates, a dated monthly salary and currency, an optional default payout account and notes. They are independent of Contacts, with no bank or ID numbers. |
| SAL-S2 | Payroll account defaults for salary expense, fees and FX/rounding. Each payment can override them. |
| SAL-S3 | Bulk monthly run: preview each active employee's effective compensation, edit it, then create all salaries atomically. One salary per employee per month. A salary can be adjusted or cancelled only within the limits set by what has been paid. |
| SAL-S4 | Expense when paid: each confirmed payment records salary expense for the amount received. Supports partial, final, split-funded and cross-currency payments. |
| SAL-S5 | Paid amount, remaining amount and status are derived from active linked payments. Overpayment is rejected. A reversal restores the remaining amount and keeps audit links. |
| SAL-S6 | Concurrency: workspace write lock, optimistic revisions, idempotent receipts, rejection of conflicting retries, atomic commits and workspace isolation. |
| SAL-S7 | Payroll page with month/employee/status filters, per-currency totals and history with ledger links. Works on desktop, mobile and keyboard, with recoverable error states. |
| SAL-S8 | Additive migrations only. Ledger validation and reports are unchanged, and legacy MIC-16 payroll is left as it is. |
| MIC16-S4/S5/S6 | Atomic source-linked postings with retry protection; shared multi-currency settlement rules; backward-compatible migrations. |

| ID | Acceptance criterion |
|---|---|
| SAL-A1 | An owner can add, edit and deactivate employees with dated compensation, and no Contact is created or selected. Duplicate codes are rejected. |
| SAL-A2 | Saved defaults are used by the payment form. Missing or invalid configuration is explained. |
| SAL-A3 | A month run creates one salary per active employee atomically. Running the month again creates no duplicates, and inactive employees are excluded. |
| SAL-A4 | Partial and then final payments record expense only for the amounts paid. Overpayment is rejected, and short receipts stay outstanding. |
| SAL-A5 | Split and cross-currency payments keep the actual sent and received amounts, separate fees, carrying values, rounding, and the provider rate apart from the effective rate. |
| SAL-A6 | A reversal restores the remaining amount and keeps audit links. A salary with active payments cannot be cancelled. |
| SAL-A7 | Double submits and retries have one effect, and concurrent payments cannot over-pay. A stale edit gets a conflict and keeps the user's input. Conflicting retries are rejected, failures leave nothing partial, and other workspaces are denied. |
| SAL-A8 | Existing ledger, report and legacy payroll results are unchanged on a populated, upgraded database. |
| SAL-A9 | The Payroll page works on desktop, mobile and keyboard, with empty, loading, validation and error states. |
| MIC16-A3/A4/A5 | Satisfied for the new module through SAL-A7, SAL-A5 and SAL-A8 respectively. MIC16-A2 (accrual) remains covered by the legacy example's existing tests. |

## Architecture

```
Browser (React 19 + HeroUI)          Next.js server (route handlers)          Supabase PostgreSQL
 Payroll page, forms, previews  ->    salary services + pure builders   ->     salary RPCs (security definer)
 shared submit/conflict helper        early receipt lookup, Zod contracts       require_workspace lock, revisions,
 same pure builders for preview       user JWT via @supabase/ssr                receipts, record_accounting_operation
```

| Context | Kind | Owns | Code location (proposed) |
|---|---|---|---|
| Employees | supporting | Employee profile, status, dated compensation | `src/lib/modules/employees.ts`, `src/server/modules/employees.ts` |
| Payroll | core | Salary items, salary payments, remaining salary, payroll account defaults | `src/lib/modules/salary.ts`, `src/server/modules/salary.ts`, `src/components/payroll-*.tsx` |
| Accounting | core | Paid-expense entry builder, posting, reversal (MIC-16 shared services and ledger) | `src/lib/accounting/paid-expense.ts` (new), existing ledger and commands |
| Protected commands | generic | Command identity, receipts, revision checks, conflict mapping | `src/lib/accounting/contracts.ts` (`sameRequest`), `src/server/commands/protected.ts` (new), `src/components/use-protected-submit.ts` (new) |

Dependencies follow `doc/ACCOUNTING_EXTENSIONS.md`: modules → shared accounting → ledger. The paid-expense builder takes neutral inputs (funding lines, expense account, amount, currency, fee) and contains no salary terms. `scripts/check-boundaries.mjs` gains rules so that `src/lib/accounting` cannot import `modules/salary` or `modules/employees`.

Technology is unchanged: Next.js 16.4, React 19.3, HeroUI 3.2, Zod 4.3, decimal.js 10.6, supabase-js 2.118 / @supabase/ssr 0.12, and PostgreSQL with RLS. Read the relevant guide in `node_modules/next/dist/docs/` before writing route code (see `AGENTS.md`).

## Data model (new additive migration after `202610300001`)

All tables have `workspace_id`, RLS read policies using `owns_workspace` and composite `(workspace_id, …)` foreign keys. Ordinary callers get no direct insert/update/delete; writes go only through the RPCs below.

| Table | Key columns | Constraints |
|---|---|---|
| `employees` | `id`, `code`, `name`, `start_date`, `end_date`, `default_payout_account_id`, `notes`, `revision int` | unique `(workspace_id, code)`; `end_date >= start_date`; payout account FK `(workspace_id, account_id)`; delete not granted |
| `employee_compensation` | `employee_id`, `effective_month` (`YYYY-MM`), `amount`, `currency_code` | unique `(workspace_id, employee_id, effective_month)`; `amount > 0`; currency precision; append-only |
| `payroll_settings` | `workspace_id` (PK), `salary_expense_account_id`, `fee_account_id`, `fx_account_id`, `revision int` | FKs to accounts; type checks are repeated in the RPC |
| `salary_items` | `id` (also the accounting source ID), `employee_id`, `salary_month`, `amount`, `currency_code`, `description`, `cancelled_at`, `revision int` | partial unique `(workspace_id, employee_id, salary_month) where cancelled_at is null` |
| `salary_payments` | `id` (payment/operation ID), `salary_item_id`, `received_amount`, `funding jsonb` (account, sent amount), `fee jsonb`, `provider`, `provider_rate`, `reference`, `transaction_id` | FK to `salary_items` and `transactions`; immutable (reuse `guard_accounting_source`) |
| `command_receipts` | `workspace_id`, `command_id`, `command`, `request jsonb`, `result jsonb` | PK `(workspace_id, command_id)`; immutable |

Derived values (never stored):

- `paid = sum(received_amount)` over payments whose transaction is still active (`event_active`).
- `remaining = amount − paid`.
- `status` is `unpaid` when paid = 0, `partly paid` when 0 < paid < amount, and `paid` when paid = amount.

The effective compensation for a month is the row with the greatest `effective_month` that is at or before that month.

## Protected command contract (WF-CONC)

Every salary-module write is a protected command.

**Request envelope** (added to each module input):

| Field | Meaning |
|---|---|
| `command_id` | UUID created when the reviewed form opens. Reused for every retry of that submission and replaced only after the user reviews new data. For payments it is the payment ID; for month runs it is the run command ID. |
| `expected_revision` | Revision(s) of the records the user reviewed. Required on updates and on payments (salary item revision). Not used when creating a new record. |

**Server (`src/server/commands/protected.ts`):**

1. Parse the input with Zod and normalize it with `sourceRequest`, which drops transport-only IDs.
2. Early lookup by `command_id`. If the stored request is the same (`sameRequest`), return the stored result. If it differs, return 409 `conflicting_retry`. If no receipt exists, continue.
3. Build any ledger entry from the authorized snapshot, then call one RPC.

**RPC (each salary RPC follows the same template):**

1. `perform require_workspace(w)`. This locks the workspace row and serializes every write in the workspace, including the existing ledger commands.
2. Repeat the receipt lookup under the lock (step 2 above).
3. Compare `expected_revision` with the current revision and raise `stale` if they differ.
4. Run the rule checks: unique code/month, account eligibility, remaining salary and paid limits.
5. Apply the change, run `revision = revision + 1`, and insert the receipt (`command_receipts`, or `accounting_operations` through `record_accounting_operation`).
6. Return `{ids, revisions, transaction_id?}`. Any exception rolls back the whole transaction.

**Response mapping:**

| Outcome | HTTP | Client behaviour |
|---|---|---|
| Success or identical retry | 200 with receipt | Close the form and refresh affected views |
| `stale` (revision changed) | 409 | Keep the input and show the current values next to the edit. The user re-reviews, and a new `command_id` is issued |
| `conflicting_retry` | 409 | Same as `stale` |
| Rule broken (duplicate code, employee-month exists, overpayment, salary has payments) | 409 or 400 with a safe message | Keep the input and explain the rule |
| Network failure or 5xx | — | Keep the input and `command_id`, and offer **Retry**, which resubmits the identical request |
| Other workspace or not found | 403/404 | Show a generic error; nothing leaks |

The shared helper `useProtectedSubmit` owns `command_id`, the in-flight lock (prevents double clicks), retry and conflict state. Every salary form uses it.

## Workflows

### WF-EMP Manage employees (Employees)

| Action | Interface | Rules |
|---|---|---|
| Add an employee | `POST /api/workspaces/{w}/employees` → `save_employee(w, request)` | Not a Contact. Unique code. Positive salary in a supported currency (THB, SGD, MMK, USD, …). No bank/ID data. |
| Change profile or compensation | same endpoint with `id` and `expected_revision`; compensation changes carry `effective_month` | Earlier months keep their compensation. Existing salary items are unchanged. |
| Deactivate or reactivate | same endpoint with `end_date` (or null) | Not proposed for months after the end date. Existing salaries stay visible and payable. |

### WF-MONTH Prepare monthly salaries (Payroll)

| Action | Interface | Rules |
|---|---|---|
| Create the month's salaries | Preview: `GET /api/workspaces/{w}/salary-months?month=YYYY-MM`. Submit: `POST …/salary-months` → `create_salary_month(w, request)` with 1–200 lines `{employee_id, amount}` | The preview proposes employees active in that month (`start_date ≤ month end` and `end_date` is null or `≥ month start`) at their effective compensation. Employees who already have a salary that month are listed but not proposed. Totals are shown per currency. On submit, all lines are created or none. The partial unique index enforces one salary per employee-month. The currency comes from the employee's effective compensation. No ledger entry. |
| Adjust or cancel a salary | `POST …/salary-items` → `save_salary_item` with `expected_revision` | The amount cannot go below `paid`. A salary can be cancelled only when `paid = 0` with no active payments. |

Two owners running the same month concurrently: the second run waits on the workspace lock, then fails the unique check and gets a 409 that lists the existing salaries.

### WF-PAY Pay salaries (Payroll) and WF-ACCT Post salary payments (Accounting)

WF-PAY has three actions:
- **Save payroll account defaults.**
- **Record a payment:** preview, then submit.
- **Reverse a payment.**

Each payment and reversal is handed to WF-ACCT. There, **Post the payment atomically** builds the entry and commits it, and **Reverse the payment entry** reverses it.

**Payroll account defaults** (`POST /api/workspaces/{w}/payroll-settings` → `save_payroll_settings`): the salary expense and fee accounts must be active `general` expense accounts, and the FX/rounding account an active `general` account. The payment form shows a configuration prompt while the defaults are missing.

**Payment input** (`POST …/salary-payments`):

```json
{
  "command_id": "payment-uuid",
  "salary_item_id": "salary-item-uuid",
  "expected_revision": 3,
  "accounting_date": "2026-11-01",
  "description": "October salary",
  "received_amount": "1000000",
  "funding": [{"account_id": "thb-bank-uuid", "sent_amount": "8000"}],
  "fee": {"account_id": "fee-account-uuid?", "funding_account_id": "thb-bank-uuid", "amount": "100"},
  "expense_account_id": "optional override",
  "fx_account_id": "optional override",
  "provider": "Banking app", "provider_rate": "124.9", "reference": "Transfer confirmation"
}
```

`received_amount` is the amount the employee confirmed receiving, in salary currency. `sent_amount` is in each funding account's currency and excludes the fee. There can be 1–50 funding rows, within MIC-16's limit of 100 lines and 50 settlement pairs per event.

**Paid-expense entry** (`buildPaidExpense`, a pure function used for both the preview and the server):

| Line | Side | Amount | Home value |
|---|---|---|---|
| Each funding account | credit | `sent_amount` | Home-currency account: equal to the amount. Foreign account: its carrying-value share (`rate_source = carrying_value`), using the existing deterministic split order. |
| Salary expense (salary currency) | debit | `received_amount` | Sum of the funding home values. Rate = home value ÷ amount (18 dp), `rate_source = carrying_value`. |
| Fee expense | debit | fee amount | Valued like a funding discharge of the fee's funding account |
| Fee funding account | credit | fee amount | Carrying value as above |
| FX/rounding | either | 0 in salary currency, home residue only | Only if `round(received × rate)` cannot equal the funds' home value exactly |

The entry is posted as kind `expense` with `party_id = null`. No obligation or settlement rows are created. A cross-rate between two non-home currencies never sets the home value: the home value always comes from the funding account's carrying value. The effective rate (`received ÷ sent`) and the provider rate are stored in `salary_payments` and in the operation's `transfer_evidence`; neither affects valuation.

Example (THB home workspace, MMK salary of 2,000,000):

1. Pay 1,000,000 MMK, funded by THB 8,000 from a THB bank account, with a THB 100 fee. Postings: debit salary expense MMK 1,000,000 (THB 8,000), debit fee THB 100, credit bank THB 8,100. Remaining: MMK 1,000,000.
2. Pay the final 1,000,000 MMK, funded by SGD 320 from an SGD wallet carried at THB 26.00/SGD. Postings: credit wallet SGD 320 (THB 8,320 carrying value), debit salary expense MMK 1,000,000 (THB 8,320). Remaining: 0, so the salary is paid.

**Commit** (`save_salary_payment(w, request, p)`):

1. `require_workspace(w)`.
2. `register_accounting_source(w, salary_item_id, 'salary')`.
3. Check for an existing operation `payment:<command_id>` and compare the requests.
4. Check that the salary item belongs to `w`, is not cancelled, and that `expected_revision` matches.
5. Check `received_amount ≤ remaining` under the lock.
6. Check that the posted entry matches the request: accounts, amounts, kind `expense`, and lines limited to the expense, funding, fee and FX accounts.
7. Insert into `salary_payments`.
8. Call `record_accounting_operation`.
9. Return the transaction ID.

**Reverse a payment** (`POST …/salary-payment-reversals` → `reverse_salary_payment`): checks that the payment belongs to the workspace's salary module, then calls the existing `reverse_event` logic in the same transaction. The payment row and operation stay as audit links, and the remaining amount is recomputed through `event_active`. Retrying a reversal returns the existing reversal. A corrected payment is recorded as a new payment with a new `command_id`.

### WF-TRACK Track payroll (Payroll)

| Action | Interface |
|---|---|
| View the Payroll page | New `payroll` navigation view in `finance-app.tsx`. `GET …/salary-items?month&employee&status` returns items with `paid`, `remaining` and `status`. Totals are grouped by currency and never summed across currencies. |
| Inspect salary history | `GET …/salary-items/{id}` returns the item, its payments (funding, fee, provider, effective rate, `transaction_id`, reversal state) and the employee's compensation history. Transaction links reuse `transaction-detail.tsx`. |

The new GET resources need a `GET` handler alongside the existing `[resource]` POST route. Check the current route conventions in `node_modules/next/dist/docs/` first.

## Security

- Every RPC is `security definer` with `search_path=''`, starts with `require_workspace`, and is granted to `authenticated` only. Private helpers keep no public grants.
- Requests use the user's JWT through `verifiedClient()` and never the service-role key.
- Composite workspace foreign keys reject cross-workspace employees, accounts and salary items. Read endpoints return only RLS-visible rows, and errors never reveal other workspaces' IDs.
- No bank, ID or tax data is stored. Notes are free text, capped at 1,000 characters.

## Migration and compatibility

- One new additive migration after `202610300001_accounting_extensions.sql`. It does not alter `transactions`, `journal_lines`, `validate_event`, report functions, `payroll_items` or the legacy payroll RPCs.
- Regenerate `src/lib/database.generated.ts` with `npm run db:types`.
- Update `doc/ACCOUNTING_EXTENSIONS.md` and `doc/DATA_MODEL.md` with the salary module and the protected-command template.
- Before any hosted schema change, take and verify a private backup, following the MIC-16 procedure.

## Planned verification

Layers follow the repository's gates: `lint` (including boundaries), `typecheck`, `test:unit`, `test:db`, `test:api`, `build` and `test:e2e`.

| Workflow / IDs | Behaviour protected | Layers |
|---|---|---|
| WF-EMP — SAL-S1, S6 / SAL-A1, A7 | Employees are never Contacts; duplicate code; effective-compensation lookup; stale edit; deactivation excludes future months | Unit, DB, API, browser |
| WF-PAY defaults — SAL-S2 / SAL-A2 | Account eligibility; per-payment override; missing configuration message | Unit, DB, browser |
| WF-MONTH — SAL-S3 / SAL-A3, A6 | Active-in-month proposal; atomic N-line create; re-run without duplicates; two concurrent runs; adjust/cancel limits | Unit, DB (two connections), API, browser |
| WF-PAY/ACCT — SAL-S4, S5, MIC16-S5 / SAL-A4, A5, A6, MIC16-A4 | Home/foreign/split funding; fee; rounding residue; non-home cross-currency; partial → final; short receipt; overpayment; reversal restores remaining | Unit (builder), DB (`validate_event` accepts unchanged), API, browser |
| WF-CONC — SAL-S6, MIC16-S4 / SAL-A7, MIC16-A3 | Identical retry returns the original; conflicting retry is 409; lost response then retry has one effect; two concurrent payments that would together over-pay; edit vs payment race; injected failure leaves no rows; cross-workspace denied | Unit (decision), DB with separate connections and barriers, API |
| WF-TRACK — SAL-S7 / SAL-A9 | Filters; per-currency totals; derived status; empty/loading/error states; mobile and keyboard | Unit, API, browser |
| Compatibility — SAL-S8, MIC16-S6 / SAL-A8, MIC16-A5 | Existing guided/manual/invoice/bill/legacy payroll/report results on a populated, upgraded database | Existing suites plus an upgrade test on empty and populated databases |

## Delivery slices

Each slice includes its own tests and documentation.

| Task | Outcome | Depends on | Readiness |
|---|---|---|---|
| DLP-SAL-01 | Protected-command foundation (`command_receipts`, RPC template, `useProtectedSubmit`, 409 mapping), Employees add/change/deactivate, Payroll page shell with employee list | MIC-16 baseline | Ready to prepare |
| DLP-SAL-02 | Payroll account defaults; monthly run preview/create/adjust/cancel; salary list with derived status | DLP-SAL-01 | Draft (blocked on 01) |
| DLP-SAL-03 | `buildPaidExpense`, `save_salary_payment`, reversal, payment form and preview, salary history | DLP-SAL-02 | Draft (blocked on 02) |
| DLP-SAL-04 | End-to-end browser journey (employee → month → partial → final → reversal), upgrade regression on a populated database, final documentation | DLP-SAL-03 | Draft (blocked on 03) |

Before implementation, the work must start from `origin/codex/mic-16-accounting-core` (or `main` after MIC-16 is merged). The current `main` lacks the MIC-16 accounting services this plan depends on.

## Risks and open items

- **Throughput:** the workspace lock serializes writes within a workspace. This is acceptable at the current scale. Finer locking would need every writer to share one lock order.
- **External duplicates:** manual entry cannot detect the same bank transfer recorded twice under different command IDs. The provider reference is shown, but uniqueness is not enforced.
- **Activity labels:** salary payments appear as `expense` transactions in the existing activity views. The description and source link identify them; a dedicated label is not in scope.
- No material design decisions remain open.
