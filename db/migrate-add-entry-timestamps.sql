-- Migration: Add created_at and updated_at timestamps to entries table
-- Run: psql -U asset_app -d asset_management -f db/migrate-add-entry-timestamps.sql

BEGIN;

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMIT;
