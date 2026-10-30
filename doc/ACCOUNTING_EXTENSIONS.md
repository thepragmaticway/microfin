# Accounting core and application extensions

Microfin is one application and one Supabase/PostgreSQL database. Applications share accounting commands rather than maintaining their own copies of account balances.

| Layer | Code | Owns |
|---|---|---|
| Application adapters | src/lib/modules/, src/server/modules/, built-in guided/manual forms | Business terminology, source records, domain validation and orchestration |
| Shared accounting services | src/lib/accounting/recognition.ts, settlement.ts, contracts.ts; src/server/accounting/commands.ts | Obligation recognition, partial/split settlement, command validation, retry lookup and posting orchestration |
| Ledger core | src/lib/accounting/ledger.ts, money.ts, reports.ts; database posting/validation/reversal functions | Balanced journal entries, account and currency integrity, carrying values, immutable history and financial reports |

Dependencies go from application adapters to shared accounting services to the ledger. Pure calculations are usable for browser previews; the server rebuilds intent against an authorized snapshot, and PostgreSQL enforces final financial invariants under a workspace lock. The import-boundary check rejects dependencies from shared accounting into application modules.

## Existing operations

The forms submit typed intent to POST /api/workspaces/{workspace}/commands:

- Guided entry: { type: "guided", input: GuidedInput, post: boolean }.
- Manual journal: { type: "manual", input: ManualInput, post: boolean }.
- Obligation payment: { type: "payment", input: PaymentInput, post: true }.

The existing ledger budget remains 100 journal lines and 50 settlement pairs per transaction. Built-in commands accept up to 50 payment allocations or 99 category splits when the resulting event fits that budget. Fee pairs and FX lines count only when actually generated; unused fee/FX space is not reserved. The payroll adapter uses the same actual-event budget.

An optional top-level source_id provides a stable business identity independently of input.id (the requested transaction ID). Without it, the built-in form's stable input.id is the source identity. Posted commands create an immutable source/operation record; drafts remain editable and do not create accounting effects or immutable operation records.

Invoice and bill adapters use the shared recognition builder, retaining their existing transaction kinds for compatibility. Payroll uses the neutral recognition kind. Receivable/payable direction, one obligation per recognition, amount/currency precision, historical valuation and dependency-safe reversals are accounting rules, not payroll rules.

The legacy events and reversals APIs and save_event/reverse_event RPC signatures remain available. Legacy raw events retain the database's existing validation and financial semantics; they do not manufacture module provenance. Posted history is never renamed, rewritten or retrospectively assigned a module source. Financial reports still read only accounts and posted journal lines.

## Source and transaction boundary

- accounting_sources owns a workspace-scoped module identity.
- accounting_operations links one source/operation to its posted transaction and optional recognized obligation. It preserves the original normalized request and transfer evidence.
- payroll_items is a separate application table containing the example employee Party and salary period. Salary balances and payment states are not stored there.

The unique key is (workspace_id, source_id, operation). Requests omit only the transport transaction ID before comparison. Amounts are normalized by the typed API; object key order is immaterial, while allocation order and business fields remain part of the request. An identical retry returns the original transaction even if a fresh transaction ID is supplied, or the salary is now fully paid. A conflicting retry fails. A reversal preserves the original source operation; retrying it does not recreate the reversed effect. Use a new source/operation for an explicitly corrected replacement.

A single module RPC performs source registration, domain-record insertion, generic posting, operation linking and commit. The generic posting primitive calls the same save_event command used by the legacy APIs. The authenticated bookkeeping wrapper also matches guided/manual/payment headers, native amounts, accounts, applicable rates, obligation allocations and fee/FX structure to the source intent before recording an effect; a balanced event alone is insufficient. A validation, FK or uniqueness failure rolls back the whole transaction. The server's early retry lookup avoids rebuilding an already-posted request against changed balances; the RPC repeats the comparison under the workspace lock to protect concurrent requests.

All source/domain tables use RLS and composite workspace FKs and deny direct writes to ordinary callers. Private registration/operation helpers have no public/anon/authenticated execution grant. Module wrappers verify the caller through require_workspace; application requests retain their JWT and never use the service-role key.

## Backend payroll example

This is a small backend extension, not employee onboarding, a payroll-run UI, a tax calculator or a bank integration.

POST /api/workspaces/{workspace}/payroll-accruals accepts:

