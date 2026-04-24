<p align="center">
  <img src=".github/logo_gh_repo.png" alt="Asset Manager Logo" width="400">
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# Asset Management Web Application

A secure multi-user web-based asset management system with AI-powered expense tracking that automatically processes financial documents and provides personalized financial advice through an AI chat advisor. Supports four AI providers: Google Gemini, OpenAI, Anthropic Claude (API key **or** Claude Code OAuth subscription), and GitHub Copilot (OAuth subscription).

## Features

### Core Functionality
- **Multi-User Support**: Multiple users with independent data isolation
- **User Registration**: Public registration for new users
- **User Authentication**: Secure login with bcrypt password hashing
- **Asset Tracking**: Add monthly income and expense entries manually
- **Data Visualization**: Interactive charts showing asset progression, income vs expenses, and expense categories
- **Advanced Filtering**: Filter entries by date range, transaction type, and categories
- **Sortable Columns**: Click table headers to sort by any column
- **Data Management**: Edit and delete existing entries
- **Encrypted Storage**: Sensitive fields (emails, API keys, OAuth tokens, TOTP secrets) encrypted with AES-256-CBC

### Multi-User System
- **Public Registration**: New users can create accounts
- **Self-Service Password Reset**: Users reset their own password via email (one-time code, 15-min expiry)
- **Two-Factor Authentication (2FA)**: Optional TOTP-based 2FA using authenticator apps (Google Authenticator, Duo, Authy) with backup codes
- **Data Isolation**: Each user sees only their own entries
- **Admin Panel**: Admins can create, activate/deactivate, and delete users; view email/2FA status indicators
- **Role-Based Access**: Admin and regular user roles
- **User Settings**: Users manage their own email and 2FA via the Settings modal

### Couples/Partner Feature
- **Partner Linking**: Admins can link two users as a couple
- **View Modes**: Toggle between Individual and Combined (Couple) views
- **Couple Expenses**: Mark entries as shared couple expenses
- **Combined Analytics**: View aggregated finances for both partners
- **Admin Couple Management**: Link/unlink couples from Admin Panel

### AI-Powered Processing
- **Multi-Provider Support**: Choose between Google Gemini, OpenAI, Anthropic Claude, or GitHub Copilot in Settings
- **PDF Analysis**: Upload financial documents for automatic expense extraction using your selected AI provider
- **Smart Data Extraction**: Automatically identifies amounts, dates, descriptions, and categories from PDFs
- **Category Tagging**: AI automatically assigns expense category tags (food, transport, utilities, etc.)
- **Bulk Import**: Process multiple expenses from a single document with preview and editing
- **Per-User Credentials**: Each user can store their own encrypted API key (Gemini/OpenAI/Anthropic) **or** OAuth token (Claude Code subscription, GitHub Copilot subscription) per provider
- **Key Priority Chain**: User's stored credential > global env var fallback
- **Dynamic Model Selection**: Browse and select from available models for your chosen provider

### AI Financial Advisor
- **Chat Interface**: Floating chat widget on the dashboard for real-time financial advice
- **Data-Driven Insights**: AI analyzes your actual income, expenses, and spending patterns
- **Function Calling**: AI uses 8 server-side tools (summary, category breakdown, trends, top expenses, period comparison, search, edit entries, undo edits)
- **Edit Confirmation**: AI-proposed edits render as interactive Confirm/Cancel cards in the chat
- **Conversation History**: Chat context maintained during the session for follow-up questions
- **Rate Limited**: 30 messages per 15-minute window per user

#### Bulk Import Workflow
1. Click "Bulk PDF Upload" in the header
2. Ensure your AI provider is configured with an API key (via Settings)
3. Select a PDF file (bank statement, receipt, etc.)
4. Click "Upload and Process" to send to your AI provider
5. Review extracted entries in the preview table
6. Edit any entries inline (month, type, amount, description, category)
7. Use Edit/Delete buttons to modify or remove individual rows
8. Click "Confirm and Add Entries" to save all entries

