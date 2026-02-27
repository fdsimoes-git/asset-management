/**
 * Centralized configuration with startup validation.
 *
 * Loads environment variables from .env (local dev) but never overrides
 * system env vars (production via systemd).  Validates that critical
 * secrets are present so the server fails fast instead of silently
 * starting with a random encryption key.
 */

require('dotenv').config();

// ── Required secrets ────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ENCRYPTION_KEY) {
    console.error('FATAL: ENCRYPTION_KEY is not set.');
    console.error('All data is encrypted with this key — starting without it would make existing data unreadable.');
    console.error('Set it as a system environment variable (production) or in a .env file (local dev).');
    process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
    console.error('FATAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
    console.error('Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

if (!SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET is not set.');
    console.error('Set it as a system environment variable (production) or in a .env file (local dev).');
    process.exit(1);
}

// ── Optional validation ─────────────────────────────────────────────

const INVITE_CODE_PRICE = process.env.INVITE_CODE_PRICE || '5.00';
if (isNaN(parseFloat(INVITE_CODE_PRICE)) || parseFloat(INVITE_CODE_PRICE) <= 0) {
    console.error('FATAL: INVITE_CODE_PRICE must be a positive number (e.g. "5.00").');
    process.exit(1);
}

// ── Exported config ─────────────────────────────────────────────────

module.exports = {
    encryptionKey:     Buffer.from(ENCRYPTION_KEY, 'hex'),
    sessionSecret:     SESSION_SECRET,
    adminUsername:     process.env.ADMIN_USERNAME     || 'admin',
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
    umamiWebsiteId:   process.env.UMAMI_WEBSITE_ID,
    geminiApiKey:      process.env.GEMINI_API_KEY,
    openaiApiKey:      process.env.OPENAI_API_KEY,
    port:              process.env.PORT               || 3000,
    smtpHost:          process.env.SMTP_HOST,
    smtpPort:          process.env.SMTP_PORT,
    smtpUser:          process.env.SMTP_USER,
    smtpPass:          process.env.SMTP_PASS,
    smtpFrom:          process.env.SMTP_FROM,
    paypalClientId:    process.env.PAYPAL_CLIENT_ID,
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET,
    paypalSandbox:     process.env.PAYPAL_SANDBOX !== 'false',
    inviteCodePrice:   INVITE_CODE_PRICE,
};
