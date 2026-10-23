**Microfin implementation plan — approved**

**Objective and sources.** Build the first usable personal/business finance app from [DATA_MODEL.md](DATA_MODEL.md), using the stack requested in this chat: Next.js, TypeScript, HeroUI with dark/light themes, Supabase database/auth, and Vercel hosting. At proposal time the project contained documentation only, with no app, Git repository, baseline commit, or runnable tests. Roadmap approval and repository initialization were authorized on 23 October 2026.

**Scope.** Keep the nine core entities: users, currencies, workspaces, accounts, parties, transactions, journal_lines, obligations, settlements. Include manual income, expenses, transfers, assets/deposits, owner contributions/withdrawals, opening balances, unpaid invoices/bills, partial payments, reversals, profit and loss, and balance sheet. Documents/uploads/imports/matching, revaluation, payroll workflows, budgets, inventory, tax filing, and bank connections remain outside this version.

**Architecture and technical decisions.**

- Use Next.js App Router and TypeScript. Interactive business requests follow UI → API Route Handler → service → data access layer → Supabase. Route Handlers are HTTP endpoints requiring their own authorization. [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- API handlers validate requests and identity and translate errors; services own action rules and orchestration; the DAL owns Supabase queries/RPC calls. Browser components do not query financial tables. Supabase Auth is the authentication SDK exception. Server-rendered reads may invoke the same authorized services directly; they do not bypass services/DAL.
- Suggested layout: src/app for screens and API routes; src/components for shared UI; src/server/services; src/server/dal; src/lib/contracts and money helpers; supabase/migrations; tests; documentation in doc/.
- Start with compatible stable Next.js/React/HeroUI releases, pin them in the lockfile, and use the matching HeroUI setup. The current HeroUI v3 documentation uses CSS variables/Tailwind v4 and supports Next.js light/dark theming. [HeroUI frameworks](https://heroui.com/en/docs/react/getting-started/frameworks), [HeroUI theming](https://heroui.com/en/docs/react/getting-started/theming)
- Adapt the identity mapping to Supabase: public.users.id references auth.users.id; keep profile display name/creation time, derive identity/email from Auth, and remove the generic auth_subject duplication when implementing the schema.
- Use cookie-based Supabase SSR authentication and verified server identity. Apply owner-scoped RLS/grants on all exposed application tables; currencies are shared read-only reference data. User requests retain the user's JWT context. [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Implement atomic database commands for draft persistence, posting, invoice/bill creation, payment, and reversal. Restrict direct financial-table writes. Privileged functions, where necessary, explicitly check auth.uid()/workspace ownership, restrict execution, and fix search_path; ordinary requests do not rely on an RLS-bypassing service-role key. Services orchestrate these commands; database constraints/functions enforce final integrity even when the API is bypassed. [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- Represent decimal amounts/rates as strings in JSON, use decimal arithmetic, and preserve numeric amounts and rates on posted journal lines. All reports use posted book values.

**Phases and acceptance criteria.** Implement in this dependency order. Each acceptance criterion includes its verification; A0–A6 remain stable identifiers for this plan.

| Phase | Deliverables | Acceptance and verification |
|---|---|---|
| **0 — Foundation and UX shell** | Establish Git/baseline and local toolchain; scaffold Next.js/TypeScript; install compatible HeroUI/theme support; create responsive navigation, workspace-switcher shell, shared form/error/loading states, layer boundaries, env template, and real check scripts. | **A0:** App starts and builds; light/dark preference persists through reload; keyboard navigation works; automated import checks prevent UI access to the DAL and service access to browser-only modules. Verify theme/navigation smoke tests, boundary checks, typecheck, lint, and build. |
| **1 — Supabase, auth, and workspaces** | Versioned migrations for the nine tables, composite workspace FKs and core constraints, RLS/grants, authenticated DB commands, generated database types; email/password registration, confirmation, login/logout/reset, session refresh; personal/business workspace creation and switching. | **A1:** An authenticated user creates two isolated workspaces and sees only their own data. Verify auth/session flows, two-user API/RLS/RPC denial tests, forged workspace links, and direct financial-write denial. Verify migrations reset cleanly in an isolated local DB. |
| **2 — Accounts, currencies, and parties** | Seed THB/MMK/SGD/USD metadata; account creation/deactivation with role/type/currency checks; income/expense category presentation from accounts; simple customer/supplier entry. | **A2:** A user creates foreign-currency money accounts and categories; invalid combinations are rejected; used account classification cannot change. Verify database/service tests and workspace-switch UI isolation. Opening balance posting becomes available in Phase 3. |
| **3 — Transactions and ledger** | Guided receive/spend/transfer/equipment/deposit/owner-money/opening-balance actions; manual exchange rates and dual-currency previews; split postings, drafts, posting, activity/detail/filtering, and full reversal/replacement. | **A3:** Actions produce balanced immutable journal lines; drafts do not affect balances; retries do not duplicate events; partial writes roll back; foreign balances discharge their carried values with explicit realized FX/rounding differences. Verify decimal/rounding cases, API and DB atomicity/idempotency/reversal tests, and T04/T10 fixtures. |
| **4 — Unpaid invoices, bills, and settlement** | Record earned unpaid client invoices and incurred supplier bills; due dates, counterparties, derived outstanding balances; opening unpaid items; partial/full/batch payments using the model's unique clearing/funding pairs. No invoice-document generation. | **A4:** Partial payment reduces the outstanding balance without repeating income/expense; full payment clears native and book amounts. Verify different-currency payment, split bank funding, fees/realized FX, simultaneous overpayment attempts, payment reversal, and blocked recognition reversal with active payments. Control-account totals must match open-item totals. |
| **5 — Reports and first-customer UX** | Home overview, account balances/activity, unpaid overview, profit and loss by period, balance sheet as of date, report-to-entry drill-down; language tailored to personal/business workspaces; responsive and accessible polish in both themes. | **A5:** Reports exclude drafts, respect workspace/timezone/date filters, include reversals correctly, and include unclosed profit/loss in equity once. Verify ledger-to-report reconciliation and browser flows for your company and personal workspace, including loading, empty, and failure states. |
| **6 — Release on Vercel** | Isolated development/test and production configuration, migration/release procedure, auth redirect URLs, safe errors/logging, preview deployment, production deployment, and short operating instructions in doc/. | **A6:** The deployed app completes register → workspace → account → transaction → report, plus invoice → partial payment. Verify preview smoke tests, migrations against an empty isolated DB, cross-workspace denial after deployment, both themes, and absence of server secrets in browser assets. Production completion requires the actual Supabase/Vercel projects and configuration. |

The first usable manual-finance milestone is the end of Phase 3. Unpaid-item tracking and complete report screens follow in Phases 4–5. Each phase includes its necessary checks; testing is not deferred to release.

**Financial verification scope.** Use T01–T07 and T10 from [ACCOUNTING_EXAMPLE.md](ACCOUNTING_EXAMPLE.md) directly. With payroll T08/T09 omitted, derived subset expectations are USD bank 3,800, SGD bank 4,000 / USD 3,000, total cash USD 6,800, revenue USD 3,000, expenses USD 1,700, profit USD 1,300, and assets/equity USD 11,300. Do not assert the full payroll-inclusive example's final totals for that subset. Add clearly labeled hypothetical partial-payment, realized-FX, rounding, concurrency, and reversal scenarios.

**Verification gates and review arrangement.** Current .dev-loop/config.json has no gates; no gates have been run. Proposed scripts, to become configured gates only once their implementation/tooling exists:

| Gate | Proposed command | Timeout |
|---|---|---:|
| Lint and layer boundaries | npm run lint | 120 seconds |
| Type checking | npm run typecheck | 120 seconds |
| Domain/service tests | npm run test:unit | 180 seconds |
| Database constraints, RLS, RPC/concurrency | npm run test:db | 300 seconds |
| API integration | npm run test:api | 300 seconds |
| Production build | npm run build | 300 seconds |
| Browser journeys/themes | npm run test:e2e | 300 seconds |

Database checks use disposable local/test Supabase data, never production. Bootstrap must establish and record real runnable gate commands and a Git baseline before an implementation session can be frozen/dispatched; current empty gates and missing baseline are not passing evidence. Test-integrity paths are proposed as tests/ and supabase/tests/, with no unauthorized weakening.

Execution uses the dev-loop functionality, quality, and security guidelines version 1: one reusable coder, parent-run authoritative gates, and a fresh independent reviewer for each full review round. Initial review limit is four rounds. Repository setup is authorized; no agents, gates, product implementation, or deployments have started.

**Assumptions, risks, and remaining decisions.**

- Proposed defaults: English interface, email/password auth, npm, manual exchange rates, one owner per workspace, and Asia/Bangkok as initial timezone. Users choose each workspace's currency; USD is only the teaching fixture's currency.
- Repository initialization and the initial main-branch push are authorized. Development Supabase project URL, publishable key, and database connection are supplied in ignored .env.local. Package scripts, runnable test gates, deployment configuration, and a baseline must be established/recorded before implementation dispatch.
- Exact compatible dependency versions are selected and pinned during foundation setup; do not mix HeroUI generations.
- Decimal rounding, idempotency, concurrent payments, reversal dependencies, and direct-API/RPC authorization are the main implementation risks and have explicit checks above.
- Reports reflect posted book values; deferred revaluation, payroll, budgets, depreciation automation, closing automation, and country-specific tax/compliance workflows are not implied.
- No unresolved product-scope question prevents this roadmap. Infrastructure readiness and actual baseline/gate configuration remain execution prerequisites. Any material change to this displayed plan requires its replacement before execution.

**Approval.** The roadmap was approved on 23 October 2026. The current authorized setup action is to initialize Git, protect local environment values, connect https://github.com/thepragmaticway/microfin.git, and push the initial main branch. The original approval and proposal are preserved in local dev-loop session state. Runnable baseline gates remain an execution prerequisite.