### Data Visualization
- **Asset Progression**: Line chart showing cumulative total assets over time
- **Monthly Comparison**: Grouped bar chart of income vs expenses per month
- **Category Distribution**: Horizontal bar chart showing expense breakdown by category
- **Category Trends**: Stacked bar chart showing expense categories evolution per month
- **Summary Statistics**: Total income, expenses, and net balance

### Internationalization (i18n)
- **Multilingual Support**: Full English and Portuguese translations across all pages
- **Language Toggle**: Globe icon button (🌐) in the bottom-right corner of every page
- **Persistent Preference**: Language selection saved in browser localStorage

### Network & Security
- **Local DNS**: Access via `https://asset-manager.local` on your network
- **HTTPS Encryption**: All communications secured with SSL/TLS
- **Network Access**: Available to all devices on your LAN
- **Session Management**: Secure session-based authentication
- **Data Encryption**: Sensitive user fields encrypted with AES-256-CBC before storage in PostgreSQL

## Requirements

- **Node.js** 18.x or higher
- **npm** (Node Package Manager)
- **PostgreSQL** 14+ (localhost, scram-sha-256 auth recommended)
- **Modern web browser** with JavaScript enabled
- **AI credentials** (optional globally; users can provide their own per provider — Gemini API key, OpenAI API key, Anthropic API key or Claude Code OAuth token, or GitHub Copilot OAuth token)

## Database Setup

1. **Install PostgreSQL** 14+ if not already installed
2. **Create the database user and database**:
   ```bash
   sudo -u postgres psql
   ```
   ```sql
   CREATE USER asset_app WITH PASSWORD 'your-secure-password';
   CREATE DATABASE asset_management OWNER asset_app;
   \q
   ```
3. **Run the schema** to create tables and indexes:
   ```bash
   psql -U asset_app -d asset_management -f db/schema.sql
   ```

## Installation

1. **Clone or download** this repository
2. **Navigate** to the project directory
3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Create SSL certificates** (for HTTPS):
   ```bash
   npm run ssl
   ```

5. **Configure environment variables**:

   **Local dev** — copy the example and fill in your values:
   ```bash
   cp .env.example .env
   ```

   **Production** — set secrets as system environment variables (e.g. via systemd `Environment=` directives). No `.env` file should exist on the server.

   Required variables:
   ```env
   ENCRYPTION_KEY=your-64-char-hex-key          # Required — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   SESSION_SECRET=your-secure-session-secret     # Required
   PGHOST=localhost                              # Required: PostgreSQL host
   PGPORT=5432                                   # Optional (defaults to 5432)
   PGDATABASE=asset_management                   # Required: PostgreSQL database name
   PGUSER=asset_app                              # Required: PostgreSQL user
   PGPASSWORD=your-pg-password                   # Required: PostgreSQL password (escape % as %% in systemd)
   ADMIN_USERNAME=admin                          # Optional (defaults to "admin")
   ADMIN_PASSWORD_HASH=your-bcrypt-hashed-password
   PORT=443
   GEMINI_API_KEY=your-gemini-api-key            # Optional: global fallback for Gemini users
   OPENAI_API_KEY=your-openai-api-key            # Optional: global fallback for OpenAI users
   ANTHROPIC_API_KEY=your-anthropic-api-key      # Optional: global fallback for Anthropic users
   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...      # Optional: global fallback for Anthropic users (Claude Code subscription)
   GITHUB_COPILOT_TOKEN=gho_...                  # Optional: global fallback for Copilot users
   UMAMI_WEBSITE_ID=your-umami-website-id        # Optional: analytics
   SMTP_HOST=smtp.gmail.com                      # Optional: enables self-service password reset
   SMTP_PORT=587                                 # Optional
   SMTP_USER=your-email@gmail.com                # Optional
   SMTP_PASS=your-app-password                   # Optional (Gmail: use App Password)
   SMTP_FROM=your-email@gmail.com                # Optional
   PG_POOL_DEBUG=1                               # Optional: verbose PostgreSQL pool logging
   ```

   > **SMTP is optional.** If not configured, password resets can only be done by an admin. All five `SMTP_*` variables must be set for the feature to activate.

   The server validates `ENCRYPTION_KEY`, `SESSION_SECRET`, `PGUSER`, and `PGPASSWORD` at startup and exits with a clear error if any is missing.

