# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Secure multi-user asset management web app with AI-powered expense tracking. Node.js/Express backend serving vanilla JavaScript frontend directly (no build step). PostgreSQL database with field-level AES-256-CBC encryption. Supports English and Portuguese (i18n).

## Commands

```bash
# Install dependencies
npm install

# Run dev server (port 3000 by default)
npm start

# Run production server (port 443, requires sudo)
npm run start:prod

# Generate self-signed SSL certificates
npm run ssl

# Generate bcrypt password hash for admin setup
npm run hash-password <password>

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**No test framework, linter, or build step exists.** Frontend JS is served directly to the browser.

## Environment Setup

Copy `.env.example` to `.env`. Required variables:
- `ENCRYPTION_KEY` — 64-char hex (32 bytes), validated on startup
- `SESSION_SECRET` — min 32 chars, validated on startup
- `ADMIN_PASSWORD_HASH` — bcrypt hash for admin user
- `PG*` vars — PostgreSQL connection

`config.js` validates required secrets and fails fast on startup if missing.

## Architecture

### Backend (single-file server)

**`server.js`** (~3,400 lines) — monolithic Express app containing all route handlers, middleware, AI integration, and business logic. All 46 API endpoints are defined here.

**`config.js`** — centralized env var loading with startup validation. Exports a single config object.

**`db/`** — database layer:
- `pool.js` — pg connection pool (max 10 connections)
- `queries.js` — all parameterized SQL query functions (~620 lines)
- `schema.sql` — PostgreSQL schema (tables: `users`, `entries`, `invite_codes`, `paypal_orders`)
- `migrate-json-to-pg.js` — one-shot idempotent migration from legacy JSON storage

### Frontend (no framework, no build)

All frontend code is vanilla JavaScript loaded directly by the browser:
- `index.html` (83KB) — main dashboard with inline CSS
- `js/app.js` (~3,000 lines) — dashboard logic, charts (Chart.js), CRUD, admin panel
- `js/chat.js` — AI financial advisor floating chat widget
- `js/i18n.js` (~45,000 lines) — English + Portuguese translations (600+ keys)
- `js/csrf.js`, `js/login.js`, `js/register.js`, `js/forgot-password.js` — page-specific modules

### API Structure

Routes are organized in `server.js` by domain:
- `/api/login`, `/api/register`, `/api/logout` — auth
- `/api/entries` — CRUD for income/expense entries
- `/api/user/*` — user settings (email, API keys, 2FA)
- `/api/ai/*` — AI chat, PDF processing, model listing
- `/api/admin/*` — user management, couple linking, invite codes
- `/api/paypal/*` — payment integration

### AI Integration

Three providers supported (Anthropic Claude, Google Gemini, OpenAI). Per-user encrypted API key storage with global env var fallback. AI features include PDF expense extraction and a financial advisor chat with server-side tools (summary, search, edit entries).

### Security Model

- Passwords: bcryptjs (10 rounds)
- Session: express-session with HTTP-only secure cookies
- Field encryption: AES-256-CBC for emails, API keys, TOTP secrets
- CSRF: per-session tokens validated on state-changing requests
- Rate limiting: per-endpoint (login 5/15min, chat 30/15min, PDF 10/15min)
- SQL: all queries parameterized via `db/queries.js`
- 2FA: TOTP with bcrypt-hashed backup codes

### iOS App

Capacitor 8 wraps the web app for iOS (`ios/` directory, app ID `com.assetmanager.app`).

## Key Patterns

- All database queries go through `db/queries.js` — never write raw SQL in `server.js`
- Encryption/decryption helpers are defined in `server.js` (`encrypt()`/`decrypt()`)
- The admin user is auto-created on startup from `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` env vars
- Rate limiters are defined per-endpoint at the top of `server.js`
- Frontend uses a global `t(key)` function from `i18n.js` for all user-facing strings
