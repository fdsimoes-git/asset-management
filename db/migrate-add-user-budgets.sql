-- Migration: add user_budgets table (issue #93)
-- Idempotent — safe to re-run on existing deployments.
-- Run: psql -U asset_app -d asset_management -f db/migrate-add-user-budgets.sql
--
-- Per-user monthly budget targets. category_slug = NULL is the user's
-- "overall" monthly budget. The unique index uses COALESCE because Postgres
-- does NOT dedupe NULLs in plain UNIQUE constraints, so two NULL rows for
-- the same (user_id, period) would otherwise both be allowed.

BEGIN;

CREATE TABLE IF NOT EXISTS user_budgets (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_slug   TEXT, -- NULL = overall budget for this user
    amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    period          TEXT NOT NULL DEFAULT 'monthly',
    currency        TEXT NOT NULL DEFAULT 'USD',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_budgets_unique
    ON user_budgets (user_id, COALESCE(category_slug, ''), period);

CREATE INDEX IF NOT EXISTS idx_user_budgets_user_id ON user_budgets(user_id);

COMMIT;