6. **Generate admin password hash**:
   ```bash
   npm run hash-password your-password
   ```

## Authentication Setup

### Initial Admin Setup
On first run, the system automatically migrates the admin user from environment variables:
- `ADMIN_USERNAME` (defaults to "admin")
- `ADMIN_PASSWORD_HASH` (bcrypt hash from environment variables)

### User Registration
New users can register at `/register.html` with:
- Username (3-30 characters, alphanumeric and underscores)
- Password (minimum 8 characters)

### Password Reset
Users can reset their own password at `/forgot-password.html`:
1. Enter your username
2. Receive a one-time code by email (8-char alphanumeric, expires in 15 minutes)
3. Enter the code and choose a new password

Requires SMTP to be configured and the user to have set an email in Settings.

### Admin User Management
Admins can access the Admin Panel to:
- Create new users with specified roles
- Activate/deactivate user accounts
- Delete users (and their associated entries)
- View user statistics, email status, and 2FA status

## AI Provider Credentials

Each user can configure credentials for one or more AI providers in **Settings → AI Provider** in the web UI. The server falls back to the matching `*_API_KEY` / `*_TOKEN` environment variable when a user has no per-user credential.

The classic providers (Gemini, OpenAI, Anthropic API key) accept a standard API key copy-pasted from the provider's console. The two **OAuth-based** options below let users wire up an existing Claude.ai or GitHub Copilot subscription instead of paying for separate API usage.

### Anthropic — Claude Code OAuth token