~~~json
{
  "id": "a-transaction-uuid",
  "source_id": "a-stable-payroll-item-uuid",
  "employee_party_id": "an-existing-party-uuid",
  "period": "2026-10",
  "accounting_date": "2026-10-31",
  "description": "October salary",
  "payable_account_id": "a-MMK-payable-account-uuid",
  "expense_account_id": "a-general-salary-expense-account-uuid",
  "amount": "2000000",
  "currency_code": "MMK",
  "exchange_rate": "0.01"
}
~~~

The UUID labels above must be replaced with real UUIDs from the same workspace. The example rate is fictional: in a THB workspace it recognizes MMK 2,000,000 as THB 20,000 of salary expense and payable. Optional reference and due_date are supported. The source is supplied explicitly; the adapter does not schedule monthly payroll or infer salaries.

POST /api/workspaces/{workspace}/payroll-payments accepts:

~~~json
{
  "id": "a-payment-transaction-uuid",
  "source_id": "the-same-payroll-item-uuid",
  "operation_id": "a-stable-transfer-operation-uuid",
  "accounting_date": "2026-11-01",
  "description": "Salary transfer",
  "allocations": [
    {
      "amount": "1000000",
      "funding_account_id": "a-THB-bank-or-wallet-account-uuid",
      "funding_amount": "8000",
      "funding_rate": "1",
      "provider": "Banking app",
      "provider_rate": "124.9",
      "reference": "Transfer confirmation"
    }
  ],
  "fx_account_id": "a-general-FX-category-uuid",
  "fee": {
    "account_id": "a-general-fee-expense-account-uuid",
    "funding_account_id": "a-THB-bank-account-uuid",
    "amount": "100",
    "rate": "1"
  }
}
~~~

amount is the confirmed employee receipt in salary currency; funding_amount is the amount converted in the source account's currency, excluding the optional separately disclosed fee. The example clears MMK 1,000,000 and retains MMK 1,000,000 outstanding, with THB 8,100 total source debit. The actual effective rate is 125 MMK per THB; the provider's optional displayed rate is separate evidence. A spread embedded in the provider rate does not create an invented fee.

Multiple allocations can fund one salary from different money accounts. Payment commands resolve the obligation from the payroll source; callers cannot replace it with another employee's obligation. Payment amounts must not exceed outstanding salary. A short receipt leaves salary unpaid, including when the provider deducted fees before the employee received funds. Submitting a payment records a completed transfer: do not submit a quotation or pending transfer as paid.

Home-book rates and provider transfer rates are different:
- The salary clears its original carrying value proportionally, including the final rounding remainder.
- A foreign funding account discharges its historical carrying value.
- Explicit fees and realized FX/rounding differences use separate postings.
- funding_rate and fee.rate are home-currency valuation inputs where applicable; they are not target-per-source provider quotes. Home-currency lines use one; foreign balance discharges use carried values.
- When neither transfer currency is the home currency, their cross-rate alone cannot determine the home-book values.

Use the existing reversal endpoint for corrections. Reverse dependent payments before salary recognition; source records remain an immutable audit link. The real API integration test is a runnable example with local Auth, Next.js, PostgREST and PostgreSQL. With Node 24, installed dependencies and Docker Linux containers ready, run `node --test tests/api/accounting-extensions.test.mjs` from the repository root. It uses only disposable local data.

## Adding another application module

1. Define a strict input contract and pure adapter using shared recognition/settlement functions. Keep its domain fields in its own module.
2. Add a workspace-scoped domain table and a small authenticated RPC wrapper in a new migration. Inside that single transaction, validate the domain request, register the source, compare any prior operation, insert the domain record if needed, and invoke the private record_accounting_operation primitive. Validate that the posted event matches the module input; never trust caller-supplied source metadata as a substitute for that check.
3. Keep the shared ledger validator focused on financial invariants. New business domains should normally reuse recognition/payment rather than adding module names to ledger rules.
4. Add API/service orchestration through the common command boundary. Reuse priorOperation before rebuilding an operation, and let the RPC repeat retry/concurrency checks.
5. Add isolated rule tests plus actual transaction, authorization and migration integration tests. Reports should require no module-specific branches.

Apply migrations to disposable test databases first. Before a later hosted rollout, take and verify a private schema/data/role/migration-history backup. Database dumps include Storage metadata, not external object bytes, and role passwords/encryption root keys have separate recovery requirements. This task's pre-change backup was performed by the orchestrator; implementation tests do not access hosted credentials or migrate hosted databases.
