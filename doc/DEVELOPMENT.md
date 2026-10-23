# Develop Microfin

Use Node.js 24 LTS, npm, and Docker Desktop (Linux containers). The application uses Next.js App Router, React 19, HeroUI v3 and Tailwind v4. Dependency versions and the complete dependency tree are pinned in package.json/package-lock.json.

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local`. Set `SUPABASE_PROJ_URL` and `SUPABASE_PUB_KEY` to a **development** Supabase project. They stay server-side; the browser uses authenticated same-origin API routes. Do not use a service-role key.
3. Set `SUPABASE_CONNECTION_STRING` to the project's Session pooler connection string for the migration CLI. URL-encode the password. For a private certificate chain, set `SUPABASE_CA_CERT_PATH` to the trusted root certificate file. TLS verification stays enabled.
4. Inspect the target database and run `npm run db:migrate`. The CLI records checksums in a private migration schema and applies pending migrations together in a transaction. It never resets the database. Do not edit an already-applied migration; add another version instead.
5. Configure Supabase Auth's Site URL and allowed redirects, following [RELEASE.md](RELEASE.md). Start `npm run dev`, then visit `http://localhost:3000`.

The initial app profile is created lazily during workspace creation, using the verified Auth user's UUID. `public.users` holds only the UUID, display name, and creation timestamp. Email and password/session state remain in Supabase Auth. Each workspace has one owner and its own currency/timezone.

The UI uses `/api/...` for all financial requests. Route handlers constrain JSON and verify request origin, services validate input and verified Auth identity, and the DAL calls owner-checked PostgreSQL commands with the caller's JWT. RLS also protects direct reads; ordinary callers cannot write financial tables directly. `read_snapshot` returns a single consistent financial snapshot with exact numeric strings. No ordinary application request uses the database connection string.

## Checks

- `npm run lint` checks source and imports between architectural layers.
- `npm run typecheck` checks TypeScript.
- `npm run test:unit` checks decimal rules, guided actions, report reconciliation, and the payroll-excluded accounting fixture.
- `npm run test:db` creates a disposable PostgreSQL container and tests migrations, RLS/grants, command integrity, concurrency and reversals. Auth identity is emulated only at this SQL-specific layer.
- `npm run test:api` creates disposable PostgreSQL, **real GoTrue Auth**, and PostgREST containers, starts the real Next.js app, and exercises registration, public recovery initiation, cookies, API/service/DAL/RPC integration, tenant isolation and input/origin defenses. A temporary SMTP capture sink observes the actual recovery recipient and delivered link, which the test follows through the application's PKCE callback and password reset.
- `npx playwright install chromium` installs the browser once. `npm run test:e2e` creates the same isolated stack and checks business and personal journeys, invoices/partial collection, reports, workspace switching, keyboard/modal behavior, error state, themes, and responsive layout. Four viewport/theme screenshots are written to `test-results/visual/`.
- `npm run build` creates the production bundle.

The database/API/browser harnesses override Auth/API configuration with disposable local services and never connect to the development/production database. Every run owns a uniquely named Docker network and containers, and removes them in cleanup. A forced process termination may need manual removal of **only that run's** `microfin-test-<id>-*` containers/network. Other running Supabase projects must be left alone. Run these gates sequentially because API/browser runs both build Next.js development output. Test Auth automatically confirms signup email; password recovery goes through the public application action and GoTrue's real SMTP delivery to the local capture sink. The sink accepts test messages only into memory and closes after the run. External email-provider delivery and hosted redirect configuration remain separate release checks.

`npm run db:types` regenerates `src/lib/database.generated.ts` from versioned schema declarations, representing database numeric values as wire strings. Application contracts further narrow kinds, currencies and roles. When changing schema, update the migration, regenerate types, and update the relevant behavioral tests.

## First use

Create a business workspace with THB as home currency, then bank accounts for THB/SGD and MMK cash/wallet as needed. Add software-services income, rent/living-cost expense categories, equipment/deposit assets, owner equity, and per-currency customer/supplier unpaid accounts. Add opening balances through an opening-balance entry, rather than editing account balances. Create a separate personal workspace for Thailand/Myanmar spending.

Use Receive/Spend/Move money and the other guided actions. Foreign rates mean **home currency per one native unit**. A transfer allows different source/destination amounts. Split categories when one payment covers several purposes. Foreign asset/liability discharges retain weighted carried book value and put any difference into the explicitly chosen FX/rounding category. Drafts do not affect reports. Recorded entries are immutable; reverse an error, then record a separate replacement. Reverse dependent payments before reversing an invoice/bill.

Documents/imports/matching, bank connections, revaluation, payroll workflows, budgets and tax filing are deferred. Reports use historical book values, without depreciation or automated closing. The original accounting example's payroll entries are educational; implemented fixture assertions use T01–T07 and T10 only.