If you already pay for a [Claude.ai Pro or Max subscription](https://www.anthropic.com/pricing), you can use that subscription instead of an API key. Use Anthropic's official `claude-code` CLI to generate the supported `sk-ant-oat01-…` token via `claude setup-token`:

1. Install the CLI: `npm install -g @anthropic-ai/claude-code`
2. Run `claude setup-token` and complete the flow — it prints the OAuth token directly to the terminal.
3. Paste it into Settings → AI provider → **Claude Code OAuth token**.

> **Note**: only `sk-ant-oat01-…` tokens (from `claude setup-token`) are accepted as OAuth tokens. A regular `sk-ant-api…` API key belongs in the Anthropic API key field instead.

The server sends `anthropic-beta: oauth-2025-04-20` on every Anthropic request when an OAuth token is detected, which is what makes the subscription accept it as a credential.

### GitHub Copilot — OAuth token

If you have an active [GitHub Copilot](https://github.com/features/copilot) subscription (Individual, Business, or Enterprise), you can use it as the AI provider. The server impersonates the VS Code Copilot Chat editor identity and derives the per-account API base URL from the exchanged session token, so the token works the same way it does inside VS Code.

**Easiest path** — if you already use Copilot in VS Code, the token is already on your machine:
- macOS / Linux: read `~/.config/github-copilot/apps.json` (or `hosts.json`); use the value at `["<host>"].oauth_token` as your token. It may have different valid GitHub token prefixes, such as `gho_…`, `ghu_…`, `ghp_…`, or `github_pat_…`.

**Manual path** — use GitHub's OAuth Device Flow with the well-known VS Code Copilot Chat client ID (`Iv1.b507a08c87ecfe98`):

1. **Request a device code:**
   ```bash
   curl -s -X POST https://github.com/login/device/code \
     -H "Accept: application/json" \
     -d "client_id=Iv1.b507a08c87ecfe98&scope=read:user"
   ```
   You'll get back JSON containing a `user_code` (e.g. `WXYZ-1234`) and `verification_uri` (`https://github.com/login/device`).

2. **Authorize in browser:** open `https://github.com/login/device`, enter the `user_code`, and approve the request on the GitHub account that owns your Copilot subscription.

3. **Exchange the device code for an access token:**
   ```bash
   curl -s -X POST https://github.com/login/oauth/access_token \
     -H "Accept: application/json" \
     -d "client_id=Iv1.b507a08c87ecfe98" \
     -d "device_code=PASTE_DEVICE_CODE_HERE" \
     -d "grant_type=urn:ietf:params:oauth:grant-type:device_code"
   ```
   The response contains `access_token` — typically prefixed `gho_…` or `ghu_…`. (If you get `{"error":"authorization_pending"}`, complete step 2 first and retry.)

4. **Paste the token** into Settings → AI provider → **GitHub Copilot OAuth token**.

The token is long-lived but you can revoke it anytime from https://github.com/settings/connections/applications/Iv1.b507a08c87ecfe98 → "Revoke access". The server caches the short-lived (~25–30 min) Copilot session token derived from this OAuth token and refreshes it automatically.

> **Treat OAuth tokens like passwords.** Anyone with your token can consume your Claude or Copilot subscription quota. Per-user tokens are encrypted at rest with AES-256-CBC.

## Network Setup (Local DNS)

To access via `https://asset-manager.local`:

1. **Add to hosts file** on each device:
   - **Linux/macOS**: `echo "<YOUR_SERVER_IP> asset-manager.local" | sudo tee -a /etc/hosts`
   - **Windows**: Add `<YOUR_SERVER_IP> asset-manager.local` to `C:\Windows\System32\drivers\etc\hosts`

2. **Or configure your router** to use the server as DNS

## Usage

### Starting the Server

**Production** (systemd):
```bash
sudo systemctl start asset-management
```

**Local dev**:
```bash
node server.js
```

### Accessing the Application
- **Local**: `https://asset-manager.local`
- **Network**: `https://<YOUR_SERVER_IP>`
- **Localhost**: `https://localhost:443`

### Using the System

1. **Register/Login**: Create an account or login with existing credentials
2. **Manual Entry**: Add income/expenses using the form with optional category tags
3. **PDF Upload**: Upload financial documents for AI-powered expense extraction
4. **Data Analysis**: View charts and filter data by date/type/category
5. **Admin Panel** (admins only): Manage users from the Admin Panel button

## Category Tags

Available expense/income categories:
- Food, Groceries, Transport, Travel, Entertainment
- Utilities, Healthcare, Education, Shopping, Subscription
- Housing, Salary, Freelance, Investment, Transfer, Wedding, Other

## Security Features

- **HTTPS Encryption**: All data transmitted securely
- **Password Hashing**: bcrypt with 10 salt rounds
- **Session Security**: HTTP-only, secure cookies (24-hour expiration)
- **Data Encryption**: AES-256-CBC field-level encryption for sensitive data (emails, API keys, TOTP secrets)
- **API Key Encryption**: Per-user AI provider keys encrypted with field-level AES-256-CBC
- **TOTP 2FA**: Time-based one-time passwords with encrypted secret storage and bcrypt-hashed backup codes
- **Email Encryption**: User emails encrypted at rest with AES-256-CBC
- **Email Privacy**: Admins see only email/2FA status indicators, not actual addresses
- **Reset Code Security**: Single-use, 15-min expiry, one active per user, code-username binding verified
- **Anti-Enumeration**: Generic responses on forgot-password; constant-time login (always runs bcrypt)
- **CSRF Protection**: Per-session tokens validated on all state-changing requests (only external PayPal callbacks are exempt)
- **Input Validation**: Server-side validation for all inputs
- **Data Isolation**: Users can only access their own entries
- **Role-Based Access**: Admin-only endpoints protected

## Data Storage

- **Database**: PostgreSQL with parameterized queries (no string interpolation)
- **Tables**: `users`, `entries`, `user_categories`, `invite_codes`, `paypal_orders`
- **Field Encryption**: Sensitive fields (email, API keys, OAuth tokens, TOTP secret) stored as AES-256-CBC encrypted JSON `{iv, encryptedData}`
- **User Model**: `{ id, username, password_hash, role, email, gemini_api_key, openai_api_key, anthropic_api_key, claude_oauth_token, github_copilot_token, totp_secret, totp_enabled, backup_codes, ai_provider, ai_model, web_search_enabled, partner_id, partner_linked_at, is_active, created_at, updated_at }`
- **Entry Model**: `{ id, user_id, month, type, amount, description, tags, is_couple_expense }`
- **User Category Model**: `{ id, user_id, slug, label, color, is_default, sort_order, imported_from_user_id, created_at }` — per-user category list, capped at 100 per user, seeded with 17 defaults on first access

## Technical Details

### Architecture
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript with Chart.js
- **Database**: PostgreSQL with `pg` connection pool (parameterized queries)
- **AI Integration**: Google Gemini, OpenAI, Anthropic Claude (API key or Claude Code OAuth), and GitHub Copilot OAuth (user-selectable)
- **Security**: Helmet.js, bcrypt, express-session, otplib (TOTP 2FA), custom AES field encryption

### API Endpoints

#### Authentication
- `POST /api/login` - User authentication
- `POST /api/register` - User registration
- `POST /api/logout` - End session
- `GET /api/user` - Get current user info (includes API key availability flags per provider)
- `POST /api/forgot-password` - Request password reset code (rate limited: 3/15min)
- `POST /api/reset-password` - Reset password with code

#### User Settings (requires authentication)
- `GET /api/user/email` - Get masked email status
- `PUT /api/user/email` - Update email
- `DELETE /api/user/email` - Remove email
- `POST /api/user/gemini-key` - Save encrypted Gemini API key
- `DELETE /api/user/gemini-key` - Remove saved Gemini API key
- `POST /api/user/openai-key` - Save encrypted OpenAI API key
- `DELETE /api/user/openai-key` - Remove saved OpenAI API key
- `POST /api/user/anthropic-key` - Save encrypted Anthropic API key
- `DELETE /api/user/anthropic-key` - Remove saved Anthropic API key
- `GET /api/user/claude-oauth-token` - Get Claude Code OAuth token availability flags
- `POST /api/user/claude-oauth-token` - Save encrypted Claude Code OAuth token
- `DELETE /api/user/claude-oauth-token` - Remove saved Claude Code OAuth token
- `GET /api/user/github-copilot-token` - Get GitHub Copilot OAuth token availability flags
- `POST /api/user/github-copilot-token` - Save encrypted GitHub Copilot OAuth token
- `DELETE /api/user/github-copilot-token` - Remove saved GitHub Copilot OAuth token
- `PUT /api/user/ai-provider` - Set AI provider (gemini, openai, anthropic, or copilot)
- `PUT /api/user/ai-model` - Set preferred AI model (validated against active provider)
- `GET /api/user/2fa/status` - Get 2FA status
- `POST /api/user/2fa/setup` - Start 2FA setup (generates QR code)
- `POST /api/user/2fa/verify` - Verify and enable 2FA
- `POST /api/user/2fa/disable` - Disable 2FA

#### Entries (requires authentication)
- `GET /api/entries` - Retrieve user's entries
- `POST /api/entries` - Add new entry
- `PUT /api/entries/:id` - Update entry
- `DELETE /api/entries/:id` - Delete entry
- `POST /api/process-pdf` - Process PDF with AI (uses user's selected provider)
- `POST /api/ai/chat` - AI financial advisor chat (rate limited: 30/15min)
- `POST /api/ai/confirm-edit` - Confirm a pending AI-proposed edit
- `POST /api/ai/cancel-edit` - Cancel a pending AI-proposed edit
- `GET /api/ai/models` - List available models for user's AI provider (rate limited: 10/min)

#### Admin (requires admin role)
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create user
- `PUT /api/admin/users/:id` - Update user
- `DELETE /api/admin/users/:id` - Delete user
- `GET /api/admin/couples` - List all linked couples
- `POST /api/admin/couples/link` - Link two users as a couple
- `POST /api/admin/couples/unlink` - Unlink a couple

### File Structure
```
asset-management/
├── db/
│   ├── schema.sql           # PostgreSQL schema (tables, indexes, constraints)
│   ├── pool.js              # pg connection pool configuration
│   ├── queries.js           # All parameterized query functions
│   ├── migrate-json-to-pg.js # One-shot JSON→PostgreSQL migration (idempotent)
│   └── MIGRATION_RUNBOOK.md # Step-by-step deployment & cutover guide
├── ssl/                     # SSL certificates
├── data/                    # Legacy encrypted JSON files (pre-migration backup)
├── js/
│   ├── app.js               # Main application logic
│   ├── csrf.js              # CSRF token helper for fetch requests
│   ├── i18n.js              # Internationalization (EN/PT translations)
│   ├── login.js             # Login page logic
│   ├── register.js          # Registration page logic
│   ├── chat.js              # AI financial advisor chat module
│   └── forgot-password.js   # Password reset page logic
├── server.js                # Main server application
├── config.js                # Centralized config with startup validation
├── backup.sh                # Backup script (pg_dump + R2 upload)
├── rotate-key.sh            # Encryption key rotation script
├── index.html               # Main dashboard
├── login.html               # Login page
├── register.html            # Registration page
├── forgot-password.html     # Self-service password reset page
├── package.json             # Dependencies
└── .env.example             # Environment variable template
```

## Migration

### JSON to PostgreSQL Migration
The app was migrated from encrypted JSON file storage to PostgreSQL. To run the migration on existing data:
1. Set up PostgreSQL and run `db/schema.sql` to create tables
2. Configure PG environment variables
3. Run `node db/migrate-json-to-pg.js` (idempotent, transactional, rolls back on mismatch)
4. See `db/MIGRATION_RUNBOOK.md` for the full step-by-step deployment guide

### Admin Auto-Migration
On first run, the system automatically creates an admin user from `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` environment variables.

## Maintenance

- **Logs**: Server logs available in terminal output
- **Updates**: `npm update` to update dependencies
- **SSL Renewal**: Regenerate certificates annually
- **Backup**: Run `./backup.sh` to back up PostgreSQL (`pg_dump`) and legacy data files to Cloudflare R2 via rclone

### Rotating the Encryption Key

To rotate `ENCRYPTION_KEY` without losing access to encrypted data:

```bash
sudo bash rotate-key.sh
```

The script re-encrypts all field-level encrypted values (emails, API keys, TOTP secrets) in the PostgreSQL database with a new key. It also updates legacy JSON files if they still exist. Save the old key in a password manager — it's needed to decrypt old backups.

## Troubleshooting

### Common Issues
1. **Certificate Errors**: Regenerate SSL certificates or accept self-signed
2. **AI API Errors**: Verify your API key is valid for the selected provider (per-user key, or global env var fallback)
3. **DNS Issues**: Verify hosts file or router DNS configuration
4. **Permission Errors**: Run server with `sudo` for port 443
5. **Login Issues**: Ensure user account is active

### Debug Mode
- Check browser developer console for client-side errors
- Server logs show processing information (financial data is redacted from logs)

---

**Note**: This system is designed for personal/family financial management. PostgreSQL is used for persistent storage with parameterized queries, field-level AES-256-CBC encryption for PII, and localhost-only database access.
