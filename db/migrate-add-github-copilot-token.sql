-- Migration: Add per-user encrypted GitHub Copilot OAuth token column
-- Adds GitHub Copilot as a new AI provider alongside Gemini / OpenAI / Anthropic.
-- Run: psql -U asset_app -d asset_management -f db/migrate-add-github-copilot-token.sql
--
-- The token is the long-lived GitHub OAuth access token (typically prefixed
-- `gho_` for OAuth-app issued tokens, `ghu_` for user-to-server tokens issued
-- by the Copilot GitHub App, or `ghp_` for personal access tokens).  At
-- request time, the server exchanges this long-lived token for a short-lived
-- (~30 min) Copilot session token via
-- `GET https://api.github.com/copilot_internal/v2/token` and uses that
-- session token as the Bearer credential against `api.githubcopilot.com`.
-- All Copilot API usage is billed against the user's GitHub Copilot
-- subscription rather than any pay-as-you-go AI provider key.
--
-- Stored as TEXT containing the JSON {"iv":"...","encryptedData":"..."}
-- produced by the same AES-256-CBC `encryptString()` helper that wraps the
-- existing `anthropic_api_key` / `claude_oauth_token` columns.

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS github_copilot_token TEXT;

COMMIT;
