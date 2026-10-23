# Release Microfin on Vercel

This implementation run delivers a development preview in the separate Vercel project **microfin-dev**, connected only to the development Supabase project. The user approved using Vercel's **Production target label within microfin-dev** to obtain its stable development URL. That target label does not make this the actual production environment.

Actual production provisioning, configuration and deployment are deferred. The existing `.env.local` configuration is development-only. A distinct production Supabase project and deployment must be supplied later. The current acceptance check is the retained development preview and its hosted evidence; the later-production procedure below is a runbook.

1. In the development Supabase project, enable email/password Auth. Configure allowed callbacks and record its email-confirmation/SMTP settings so hosted verification reflects the actual development configuration. Production email delivery and production rate-limit configuration belong to the later setup.
2. Inspect the destination schema for conflicts. With its migration connection available locally to the operator, run `npm run db:migrate`. Use `SUPABASE_CA_CERT_PATH` when its certificate chain needs an explicitly trusted CA. Connection URLs must have encoded passwords. The migration CLI uses verified TLS, a migration lock, a transaction, version checksums and no reset command.
3. In Vercel, link `thepragmaticway/microfin` to **microfin-dev** as a Next.js project. Select Node.js 24. Use `npm ci` and `npm run build`. `.vercelignore` excludes local environment files, workflow state and test artifacts. Deploy the reviewed candidate to the approved target within this development-only project.
4. Add **only** the development `SUPABASE_PROJ_URL` and `SUPABASE_PUB_KEY` to microfin-dev's deployment environment, including its Production target when used for the stable development URL. Do not add the database connection, Auth admin/service-role secret, test JWT secret, or local CA path to the app deployment. The app uses no `NEXT_PUBLIC_` credentials and the supplied key is only the publishable key.
5. Set the development Supabase Auth Site URL to the deployed development origin and allow `<origin>/auth/confirm` and `<origin>/auth/confirm?next=/reset-password`. Limit callbacks to approved development origins. Actual production will have its own configuration and user database.
6. Use Supabase email templates that send confirmation/recovery to the app callback. For confirmation, use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. For password recovery, use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`. The app also supports PKCE `code` callbacks from the SDK redirect flow. A recovery callback permits only the fixed `/reset-password` destination, avoiding arbitrary redirects.
7. Run the configured local gates and complete independent review. Retain the microfin-dev deployment and perform the hosted checks below against its actual development Supabase configuration. Record the result against the reviewed candidate. No actual production deployment is required in this run.

## Current development-preview smoke check

Use disposable test accounts and workspaces; do not enter real payroll/customer information while verifying a release.

- Register against the hosted development Auth service, then sign in and sign out. Verify session renewal and the configured callbacks. If development email confirmation/recovery delivery is enabled, exercise the actual emails; explicitly record settings or delivery limitations in the evidence. Production SMTP verification remains a later-release check.
- Create business and personal workspaces, a THB money account, income/expense categories, owner equity, a SGD receivable and a contact. Create an opening contribution, an expense, and foreign income. Check native and home values, reports, and drill-down.
- Record an earned SGD invoice; collect a quarter of it into a money account. Outstanding native/book amounts must reduce without repeating income. Record the remainder, reverse a payment and check restoration. An invoice with an active payment must reject a recognition reversal.
- With a second user, request the first user's workspace API/RPC and direct table endpoints. Reads must return no foreign data, commands must deny access, and direct writes must fail. Switching between the first user's workspaces must keep records separate.
- Verify light/dark persistence, keyboard access, desktop/mobile layout and a failed-request retry state. Inspect browser bundles/network responses for server-only secrets; only intended user-scoped financial data may be returned.

Record the retained microfin-dev URL, Git revision or reviewed workspace fingerprint, applied migration versions, development Supabase destination, Vercel target label, executed checks and results in the release issue. A successful local build is not evidence of hosted acceptance. Mark this run's Phase 6 development scope complete only when the required hosted financial journeys, ownership denials, themes and secret exclusions have actual evidence. Actual production remains deferred.

## Later actual production setup

Provision a separate production Supabase project and a production Vercel project/environment. Configure production email/password Auth, email confirmation, working SMTP, appropriate rate limits and narrowly allowed production callback URLs. Inspect the new database, apply the immutable versioned migrations with verified TLS, and configure only its project URL and publishable key in the production app environment.

Promote a reviewed candidate, repeat all financial/authorization/theme checks above with isolated sample data, and additionally verify real confirmation and password-recovery email delivery, production callbacks, backups and restore readiness. Record separate production evidence before treating that later release as complete. Do not reuse development credentials or infer production readiness from microfin-dev's Vercel target label.

## Operations and recovery

Use Supabase database backups/PITR where available and test restores in an isolated project. Keep migration files immutable once applied. Prefer forward fixes; restore a backup only through an explicitly approved recovery procedure. Vercel can roll back the app to a compatible deployment, but it does not reverse database migrations.

The app emits neutral request failures with route/status only. Authentication, financial descriptions, amounts, raw database errors, cookies and credentials are not written to application error logs. Review Supabase Auth's audit history for account events and Vercel request metrics for availability. User-facing command validation explains how to correct an entry while avoiding internal SQL details.

This version is manual bookkeeping with historical exchange values. It does not automate country-specific tax filing, financial closing, payroll, depreciation or revaluation. Keep the original financial records according to your business's retention process while document storage is deferred.
