-- Migration: add user_categories table (issue #70)
-- Idempotent — safe to re-run on existing deployments.
-- Run: psql -U asset_app -d asset_management -f db/migrate-add-user-categories.sql
--
-- Defaults are NOT seeded here; the GET /api/categories endpoint self-heals
-- by seeding the 17 default categories the first time a user has none.

BEGIN;

CREATE TABLE IF NOT EXISTS user_categories (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    label           TEXT NOT NULL,
    color           TEXT NOT NULL,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    imported_from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_user_categories_user_id ON user_categories(user_id);

COMMIT;
