-- Migration: Add per-user encrypted Claude Code OAuth token column
-- Issue #47 — Use Claude CLI OAuth token as an alternative to Anthropic API key.
-- Run: psql -U asset_app -d asset_management -f db/migrate-add-claude-oauth-token.sql
--
-- The token is generated with `claude setup-token` from the Claude Code CLI
-- (npm i -g @anthropic-ai/claude-code).  It starts with `sk-ant-oat01-...` and,
-- when used to call the Anthropic API with the `anthropic-beta: oauth-2025-04-20`
-- header, charges the user's Claude Code subscription credits instead of
-- pay-as-you-go API usage.
--
-- Stored as TEXT containing the JSON {"iv":"...","encryptedData":"..."}
-- produced by the same AES-256-CBC `encrypt()` helper that wraps the existing
-- `anthropic_api_key` column.

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS claude_oauth_token TEXT;

COMMIT;
