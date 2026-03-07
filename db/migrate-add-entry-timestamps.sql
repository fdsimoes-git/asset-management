-- Migration: Add created_at and updated_at timestamps to entries table
-- Run: psql -U asset_app -d asset_management -f db/migrate-add-entry-timestamps.sql

BEGIN;

-- Step 1: Add columns as nullable without defaults (fast metadata-only change, no table rewrite)
ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Step 2: Backfill existing rows (sets current time for records with no known timestamp)
UPDATE entries
SET
    created_at = COALESCE(created_at, NOW()),
    updated_at = COALESCE(updated_at, NOW());

-- Step 3: Set defaults for new rows going forward
ALTER TABLE entries
    ALTER COLUMN created_at SET DEFAULT NOW(),
    ALTER COLUMN updated_at SET DEFAULT NOW();

-- Step 4: Enforce NOT NULL after backfill is complete
ALTER TABLE entries
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL;

COMMIT;
