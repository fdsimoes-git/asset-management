# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Secure multi-user asset management web app with AI-powered expense tracking. Node.js/Express backend serving vanilla JavaScript frontend directly (no build step). PostgreSQL database with field-level AES-256-CBC encryption and Postgres-backed session storage. Supports English and Portuguese (i18n).

## Commands

```bash
# Install dependencies (Node.js 18.18+, 20.9+, or 22+ required by connect-pg-simple)
npm install

# Run dev server (port 3000 by default; override with PORT env var)
npm start

# Run production server (port 443, requires sudo)
npm run start:prod

# Generate self-signed SSL certificates
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
- `PG*` vars — PostgreSQL connection

`config.js` validates required secrets and fails fast on startup if missing.

## Architecture

### Backend (single-file server)

**`server.js`** (~6,080 lines) — monolithic Express app containing all route handlers, middleware, AI integration, and business logic. ~64 API endpoints are defined here.

**`config.js`** — centralized env var loading with startup validation. Exports a single config object.

**`db/`** — database layer:
- `pool.js` — pg connection pool (max 10 connections), exports `{ pool, testConnection }`
- `queries.js` — all parameterized SQL query functions (~1,350 lines)
- `schema.sql` — PostgreSQL schema (tables: `users`, `entries`, `user_categories`, `user_budgets`, `invite_codes`, `paypal_orders`, `session`)
- `migrate-json-to-pg.js` — one-shot idempotent migration from legacy JSON storage
- `migrate-add-*.sql` + `MIGRATION_RUNBOOK.md` — incremental schema migrations (latest: `migrate-add-user-budgets.sql` for the v3.0 Budgets feature)

### Frontend (no framework, no build)

All frontend code is vanilla JavaScript loaded directly by the browser:
- `index.html` (~140 KB / ~3,475 lines) — main dashboard with inline CSS, sidebar/topbar shell, hero KPI row with sparklines, Reports + Budgets modals
- `js/app.js` (~5,610 lines) — dashboard logic, charts (Chart.js), CRUD, admin panel, categories, Reports/Budgets modals, theme + typography presets, mobile sidebar drawer with focus management, loading-state helpers (`setViewLoading` / `setHeroLoading` / `setChartsLoading` / `setEntriesLoading` / `setSingleChartLoading` / `setButtonLoading`)
- `js/chat.js` (~675 lines) — AI financial advisor floating chat widget
- `js/i18n.js` (~1,310 lines) — English + Portuguese translations (~700 keys) and `t(key, replacements)` helper
- `js/csrf.js`, `js/login.js`, `js/register.js`, `js/forgot-password.js` — page-specific modules

### API Structure

Routes are organized in `server.js` by domain:
- `/api/login`, `/api/register`, `/api/logout`, `/api/forgot-password`, `/api/csrf-token` — auth
- `/api/entries` — CRUD for income/expense entries
- `/api/categories` — per-user category management (cap 100 per user)
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

AI features include PDF expense extraction (uses the user's category list) and a financial advisor chat with 8 server-side tools (`getFinancialSummary`, `getCategoryBreakdown`, `getMonthlyTrends`, `getTopExpenses`, `comparePeriods`, `searchEntries`, `editEntry`, `undoLastEdit`) plus optional Anthropic-native `web_search`. `editEntry` is two-phase: it returns a pending proposal that the UI surfaces as a Confirm/Cancel card and the user finalizes via `/api/ai/confirm-edit` or `/api/ai/cancel-edit`.

### Security Model

- Passwords: bcryptjs (10 rounds)
- Sessions: `express-session` with `connect-pg-simple` Postgres store (since v2.6.6); HTTP-only secure cookies, 24h `maxAge`, expired rows pruned every 15 min
- Field encryption: AES-256-CBC for emails, API keys, OAuth tokens, TOTP secrets
- CSRF: per-session tokens validated on every non-GET/HEAD/OPTIONS `/api/*` request (except PayPal callbacks) — see `server.js` global middleware
- Rate limiting: per-endpoint (login 5/15min, chat 30/15min, PDF 10/15min, plus register/forgot/totp/paypal/aiModels/general limiters)
- SQL: all queries parameterized via `db/queries.js`
- 2FA: TOTP with bcrypt-hashed backup codes
- Static asset exposure narrowed to `/js` only (no `express.static(__dirname)`)

### iOS App

Capacitor 8 wraps the web app for iOS (`ios/` directory, app ID `com.assetmanager.app`).

## Key Patterns

- All database queries go through `db/queries.js` — never write raw SQL in `server.js`
- Encryption/decryption helpers are defined in `server.js` (`encrypt()`/`decrypt()`)
- The admin user is auto-created on startup from `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` env vars
- Rate limiters are defined per-endpoint at the top of `server.js`
- Frontend uses a global `t(key, replacements)` function from `i18n.js` for all user-facing strings; falls back to returning the key when missing
- **Per-user categories**: `user_categories` table; `getCategoriesForUserSelfHeal()` seeds the 17 `DEFAULT_CATEGORIES` slugs on first read; cap of 100/user enforced via `pg_advisory_xact_lock(userId)`; default labels are rendered via i18n keys `cat.<slug>` (not the DB label)
- **Per-user budgets** (v3.0): `user_budgets` table; `category_slug = NULL` is the user's "overall" budget; unique index uses `(user_id, (COALESCE(category_slug, '')), period)` (parens required for the COALESCE expression in both the index and the upsert's `ON CONFLICT`); `GET /api/budgets` reuses `getCategoriesForUserSelfHeal` so first-touch users see the default rows
- **Couple entries**: when both partners are linked, entries flagged `is_couple_expense` are visible to both; `ensurePartnerCategories()` auto-imports partner-category slugs into the active user's catalog
- **Auth middleware** caches `req.user` for 5s in `userCache`; mutating user-related queries invalidate the cache
- **Localized currency in the UI**: hero / Budgets money formatting goes through `Intl.NumberFormat` keyed off `getLang()` — pt-BR → BRL/`R$`, en-US → USD/`$`. The KPI unit spans (`#kpiIncomeUnit` / `#kpiExpenseUnit`) are populated dynamically from the same locale.
- **Theme + Typography presets** (v3.0): `<html data-theme="earthy|dark|light">` + `<html data-typography="editorial|modern|system">`, persisted in `localStorage` under `appTheme` / `appTypography`. An inline bootstrap script in every HTML entry point applies them before stylesheets resolve so there's no flash of default theme. Charts re-skin via `reapplyChartTheme()` which destroys + rebuilds with debouncing.
- **Loading-state feedback**: `setViewLoading()` aggregates `setChartsLoading` + `setEntriesLoading` + `setHeroLoading`. Each helper toggles its CSS skeleton class AND `aria-busy` on the corresponding region. Async modal buttons go through `setButtonLoading(btn, isLoading)` (adds `.loading` class for the spinner pseudo-element + disabled). Sync chart rebuilds (`setCategoryChartType`, `reapplyChartTheme`) flash skeletons via `setTimeout(..., 0)`-deferred work with module-scope coalescing timers (`_categoryRebuildTimer` / `_themeRebuildTimer`).
- **Versioning**: `APP_VERSION` is read from `package.json` at boot — bumping `package.json` is the single source of truth for the release version. Current line: 3.0.1.
