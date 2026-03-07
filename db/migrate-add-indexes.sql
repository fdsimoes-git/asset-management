-- Migration: Add performance indexes
-- Run: psql -U asset_app -d asset_management -f db/migrate-add-indexes.sql

BEGIN;

CREATE INDEX IF NOT EXISTS idx_users_is_active         ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_partner_id        ON users(partner_id);
CREATE INDEX IF NOT EXISTS idx_entries_is_couple_expense ON entries(is_couple_expense);
CREATE INDEX IF NOT EXISTS idx_entries_user_couple_month ON entries(user_id, is_couple_expense, month);
CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by    ON invite_codes(used_by);

COMMIT;
