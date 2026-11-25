# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Secure multi-user asset management web app with AI-powered expense tracking. Node.js/Express backend serving vanilla JavaScript frontend directly (no build step). PostgreSQL database with field-level AES-256-CBC encryption and Postgres-backed session storage. Supports English and Portuguese (i18n).

## Commands

```bash
# Install dependencies (Node.js 18.18+, 20.9+, or 22+ required by connect-pg-simple)
npm install

# Apply the database schema (no migration framework; DDL is idempotent via IF NOT EXISTS)
psql -U asset_app -d asset_management -f db/schema.sql

# Run dev server (port 3000 by default; override with PORT env var).
# NODE_ENV=development is needed over plain http://localhost: otherwise the
# session cookie is Secure-only, so the session (and its CSRF token) never sticks.
NODE_ENV=development npm start

# Legacy helpers: `start:prod` is just `sudo node server.js`, and `ssl` writes
# self-signed certs to ssl/ that server.js never reads (see TLS note below)
npm run start:prod
npm run ssl

# Generate bcrypt password hash for admin setup (note the `--`)
npm run hash-password -- <password>

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**No test framework, linter, or build step exists.** Frontend JS is served directly to the browser. Use `node --check server.js` for a quick syntax sanity check.

## Environment Setup

Copy `.env.example` to `.env`. Required variables:
- `ENCRYPTION_KEY` — 64-char hex (32 bytes), validated on startup
- `SESSION_SECRET` — min 32 chars, validated on startup
- `ADMIN_PASSWORD_HASH` — bcrypt hash for admin user
- `PGUSER`, `PGPASSWORD` — validated in `db/pool.js` (`PGHOST` / `PGPORT` / `PGDATABASE` default to `localhost` / `5432` / `asset_management`)

`config.js` validates required secrets and fails fast on startup if missing. dotenv never overrides variables already present in the environment — production sets them as systemd `Environment=` lines and has no `.env` file.

Everything else is optional and self-disables when unset: SMTP (all five `SMTP_*` vars are needed for self-service password reset), PayPal (`PAYPAL_*`, `INVITE_CODE_PRICE`), Umami (`UMAMI_WEBSITE_ID`), and the global AI fallback credentials. On boot the server makes one live verification call per configured global AI credential.

## Architecture

### Backend (single-file server)

**`server.js`** (~6,550 lines) — monolithic Express app containing all route handlers, middleware, AI integration, and business logic. ~65 API endpoints are defined here. Middleware order matters: helmet/CSP → `express.json` → sensitive-path blocklist → pre-rendered HTML routes → `/js` + `/css` static → session → CSRF check → `generalLimiter` → routes → global error handler.

- **TLS**: the app listens on plain HTTP (`app.listen`) and expects a TLS-terminating reverse proxy in front (`trust proxy` is 1; production is the `asset-management` systemd unit behind Nginx). Nothing in `server.js` reads `ssl/` or `SSL_*_PATH`.
- **Process-local state**: login lockouts, password-reset codes, pending 2FA logins, pending AI edit/delete/create proposals (5-min TTL), undo snapshots, the web-search daily cap, and the user / model-list / Copilot-session caches are all in-memory `Map`s — lost on restart and only correct with a single server process. Only sessions are persisted (Postgres).

**`config.js`** — centralized env var loading with startup validation. Exports a single config object.

**`db/`** — database layer:
- `pool.js` — pg connection pool (max 10 connections), exports `{ pool, testConnection }`
- `queries.js` — all parameterized SQL query functions (~1,450 lines)
- `schema.sql` — PostgreSQL schema (tables: `users`, `entries`, `user_categories`, `user_budgets`, `invite_codes`, `paypal_orders`, `session`)

### Frontend (no framework, no build)

All frontend code is vanilla JavaScript loaded directly by the browser:
- `css/theme.css` — the single source of design tokens (Paper light / Graphite dark palettes, theme-invariant `--chrome-*` shell tokens, typography stacks, legacy `--color-*` aliases, `:focus-visible` + `prefers-reduced-motion` floor), linked by all four HTML pages before their inline component CSS
- `index.html` (~3,400 lines) — main dashboard with inline component CSS, graphite sidebar/topbar shell, hero KPI row with sparklines, 3 chart panels + a budget status panel, Reports + Budgets modals
- `js/app.js` (~5,700 lines) — dashboard logic, charts (Chart.js), CRUD, admin panel, categories, Reports/Budgets modals + dashboard budget panel (`refreshBudgetPanel`), theme + typography presets, mobile sidebar drawer with focus management + scroll lock, loading-state helpers (`setViewLoading` / `setHeroLoading` / `setChartsLoading` / `setEntriesLoading` / `setSingleChartLoading` / `setButtonLoading`)
- `js/chat.js` (~800 lines) — AI financial advisor floating chat widget
- `js/i18n.js` (~1,350 lines) — English + Portuguese translations (~560 keys per language, kept in parity) and `t(key, replacements)` helper
- `js/csrf.js` — `csrfFetch()` wrapper that attaches the `x-csrf-token` header to non-GET requests
- `js/login.js`, `js/register.js`, `js/forgot-password.js` — page-specific modules

Each page loads `i18n.js` → `csrf.js` → its page script(s) as classic `<script>` tags sharing globals (no ES modules). Chart.js + the annotation plugin come from jsDelivr and fonts from Google Fonts; any new external origin must also be added to the helmet CSP in `server.js`.

### API Structure

Routes are organized in `server.js` by domain:
- `/api/login`, `/api/login/verify-2fa`, `/api/register`, `/api/logout`, `/api/forgot-password`, `/api/reset-password`, `/api/csrf-token` — auth
- `/api/entries` — CRUD for income/expense entries, plus `/api/entries/check-duplicates` for the bulk-upload preview
- `/api/categories` — per-user category management (cap 100 per user); updates are `PATCH /api/categories/:slug`
- `/api/budgets` — per-user monthly budget targets (cap by category count); special slug `_overall` for the no-category overall budget (issue #93)
- `/api/reports/export` — CSV / PDF export of filtered entries, per-user rate-limited (issue #92)
- `/api/user/*` — user settings (email, API keys, 2FA)
- `/api/ai/*`, `/api/process-pdf` — AI chat, PDF expense extraction, model listing
- `/api/admin/*` — user management, couple linking, invite codes
- `/api/paypal/*` — payment integration (invite-code purchases)

### AI Integration

Four credential types supported (per-user, encrypted, with global env var fallback):
- **Anthropic** — `ANTHROPIC_API_KEY` or Claude Code OAuth token (`sk-ant-oat01-…`)
- **Google Gemini** — `GEMINI_API_KEY`
- **OpenAI** — `OPENAI_API_KEY`
- **GitHub Copilot** — OAuth token (`gho_/ghu_/ghp_/github_pat_…`) routed through Copilot's OpenAI-compatible endpoint to access OpenAI/Anthropic/Google models on Copilot subscription credits

AI features include PDF expense extraction (uses the user's category list) and a financial advisor chat with 10 server-side tools (`getFinancialSummary`, `getCategoryBreakdown`, `getMonthlyTrends`, `getTopExpenses`, `comparePeriods`, `searchEntries`, `editEntry`, `undoLastEdit`, `deleteEntry`, `createEntry`) plus optional Anthropic-native `web_search`. `editEntry`, `deleteEntry`, and `createEntry` are two-phase: each returns a pending proposal that the UI surfaces as a Confirm/Cancel card, and the user finalizes via the matching `/api/ai/confirm-{edit,delete,create}` / `/api/ai/cancel-{edit,delete,create}` endpoint. Edits and deletes are keyed by `entryId`; creates carry a server-generated `proposalId` since the row doesn't exist yet.

Provider plumbing worth knowing before touching the chat/PDF code:
- Chat tools are declared twice: `chatToolDeclarations` (Gemini, `Type.*` schema) and `openaiToolDeclarations` (JSON Schema; used for OpenAI + Copilot and mapped into `anthropicToolDeclarations`). Adding or changing a tool means updating both, plus `executeTool()` and `summarizeToolResult()`.
- Anthropic credentials resolve per-user OAuth → per-user API key → env OAuth → env API key (`resolveAnthropicAuth`). OAuth calls need the `anthropic-beta: oauth-2025-04-20` header and a Claude Code identity block as the first system block (`createAnthropicClient` / `buildAnthropicSystemPrompt`); never send that header with an API key.
- Default models are the `*_MODEL` / `*_CHAT_MODEL` constants near the top of `server.js`; a user's saved `ai_model` wins only when it matches the active provider (`resolveModel`).

### Operational Scripts (repo root)

- `rotate-encryption-key.js` (run via `sudo bash rotate-key.sh` on the systemd host) — decrypts every encrypted field (`email`, the five AI credential columns, `totp_secret`) with the current `ENCRYPTION_KEY` and re-encrypts with a freshly generated one, in a transaction. Any new encrypted column must be added to this script too.
- `backup.sh` — dumps PostgreSQL + `.env` to Cloudflare R2 via rclone
- `deploy.sh` — first-time setup helper (dirs, npm install, SSL certs)

### CI

`.github/workflows/claude-review.yml` runs a Claude review on every PR (opened/synchronize) and on `@claude` comment mentions. Review standards live in `.github/CODE_REVIEW.md`, which defers to this file for project conventions. Dependabot PRs are skipped.

`.github/workflows/release.yml` creates the git tag + GitHub Release. It fires on a push to `main` that touches `.github/release-request.json` (`tag`, `title`, `target`, and `notes` → path of `.github/releases/vX.Y.Z.md`) and no-ops if that tag is already released; `workflow_dispatch` is the manual alternative. Tags are not pushed directly — committing the request file is the release action.

### Security Model

- Passwords: bcryptjs (10 rounds)
- Sessions: `express-session` with `connect-pg-simple` Postgres store (since v2.6.6); HTTP-only `SameSite=Lax` cookies, `Secure` unless `NODE_ENV=development`, 24h `maxAge`, expired rows pruned every 15 min
- Field encryption: AES-256-CBC for emails, API keys, OAuth tokens, TOTP secrets
- CSRF: per-session tokens validated on every non-GET/HEAD/OPTIONS `/api/*` request (except PayPal callbacks) — see `server.js` global middleware
- Rate limiting: per-endpoint (login 10/15min, chat 30/15min, PDF upload 20/h, report export 10/15min, plus register/forgot/totp/paypal/aiModels limiters). `generalLimiter` (100/15min on `/api/`) is skipped for authenticated sessions; the authenticated limiters key on the session user id, falling back to IP
- SQL: all queries parameterized via `db/queries.js`
- 2FA: TOTP with bcrypt-hashed backup codes
- Static asset exposure narrowed to `/js` and `/css` only (no `express.static(__dirname)`)

## Key Patterns

- All database queries go through `db/queries.js` — never write raw SQL in `server.js`
- Route handlers are wrapped in `asyncHandler(...)` so rejections reach the global error handler (generic 500, no stack trace); guards are stacked as `requireAuth` → `requireAdmin` / limiter → handler
- Encryption/decryption helpers are defined in `server.js`: `encryptString(value)` returns `{ iv, encryptedData }` and `decryptString(encryptedData, iv)` reverses it. The object is stored as JSON text in the column (`json: true` entries in `USER_COLUMN_MAP`, `db/queries.js`)
- **Schema changes**: there are no migrations, so `db/schema.sql` must stay re-runnable — add the column to the `CREATE TABLE` *and* as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in the "idempotent column additions" block. A new `users` column also needs `dbRowToUser` + `USER_COLUMN_MAP` in `db/queries.js`, and `rotate-encryption-key.js` if it is encrypted
- The admin user is auto-created on startup from `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` env vars
- Rate limiters are defined together in `server.js` right after the CSRF middleware (`logoutLimiter` and `editActionLimiter` sit next to their routes)
- Frontend uses a global `t(key, replacements)` function from `i18n.js` for all user-facing strings; it falls back to English, then to the key itself. Add every new key to both the `en` and `pt` blocks. Static markup is translated via `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` / `data-i18n-aria-label` attributes; the language lives in `localStorage` under `app-lang` and switching reloads the page
- Frontend state-changing requests go through `csrfFetch()` (`js/csrf.js`); a plain `fetch` POST/PUT/PATCH/DELETE is rejected with 403. The only CSRF-exempt routes are `/api/paypal/create-order` and `/api/paypal/capture-order/*`
- A new HTML page must be registered in the `htmlPages` map in `server.js` (only `/js` and `/css` are static), and it needs the inline theme bootstrap script like the other four
- `.gitignore` ignores every `*.json` except `package.json`, `package-lock.json`, and `.github/release-request.json` — a new tracked JSON file needs its own `!` exception
- **Per-user categories**: `user_categories` table; `getCategoriesForUserSelfHeal()` seeds the 17 `DEFAULT_CATEGORIES` slugs on first read; cap of 100/user enforced via `pg_advisory_xact_lock(userId)`; default labels are rendered via i18n keys `cat.<slug>` (not the DB label)
- **Per-user budgets** (v3.0): `user_budgets` table; `category_slug = NULL` is the user's "overall" budget; unique index uses `(user_id, (COALESCE(category_slug, '')), period)` (parens required for the COALESCE expression in both the index and the upsert's `ON CONFLICT`); `GET /api/budgets` reuses `getCategoriesForUserSelfHeal` so first-touch users see the default rows
- **Couple entries**: when both partners are linked, entries flagged `is_couple_expense` are visible to both; `ensurePartnerCategories()` auto-imports partner-category slugs into the active user's catalog
- **Auth middleware** caches `req.user` for 5s in `userCache`. Invalidation is done by wrappers that `server.js` monkey-patches onto `db.updateUser` / `db.deleteUser` / `db.linkCouple` / `db.unlinkCouple` — a new user-mutating query in `db/queries.js` is not covered automatically; call `invalidateCachedUser(id)` after it in `server.js`
- **Localized currency in the UI**: hero / Budgets money formatting goes through `Intl.NumberFormat` keyed off `getLang()` — pt-BR → BRL/`R$`, en-US → USD/`$`. The KPI unit spans (`#kpiIncomeUnit` / `#kpiExpenseUnit`) are populated dynamically from the same locale.
- **Theme + Typography presets** ("Ledger" design system): Paper light is the default (no attribute); Graphite dark is `<html data-theme="dark">`. Typography is the Ledger stack (Bricolage Grotesque display / Geist body+numerals / JetBrains Mono labels) by default, or `<html data-typography="system">`. Persisted in `localStorage` under `appTheme` (`'paper' | 'dark'`; legacy `'light'` migrates to `'paper'`, no key follows `prefers-color-scheme`) / `appTypography` (`'system'` only; legacy `'modern'`/`'editorial'` are cleared). An inline bootstrap script in every HTML entry point applies them before stylesheets resolve so there's no flash of default theme. All tokens live in `css/theme.css`; the sidebar/topbar use theme-invariant `--chrome-*` tokens (graphite in both themes). Charts re-skin via `reapplyChartTheme()` which destroys + rebuilds with debouncing.
- **Charts**: 3 Chart.js canvases (net-balance line, monthly cash-flow bars, categories) + an HTML budget status panel in the 4th grid slot. The categories chart has a 3-way toggle — `bar | doughnut | stacked` — persisted under `assetmgmt.categoryChartType`; `buildCategoryChart()` builds all three presentations and `updateCharts()` branches on the active mode. Money figures use `font-variant-numeric: tabular-nums`; entry tag chips are theme-neutral with a per-category color dot (`--tag-dot-color`).
- **Dev note**: `server.js` pre-renders HTML into an in-memory cache at startup (`htmlCache`) — restart `npm start` after editing any HTML file to see the change.
- **Hidden action bus**: the invisible `header.legacy-header` in index.html holds `#addEntryBtn`/`#settingsBtn`/`#logoutBtn`/`#adminPanelBtn`/`#openBulkUploadModal`, which app.js wires without null guards and the visible topbar/sidebar proxy clicks to. Do not delete it.
- **Loading-state feedback**: `setViewLoading()` aggregates `setChartsLoading` + `setEntriesLoading` + `setHeroLoading`. Each helper toggles its CSS skeleton class AND `aria-busy` on the corresponding region. Async modal buttons go through `setButtonLoading(btn, isLoading)` (adds `.loading` class for the spinner pseudo-element + disabled). Sync chart rebuilds (`setCategoryChartType`, `reapplyChartTheme`) flash skeletons via `setTimeout(..., 0)`-deferred work with module-scope coalescing timers (`_categoryRebuildTimer` / `_themeRebuildTimer`).
- **Versioning**: `APP_VERSION` is read from `package.json` at boot — bumping `package.json` is the single source of truth for the release version. Current line: 4.0.1. A release is a `Release vX.Y.Z` commit (bump `package.json` + `package-lock.json` + the version on this line), followed by the release-request commit described under CI.
