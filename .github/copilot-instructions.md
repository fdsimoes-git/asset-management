# Copilot Instructions

## Commands

```bash
npm install          # Install dependencies
npm start            # Dev server (port 3000)
npm run start:prod   # Production (port 443, requires sudo)
npm run ssl          # Generate self-signed SSL certs
npm run hash-password <password>  # Generate bcrypt hash for admin setup
```

**No test framework, linter, or build step exists.** Frontend JS is served directly to the browser.

## Architecture

Monolithic Node.js/Express app serving a vanilla JavaScript frontend. PostgreSQL database with field-level AES-256-CBC encryption. No bundler or framework on the frontend.

### Backend

- **`server.js`** (~3,400 lines) — single-file Express app with all route handlers, middleware, encryption helpers (`encryptString`/`decryptString`), AI integration, and business logic.
- **`config.js`** — loads and validates environment variables at startup. Fails fast if `ENCRYPTION_KEY`, `SESSION_SECRET`, or PG credentials are missing.
- **`db/queries.js`** — all parameterized SQL queries. Converts between snake_case DB rows and camelCase JS objects (`dbRowToUser`, `dbRowToEntry`).
- **`db/pool.js`** — pg connection pool (max 10).
- **`db/schema.sql`** — PostgreSQL schema (tables: `users`, `entries`, `invite_codes`, `paypal_orders`).

### Frontend

Vanilla JS loaded directly by the browser — no build, no transpilation:

- **`index.html`** — main dashboard (inline CSS, ~83KB)
- **`js/app.js`** — dashboard logic, Chart.js charts, CRUD operations, admin panel
- **`js/chat.js`** — AI financial advisor floating chat widget
- **`js/i18n.js`** — English + Portuguese translations (600+ keys), exposes global `t(key)` function
- **`js/csrf.js`** — CSRF token helper; exposes `csrfFetch()` wrapper for all state-changing requests
- **`js/login.js`**, **`js/register.js`**, **`js/forgot-password.js`** — page-specific modules

### iOS

Capacitor 8 wraps the web app (`ios/` directory, app ID `com.assetmanager.app`).

## Key Conventions

### Database access

All SQL goes through `db/queries.js` — never write raw SQL in `server.js`. Queries use `$1, $2, ...` parameterized placeholders (pg library). Encrypted fields (email, API keys, TOTP secret) are stored as JSON strings `{"iv":"...","encryptedData":"..."}` and parsed back via `parseJsonField()`.

### Encryption

`encryptString()`/`decryptString()` in `server.js` handle AES-256-CBC field-level encryption. All sensitive user fields (emails, API keys, TOTP secrets) are encrypted before storage and decrypted on read.

### CSRF protection

State-changing endpoints require an `x-csrf-token` header. Frontend uses `csrfFetch()` from `js/csrf.js` instead of raw `fetch()` for POST/PUT/DELETE requests.

### Async route handlers

All async Express routes use the `asyncHandler()` wrapper defined at the top of `server.js` to forward rejected promises to error middleware.

### Internationalization

All user-facing strings use `t('key.name')` from `js/i18n.js`. Both English and Portuguese translations must be maintained in parallel (600+ keys each).

### AI integration

Three providers (Gemini, OpenAI, Anthropic) with per-user encrypted API key storage and global env var fallback. Default models are defined as constants at the top of `server.js` (`GEMINI_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL` and their `_CHAT_MODEL` variants).

### Rate limiting

Per-endpoint rate limiters defined at the top of `server.js` (e.g., login 5/15min, chat 30/15min, PDF 10/15min).

### Environment

Copy `.env.example` to `.env` for local dev. Required: `ENCRYPTION_KEY` (64-char hex), `SESSION_SECRET` (min 32 chars), `ADMIN_PASSWORD_HASH` (bcrypt), and `PG*` vars. `config.js` validates all on startup.
