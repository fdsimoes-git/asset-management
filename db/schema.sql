-- Asset Management PostgreSQL Schema
-- Run: psql -U asset_app -d asset_management -f db/schema.sql

BEGIN;

-- ── Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                BIGSERIAL PRIMARY KEY,
    username          TEXT NOT NULL,
    password_hash     TEXT NOT NULL,
    role              TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    email             TEXT,              -- JSON: {"iv":"...","encryptedData":"..."}
    gemini_api_key    TEXT,              -- JSON: encrypted
    openai_api_key    TEXT,              -- JSON: encrypted
    anthropic_api_key TEXT,              -- JSON: encrypted
    claude_oauth_token TEXT,             -- JSON: encrypted (Claude Code CLI OAuth token, sk-ant-oat01-...)
    github_copilot_token TEXT,           -- JSON: encrypted (GitHub OAuth token, gho_/ghu_/ghp_/github_pat_...)
    totp_secret       TEXT,              -- JSON: encrypted
    totp_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    backup_codes      TEXT[] NOT NULL DEFAULT '{}',
    ai_provider       TEXT,
    ai_model          TEXT,
    web_search_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    partner_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    partner_linked_at TIMESTAMPTZ,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Entries ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entries (
    id                BIGSERIAL PRIMARY KEY,
    user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month             TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    type              TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    description       TEXT NOT NULL,
    tags              TEXT[] NOT NULL DEFAULT '{}',
    is_couple_expense BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Invite Codes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_codes (
    code       TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    is_used    BOOLEAN NOT NULL DEFAULT FALSE,
    used_at    TIMESTAMPTZ,
    used_by    BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- ── PayPal Orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paypal_orders (
    order_id     TEXT PRIMARY KEY,
    amount       NUMERIC(10,2) NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'BRL',
    status       TEXT NOT NULL,
    invite_code  TEXT,
    user_id      BIGINT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entries_user_id        ON entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_month           ON entries(month);
CREATE INDEX IF NOT EXISTS idx_entries_user_id_month   ON entries(user_id, month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_invite_codes_is_used    ON invite_codes(is_used);
CREATE INDEX IF NOT EXISTS idx_paypal_orders_status     ON paypal_orders(status);
CREATE INDEX IF NOT EXISTS idx_paypal_orders_created_at ON paypal_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_users_is_active         ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_partner_id        ON users(partner_id);
CREATE INDEX IF NOT EXISTS idx_entries_is_couple_expense ON entries(is_couple_expense);
CREATE INDEX IF NOT EXISTS idx_entries_user_couple_month ON entries(user_id, is_couple_expense, month);
CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by    ON invite_codes(used_by);

-- ── Idempotent column additions for existing deployments ─────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
