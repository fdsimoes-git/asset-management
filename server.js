
const config = require('./config');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db/queries');
const { testConnection: testDbConnection } = require('./db/pool');
const multer = require('multer'); // For handling file uploads
const rateLimit = require('express-rate-limit');
const pdfParse = require('pdf-parse'); // For parsing PDF files
const { GoogleGenAI, Type } = require('@google/genai');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const otplib = require('otplib');
const QRCode = require('qrcode');

const app = express();

// Precomputed dummy bcrypt hash (cost factor 10) for constant-time comparison on unknown users
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8VS.wG.ZyWQ/2t6WvTDWv1Q5I8bHHy';

// Wrap async route handlers so rejected promises are forwarded to Express error middleware
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============ SMTP CONFIGURATION ============

let smtpTransport = null;
if (config.smtpHost && config.smtpPort && config.smtpUser && config.smtpPass && config.smtpFrom) {
    smtpTransport = nodemailer.createTransport({
        host: config.smtpHost,
        port: parseInt(config.smtpPort, 10),
        secure: parseInt(config.smtpPort, 10) === 465,
        auth: {
            user: config.smtpUser,
            pass: config.smtpPass
        }
    });
}

async function sendEmail(to, subject, text) {
    if (!smtpTransport) return false;
    try {
        await smtpTransport.sendMail({
            from: config.smtpFrom,
            to,
            subject,
            text
        });
        return true;
    } catch (error) {
        console.error('Failed to send email:', error.message);
        return false;
    }
}

// ============ PAYPAL CONFIGURATION ============

let paypalClient = null;
let ordersController = null;
if (config.paypalClientId && config.paypalClientSecret) {
    try {
        const { Client, Environment, OrdersController } = require('@paypal/paypal-server-sdk');
        paypalClient = new Client({
            clientCredentialsAuthCredentials: {
                oAuthClientId: config.paypalClientId,
                oAuthClientSecret: config.paypalClientSecret,
            },
            environment: config.paypalSandbox ? Environment.Sandbox : Environment.Production,
        });
        ordersController = new OrdersController(paypalClient);
    } catch (error) {
        console.error('Warning: Failed to initialize PayPal SDK:', error.message);
        paypalClient = null;
        ordersController = null;
    }
}

// Gemini AI model names (instances created per-request)
const GEMINI_MODEL = 'gemini-3-flash-preview';       // PDF processing & structured extraction
const GEMINI_CHAT_MODEL = 'gemini-3-flash-preview';   // AI chat advisor (can be changed independently)

// OpenAI model names
const OPENAI_MODEL = 'gpt-3.5-turbo';       // PDF processing & structured extraction
const OPENAI_CHAT_MODEL = 'gpt-3.5-turbo';  // AI chat advisor (can be changed independently)

// Anthropic model names
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';       // PDF processing & structured extraction
const ANTHROPIC_CHAT_MODEL = 'claude-sonnet-4-6';  // AI chat advisor (can be changed independently)

// GitHub Copilot model names — Copilot exposes models from multiple labs
// (OpenAI / Anthropic / Google) under one OpenAI-compatible endpoint billed
// against the user's Copilot subscription.  `gpt-4.1` is Copilot's current
// default chat model (May 2025+); see
// https://github.blog/changelog/2025-05-08-openai-gpt-4-1-is-now-generally-available-in-github-copilot-as-the-new-default-model/
const COPILOT_MODEL = 'gpt-4.1';        // PDF processing & structured extraction
const COPILOT_CHAT_MODEL = 'gpt-4.1';   // AI chat advisor (can be changed independently)

// Model list cache for /api/ai/models endpoint
const modelListCache = new Map(); // "provider:keyHash" → { models, timestamp }
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 min

const ALLOWED_AI_PROVIDERS = ['gemini', 'openai', 'anthropic', 'copilot'];

/** Normalize stored provider to an allowed value, defaulting to gemini. */
function resolveProvider(user) {
    return ALLOWED_AI_PROVIDERS.includes(user.aiProvider) ? user.aiProvider : 'gemini';
}

/**
 * Resolve AI model: user preference → hardcoded default.
 * @param {object} user - user object
 * @param {'openai'|'gemini'|'anthropic'} provider
 * @param {'chat'|'pdf'} usage
 */
function modelMatchesProvider(model, provider) {
    return (
        (provider === 'openai' && /^(gpt-|o[0-9]|chatgpt-)/i.test(model)) ||
        (provider === 'anthropic' && /^claude/i.test(model)) ||
        (provider === 'gemini' && /^(gemini|models\/)/i.test(model)) ||
        // Copilot exposes models from many labs (gpt-*, claude-*, gemini-*,
        // grok-*, o*, etc.) under one OpenAI-compatible endpoint, so we
        // accept any non-empty model id.
        (provider === 'copilot' && typeof model === 'string' && model.length > 0)
    );
}

function resolveModel(user, provider, usage) {
    // Only honour user-selected model if it belongs to the active provider
    if (user.aiModel && modelMatchesProvider(user.aiModel, provider)) {
        return user.aiModel;
    }
    if (provider === 'openai') {
        return usage === 'chat' ? OPENAI_CHAT_MODEL : OPENAI_MODEL;
    }
    if (provider === 'anthropic') {
        return usage === 'chat' ? ANTHROPIC_CHAT_MODEL : ANTHROPIC_MODEL;
    }
    if (provider === 'copilot') {
        return usage === 'chat' ? COPILOT_CHAT_MODEL : COPILOT_MODEL;
    }
    return usage === 'chat' ? GEMINI_CHAT_MODEL : GEMINI_MODEL;
}

const ENCRYPTION_KEY = config.encryptionKey;
const ALGORITHM = 'aes-256-cbc';

// Function to encrypt a raw string (for API keys)
function encryptString(value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { iv: iv.toString('hex'), encryptedData: encrypted };
}

// Function to decrypt a raw string (for API keys)
function decryptString(encryptedData, iv) {
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// ── Anthropic auth resolution ───────────────────────────────────────
//
// Anthropic supports two credential types:
//   1) A standard API key (sk-ant-api03-...) sent via x-api-key, billed to
//      the workspace's pay-as-you-go API credits.
//   2) A Claude Code OAuth token (sk-ant-oat01-...) generated by
//      `claude setup-token`, sent via `Authorization: Bearer ...` together
//      with the `anthropic-beta: oauth-2025-04-20` header. Calls billed to
//      the user's Claude Code subscription credits.
//
// Resolution order (highest priority first):
//   1. per-user encrypted OAuth token  (req.user.claudeOauthToken)
//   2. per-user encrypted API key       (req.user.anthropicApiKey)
//   3. env CLAUDE_CODE_OAUTH_TOKEN     (config.claudeOauthToken)
//   4. env ANTHROPIC_API_KEY           (config.anthropicApiKey)
//
// Returns { authToken, apiKey } where exactly one is non-null, or both null
// if no credentials are available.
const ANTHROPIC_OAUTH_BETA_HEADER = 'oauth-2025-04-20';

function resolveAnthropicAuth(user) {
    if (user && user.claudeOauthToken) {
        try {
            const authToken = decryptString(user.claudeOauthToken.encryptedData, user.claudeOauthToken.iv);
            if (authToken) return { authToken, apiKey: null };
        } catch (e) {
            console.error('Failed to decrypt stored Claude Code OAuth token:', e.message);
        }
    }
    if (user && user.anthropicApiKey) {
        try {
            const apiKey = decryptString(user.anthropicApiKey.encryptedData, user.anthropicApiKey.iv);
            if (apiKey) return { authToken: null, apiKey };
        } catch (e) {
            console.error('Failed to decrypt stored Anthropic API key:', e.message);
        }
    }
    if (config.claudeOauthToken) return { authToken: config.claudeOauthToken, apiKey: null };
    if (config.anthropicApiKey)  return { authToken: null, apiKey: config.anthropicApiKey };
    return { authToken: null, apiKey: null };
}

/**
 * Build an Anthropic SDK client for the given credentials. When using an
 * OAuth token the `anthropic-beta: oauth-2025-04-20` header is required
 * — NEVER send it with a regular API key.
 */
function createAnthropicClient({ authToken, apiKey }) {
    if (authToken) {
        return new Anthropic({
            authToken,
            apiKey: null,
            defaultHeaders: { 'anthropic-beta': ANTHROPIC_OAUTH_BETA_HEADER }
        });
    }
    return new Anthropic({ apiKey });
}

/** True if any Anthropic credential (per-user or env) is available for this user. */
function hasAnthropicCredentials(user) {
    const { authToken, apiKey } = resolveAnthropicAuth(user);
    return !!(authToken || apiKey);
}

// ── GitHub Copilot client ───────────────────────────────────────────
//
// GitHub Copilot exposes an OpenAI-compatible chat completions API at
// `https://api.githubcopilot.com`, but it requires:
//   1. A short-lived (~30 min) Copilot session token, obtained by exchanging
//      the user's long-lived GitHub OAuth token (gho_/ghu_/ghp_...) at
//      `GET https://api.github.com/copilot_internal/v2/token`.
//   2. A specific set of headers identifying the integration (Editor-Version,
//      Editor-Plugin-Version, Copilot-Integration-Id, etc.).
// All Copilot API usage is billed against the user's GitHub Copilot
// subscription. References (reverse-engineered, no public docs):
//   - github.com/ericc-ch/copilot-api/src/lib/api-config.ts
//   - github.com/farion1231/cc-switch/src-tauri/src/proxy/providers/copilot_auth.rs
const COPILOT_TOKEN_EXCHANGE_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_API_BASE_URL       = 'https://api.githubcopilot.com';
const COPILOT_EDITOR_VERSION     = 'AssetManager/2.4.0';
const COPILOT_PLUGIN_VERSION     = 'asset-management/0.1.0';
const COPILOT_USER_AGENT         = 'AssetManager/2.4.0';
const COPILOT_INTEGRATION_ID     = 'vscode-chat';
// Refresh the cached session token this many seconds before its real expiry
// to avoid races where the request fires just as it expires.
const COPILOT_TOKEN_SKEW_SECONDS = 60;

// In-memory cache of exchanged Copilot session tokens, keyed by a hash of the
// long-lived OAuth token (so env-token and per-user tokens never collide and
// nothing about the OAuth token itself is logged).
//   key:   sha256(oauthToken).slice(0,32)
//   value: { sessionToken: string, expiresAt: number /* unix seconds */ }
const copilotSessionCache = new Map();

function copilotCacheKey(oauthToken) {
    return crypto.createHash('sha256').update(oauthToken).digest('hex').slice(0, 32);
}

function copilotExchangeHeaders(oauthToken) {
    return {
        'Authorization':         `token ${oauthToken}`,
        'Accept':                'application/json',
        'User-Agent':            COPILOT_USER_AGENT,
        'Editor-Version':        COPILOT_EDITOR_VERSION,
        'Editor-Plugin-Version': COPILOT_PLUGIN_VERSION,
    };
}

function copilotApiHeaders(sessionToken) {
    return {
        'Editor-Version':        COPILOT_EDITOR_VERSION,
        'Editor-Plugin-Version': COPILOT_PLUGIN_VERSION,
        'User-Agent':            COPILOT_USER_AGENT,
        'Copilot-Integration-Id': COPILOT_INTEGRATION_ID,
        'OpenAI-Intent':         'conversation-panel',
    };
}

/** Resolve the long-lived Copilot OAuth token for this user (per-user > env). */
function resolveCopilotOauthToken(user) {
    if (user && user.githubCopilotToken) {
        try {
            const tok = decryptString(user.githubCopilotToken.encryptedData, user.githubCopilotToken.iv);
            if (tok) return tok;
        } catch (e) {
            console.error('Failed to decrypt stored GitHub Copilot OAuth token:', e.message);
        }
    }
    if (config.githubCopilotToken) return config.githubCopilotToken;
    return null;
}

function hasCopilotCredentials(user) {
    return !!resolveCopilotOauthToken(user);
}

/**
 * Exchange a GitHub OAuth token for a short-lived Copilot session token,
 * caching the result until it (almost) expires.  Set forceRefresh=true to
 * evict any cached entry first (e.g. on a 401 from the chat endpoint).
 */
async function getCopilotSessionToken(oauthToken, { forceRefresh = false } = {}) {
    const cacheKey = copilotCacheKey(oauthToken);
    const nowSec = Math.floor(Date.now() / 1000);

    if (!forceRefresh) {
        const cached = copilotSessionCache.get(cacheKey);
        if (cached && cached.expiresAt - COPILOT_TOKEN_SKEW_SECONDS > nowSec) {
            return cached.sessionToken;
        }
    } else {
        copilotSessionCache.delete(cacheKey);
    }

    const response = await fetch(COPILOT_TOKEN_EXCHANGE_URL, {
        method: 'GET',
        headers: copilotExchangeHeaders(oauthToken)
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        const err = new Error(`Copilot token exchange failed (${response.status}): ${body.slice(0, 200)}`);
        err.status = response.status;
        throw err;
    }
    const payload = await response.json();
    const sessionToken = payload.token;
    if (!sessionToken) {
        throw new Error('Copilot token exchange returned no token');
    }
    // The /copilot_internal/v2/token response includes `expires_at` (unix
    // seconds) and usually `refresh_in` (seconds until refresh is desirable).
    let expiresAt;
    if (typeof payload.expires_at === 'number') {
        expiresAt = payload.expires_at;
    } else if (typeof payload.refresh_in === 'number') {
        expiresAt = nowSec + payload.refresh_in;
    } else {
        expiresAt = nowSec + 25 * 60; // conservative 25 min fallback
    }

    // Cap cache size at 200 entries to avoid unbounded growth.
    if (copilotSessionCache.size >= 200) {
        const oldestKey = copilotSessionCache.keys().next().value;
        copilotSessionCache.delete(oldestKey);
    }
    copilotSessionCache.set(cacheKey, { sessionToken, expiresAt });
    return sessionToken;
}

/**
 * Build an OpenAI SDK client pointed at the GitHub Copilot endpoint, using a
 * freshly-resolved (and cached) session token as the bearer credential.
 *
 * Returns { client, oauthToken, sessionToken } so callers can re-build the
 * client after a forced refresh on 401.  Throws if no OAuth token is
 * configured, or if the token exchange fails.
 */
async function createCopilotClient(user, { forceRefresh = false } = {}) {
    const oauthToken = resolveCopilotOauthToken(user);
    if (!oauthToken) {
        const e = new Error('No GitHub Copilot OAuth token configured');
        e.code = 'no_copilot_token';
        throw e;
    }
    const sessionToken = await getCopilotSessionToken(oauthToken, { forceRefresh });
    const client = new OpenAI({
        apiKey:   sessionToken,
        baseURL:  COPILOT_API_BASE_URL,
        defaultHeaders: copilotApiHeaders(sessionToken)
    });
    return { client, oauthToken, sessionToken };
}

/**
 * Wrap a Copilot API call with one automatic retry after a forced session
 * token refresh on 401 (the cached short-lived token may have expired or
 * been revoked).  `fn` receives the OpenAI client.
 */
async function copilotCallWithRetry(user, fn) {
    let { client } = await createCopilotClient(user);
    try {
        return await fn(client);
    } catch (err) {
        const status = err.status || err.statusCode || (err.response && err.response.status);
        if (status === 401) {
            ({ client } = await createCopilotClient(user, { forceRefresh: true }));
            return await fn(client);
        }
        throw err;
    }
}

/** Fetch the Copilot-served model list (OpenAI-compatible /models response). */
async function listCopilotModels(user) {
    return copilotCallWithRetry(user, async (client) => {
        const list = await client.models.list();
        const models = [];
        for (const model of list.data || []) {
            // The Copilot /models endpoint returns objects with shape
            // { id, name, vendor, capabilities: { type: 'chat'|... }, ... }.
            if (model.capabilities && model.capabilities.type && model.capabilities.type !== 'chat') continue;
            const id = model.id || model.name;
            if (!id) continue;
            const displayName = model.name || id;
            models.push({ id, name: displayName });
        }
        return models;
    });
}


// ============ USER STORAGE SYSTEM (PostgreSQL) ============

// ============ BRUTE-FORCE PROTECTION ============

const failedLoginAttempts = new Map();

const LOCKOUT_THRESHOLDS = [
    { attempts: 10, duration: 60 * 60 * 1000 },    // 10 failures -> 1 hour
    { attempts: 5,  duration: 15 * 60 * 1000 }      // 5 failures -> 15 minutes
];

function getLoginLockStatus(username) {
    const key = username.toLowerCase();
    const record = failedLoginAttempts.get(key);
    if (!record) return { locked: false };

    if (record.lockedUntil && Date.now() < record.lockedUntil) {
        return { locked: true };
    }

    // Lockout expired: reset count so user gets a fresh set of attempts
    if (record.lockedUntil && Date.now() >= record.lockedUntil) {
        record.lockedUntil = null;
        record.count = 0;
    }
    return { locked: false };
}

function recordFailedLogin(username) {
    const key = username.toLowerCase();
    const now = Date.now();
    let record = failedLoginAttempts.get(key);
    if (!record) {
        record = { count: 0, lockedUntil: null, lastAttempt: now };
        failedLoginAttempts.set(key, record);
    }
    record.count++;
    record.lastAttempt = now;
    // Find the maximum applicable lockout duration
    let maxDuration = 0;
    for (const threshold of LOCKOUT_THRESHOLDS) {
        if (record.count >= threshold.attempts && threshold.duration > maxDuration) {
            maxDuration = threshold.duration;
        }
    }
    if (maxDuration > 0) {
        record.lockedUntil = now + maxDuration;
    }
}

function resetFailedLogins(username) {
    failedLoginAttempts.delete(username.toLowerCase());
}

// Cleanup stale records every 30 minutes
setInterval(() => {
    const now = Date.now();
    const STALE_THRESHOLD = 60 * 60 * 1000; // 1 hour
    for (const [key, record] of failedLoginAttempts.entries()) {
        // Remove expired lockouts and stale records with no lockout
        if (record.lockedUntil && now >= record.lockedUntil) {
            failedLoginAttempts.delete(key);
        } else if (!record.lockedUntil && (now - record.lastAttempt) > STALE_THRESHOLD) {
            failedLoginAttempts.delete(key);
        }
    }
}, 30 * 60 * 1000);

// ============ PASSWORD RESET CODE SYSTEM ============

const resetCodes = new Map();
const RESET_CODE_EXPIRY = 15 * 60 * 1000; // 15 minutes
const resetAttempts = new Map(); // per-(username|ip) failed reset code attempts
const MAX_RESET_ATTEMPTS = 5;
const RESET_ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

function generateResetCode() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += alphabet[bytes[i] % alphabet.length];
    }
    return code;
}

function createResetCode(userId) {
    // Invalidate any prior code for this user
    for (const [code, data] of resetCodes.entries()) {
        if (data.userId === userId) {
            resetCodes.delete(code);
        }
    }

    let code;
    do {
        code = generateResetCode();
    } while (resetCodes.has(code));

    resetCodes.set(code, {
        userId,
        createdAt: Date.now(),
        used: false
    });
    return code;
}

function consumeResetCode(code) {
    const data = resetCodes.get(code.toUpperCase());
    if (!data) return null;
    if (data.used) return null;
    if (Date.now() - data.createdAt > RESET_CODE_EXPIRY) {
        resetCodes.delete(code.toUpperCase());
        return null;
    }
    data.used = true;
    return data.userId;
}

function checkAndRecordResetAttempt(username, ip) {
    const key = `${username.toLowerCase()}|${ip}`;
    const now = Date.now();
    let record = resetAttempts.get(key);
    if (record && (now - record.firstAttempt) > RESET_ATTEMPT_WINDOW) {
        resetAttempts.delete(key);
        record = undefined;
    }
    if (record && record.count >= MAX_RESET_ATTEMPTS) {
        return false; // too many attempts
    }
    if (record) {
        record.count++;
    } else {
        resetAttempts.set(key, { count: 1, firstAttempt: now });
    }
    return true; // attempt allowed
}

function clearResetAttempts(username) {
    const prefix = `${username.toLowerCase()}|`;
    for (const key of resetAttempts.keys()) {
        if (key.startsWith(prefix)) {
            resetAttempts.delete(key);
        }
    }
}

// Cleanup expired reset codes and attempt records every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, data] of resetCodes.entries()) {
        if (now - data.createdAt > RESET_CODE_EXPIRY) {
            resetCodes.delete(code);
        }
    }
    for (const [key, record] of resetAttempts.entries()) {
        if (now - record.firstAttempt > RESET_ATTEMPT_WINDOW) {
            resetAttempts.delete(key);
        }
    }
}, 15 * 60 * 1000);

// ============ INVITE CODE SYSTEM ============

function generateInviteCode() {
    return crypto.randomBytes(6).toString('base64url').substring(0, 8).toUpperCase();
}

async function createInviteCodeHelper(createdBy) {
    for (let attempts = 0; attempts < 10; attempts++) {
        const code = generateInviteCode();
        const created = await db.createInviteCodeIfNotExists(code, createdBy);
        if (created) return created;
    }
    throw new Error('Failed to generate unique invite code after 10 attempts');
}

// Migration: Create initial admin user from env vars if no users exist
async function migrateInitialAdmin() {
    const allUsers = await db.getAllUsers();
    if (allUsers.length === 0) {
        const adminUsername = config.adminUsername;
        const adminPasswordHash = config.adminPasswordHash;

        if (adminPasswordHash) {
            await db.createUser({
                username: adminUsername,
                passwordHash: adminPasswordHash,
                role: 'admin',
                isActive: true
            });
            console.log(`Migrated admin user: ${adminUsername}`);
        }
    }
}

// ============ COUPLE MANAGEMENT HELPERS ============

// Link two users as a couple (validation wrapper around db.linkCouple)
async function linkCouple(userId1, userId2) {
    const user1 = await db.findUserById(userId1);
    const user2 = await db.findUserById(userId2);

    if (!user1 || !user2) {
        throw new Error('One or both users not found');
    }

    if (!user1.isActive || !user2.isActive) {
        throw new Error('Cannot link inactive users');
    }

    if (user1.partnerId || user2.partnerId) {
        throw new Error('One or both users already have a partner');
    }

    if (userId1 === userId2) {
        throw new Error('Cannot link user to themselves');
    }

    const now = new Date().toISOString();
    await db.linkCouple(userId1, userId2, now);

    // Reload users for the response
    const updated1 = await db.findUserById(userId1);
    const updated2 = await db.findUserById(userId2);
    return { user1: updated1, user2: updated2, linkedAt: now };
}

// ============ PENDING 2FA SESSIONS ============

const pending2FASessions = new Map();
const PENDING_2FA_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Cleanup expired pending 2FA sessions every minute
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of pending2FASessions.entries()) {
        if (now - session.createdAt > PENDING_2FA_EXPIRY) {
            pending2FASessions.delete(token);
        }
    }
}, 60 * 1000);

// Security middleware
app.use(helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cloud.umami.is", "https://*.paypal.com", "https://static.cloudflareinsights.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", "https://cloud.umami.is", "https://api-gateway.umami.dev", "https://cdn.jsdelivr.net", "https://*.paypal.com", "https://cloudflareinsights.com"],
            imgSrc: ["'self'", "data:", "https://*.paypal.com", "https://*.paypalobjects.com"],
            frameSrc: ["https://*.paypal.com"],
            objectSrc: ["'none'"],
            frameAncestors: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"]
        }
    }
}));
app.use(express.json());

// Block access to sensitive files and directories before static middleware
app.use((req, res, next) => {
    const requestPath = decodeURIComponent(req.path).toLowerCase();
    // Block dotfiles (.env, .git, etc.)
    if (/\/\./.test(requestPath)) {
        return res.status(404).end();
    }
    // Block sensitive files and directories
    const blocked = [
        '/server.js', '/config.js', '/package.json', '/package-lock.json',
        '/backup.sh', '/deploy.sh', '/rotate-key.sh', '/rotate-encryption-key.js', '/capacitor.config.json',
        '/data', '/db', '/ssl', '/certs', '/node_modules', '/ios', '/www'
    ];
    if (blocked.some(p => requestPath === p || requestPath.startsWith(p + '/'))) {
        return res.status(404).end();
    }
    next();
});

// Serve HTML pages with Umami analytics injection (if configured) and
// cache-busting query strings on local JS/CSS references. Each page's
// final body is rendered once at startup and cached in memory, so the
// request path never touches the disk or re-runs the rewrites.
const UMAMI_WEBSITE_ID = config.umamiWebsiteId;
const BUILD_ID = Date.now().toString(36);
const htmlPages = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/login.html': 'login.html',
    '/register.html': 'register.html',
    '/forgot-password.html': 'forgot-password.html'
};

function injectCacheBust(html) {
    // Only rewrite local asset references; leave absolute URLs alone.
    return html
        .replace(/(<script\b[^>]*\bsrc=")(\/[^"?]+\.js)(")/g, `$1$2?v=${BUILD_ID}$3`)
        .replace(/(<link\b[^>]*\bhref=")(\/[^"?]+\.css)(")/g, `$1$2?v=${BUILD_ID}$3`);
}

// Pre-render each HTML page once at startup. We dedupe by source file so
// identical routes ('/' and '/index.html') share the same cached body.
const htmlCache = {};
for (const file of new Set(Object.values(htmlPages))) {
    let html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    if (UMAMI_WEBSITE_ID) {
        const script = `<script defer src="https://cloud.umami.is/script.js" data-website-id="${UMAMI_WEBSITE_ID}"></script>`;
        html = html.replace('</head>', `    ${script}\n</head>`);
    }
    htmlCache[file] = injectCacheBust(html);
}

Object.entries(htmlPages).forEach(([route, file]) => {
    app.get(route, (req, res) => {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.type('html').send(htmlCache[file]);
    });
});

app.use(express.static(__dirname, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
        if (path.extname(filePath).toLowerCase() === '.html') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// Trust Nginx proxy
app.set('trust proxy', 1);

// Session configuration
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV !== 'development',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// ============ CSRF PROTECTION ============

// Generate a CSRF token per session
app.get('/api/csrf-token', (req, res) => {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json({ csrfToken: req.session.csrfToken });
});

// Validate CSRF token on state-changing requests
app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    // Skip CSRF only for external callbacks (PayPal) that cannot carry a session token
    if (req.path === '/api/paypal/create-order' || req.path.startsWith('/api/paypal/capture-order/')) {
        return next();
    }
    const token = req.headers['x-csrf-token'];
    const sessionToken = req.session.csrfToken;
    if (!token || !sessionToken) {
        return res.status(403).json({ message: 'Invalid or missing CSRF token' });
    }
    try {
        const tokenBuffer = Buffer.from(token, 'hex');
        const sessionTokenBuffer = Buffer.from(sessionToken, 'hex');
        if (tokenBuffer.length !== sessionTokenBuffer.length ||
            !crypto.timingSafeEqual(tokenBuffer, sessionTokenBuffer)) {
            return res.status(403).json({ message: 'Invalid or missing CSRF token' });
        }
    } catch (e) {
        return res.status(403).json({ message: 'Invalid or missing CSRF token' });
    }
    next();
});

// Rate limiting
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts. Please try again later.' }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many registration attempts. Please try again later.' }
});

const pdfUploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many upload attempts. Please try again later.' },
    keyGenerator: (req, res) => req.session?.user?.id?.toString() || rateLimit.ipKeyGenerator(req, res)
});

const paypalOrderLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many order requests. Please try again later.' }
});

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'If an account with that username exists and has an email on file, a reset code has been sent.' }
});

const totpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many verification attempts. Please try again later.' }
});

const chatRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many chat messages. Please try again later.' },
    keyGenerator: (req, res) => req.session?.user?.id?.toString() || rateLimit.ipKeyGenerator(req, res)
});

const aiModelsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many model listing requests. Please try again later.' },
    keyGenerator: (req, res) => req.session?.user?.id?.toString() || rateLimit.ipKeyGenerator(req, res)
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
    skip: (req) => req.session && req.session.user
});

app.use('/api/', generalLimiter);

// Authentication middleware with short-lived user cache to avoid DB hit on every request
const userCache = new Map();
const USER_CACHE_TTL = 5000; // 5 seconds

function getCachedUser(id) {
    const key = Number(id);
    const cached = userCache.get(key);
    if (!cached) return undefined;
    if (Date.now() - cached.ts < USER_CACHE_TTL) return cached.user;
    userCache.delete(key);
    return undefined;
}

function setCachedUser(user) {
    userCache.set(Number(user.id), { user, ts: Date.now() });
}

function invalidateCachedUser(id) {
    userCache.delete(Number(id));
}

// Auto-invalidate user cache on writes
const _origUpdateUser = db.updateUser;
db.updateUser = async function(userId, ...args) {
    const result = await _origUpdateUser.call(this, userId, ...args);
    invalidateCachedUser(userId);
    return result;
};
const _origDeleteUser = db.deleteUser;
db.deleteUser = async function(userId, ...args) {
    invalidateCachedUser(userId);
    return _origDeleteUser.call(this, userId, ...args);
};
const _origLinkCouple = db.linkCouple;
db.linkCouple = async function(id1, id2, ...args) {
    const result = await _origLinkCouple.call(this, id1, id2, ...args);
    invalidateCachedUser(id1);
    invalidateCachedUser(id2);
    return result;
};
const _origUnlinkCouple = db.unlinkCouple;
db.unlinkCouple = async function(userId, ...args) {
    const result = await _origUnlinkCouple.call(this, userId, ...args);
    invalidateCachedUser(userId);
    // Also invalidate the partner — unlinkCouple clears both sides
    for (const [, cached] of userCache) {
        if (cached.user && cached.user.partnerId === userId) invalidateCachedUser(cached.user.id);
    }
    return result;
};

const requireAuth = async (req, res, next) => {
    if (req.session && req.session.user && req.session.user.id) {
        try {
            const userId = req.session.user.id;
            let user = getCachedUser(userId);
            if (user === undefined) {
                user = await db.findUserById(userId);
                if (user) setCachedUser(user);
            }
            if (user && user.isActive) {
                req.user = user;
                return next();
            }
            // User not found or inactive — session is genuinely invalid
            req.session.destroy();
            return res.status(401).json({ message: 'Session invalid. Please log in again.' });
        } catch (err) {
            // Transient DB error — don't destroy the session, just fail the request
            console.error('Auth middleware DB error:', err.message);
            return res.status(503).json({ message: 'Service temporarily unavailable. Please try again.' });
        }
    }
    res.status(401).json({ message: 'Unauthorized' });
};

// Admin-only middleware
const requireAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    res.status(403).json({ message: 'Admin access required' });
};

// Login endpoint
app.post('/api/login', loginLimiter, asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    // Check brute-force lockout before any password check
    const lockStatus = getLoginLockStatus(username);
    if (lockStatus.locked) {
        // Perform a dummy hash comparison to prevent timing-based user enumeration
        await bcrypt.compare(password, DUMMY_HASH);
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = await db.findUserByUsername(username);

    // Always perform a bcrypt compare to prevent timing-based user enumeration
    const passwordValid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    if (user && user.isActive && passwordValid) {
        resetFailedLogins(username);

        // Check if user has 2FA enabled
        if (user.totpEnabled && user.totpSecret) {
            const tempToken = crypto.randomBytes(32).toString('hex');
            pending2FASessions.set(tempToken, {
                userId: user.id,
                createdAt: Date.now()
            });
            return res.json({ requires2FA: true, tempToken });
        }

        const userData = { id: user.id, username: user.username, role: user.role };

        // Session fixation prevention: regenerate session ID on login
        req.session.regenerate((err) => {
            if (err) {
                console.error('Session regeneration error:', err);
                return res.status(500).json({ message: 'Login failed' });
            }
            req.session.user = userData;
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ message: 'Login failed' });
                }
                res.json({ message: 'Login successful', user: userData });
            });
        });
    } else {
        recordFailedLogin(username);
        res.status(401).json({ message: 'Invalid credentials' });
    }
}));

// Registration endpoint
app.post('/api/register', registerLimiter, asyncHandler(async (req, res) => {
    const { username, email, password, confirmPassword, inviteCode } = req.body;

    // Validation
    if (!username || !email || !password || !confirmPassword || !inviteCode
        || typeof username !== 'string' || typeof email !== 'string'
        || typeof password !== 'string'
        || typeof confirmPassword !== 'string' || typeof inviteCode !== 'string') {
        return res.status(400).json({ message: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    if (email.length > 254 || /[<>]/.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate invite code before expensive operations
    const invite = await db.findInviteCode(inviteCode);
    if (!invite || invite.isUsed) {
        return res.status(400).json({ message: 'Invalid or expired invite code' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (username.length < 3 || username.length > 30) {
        return res.status(400).json({ message: 'Username must be 3-30 characters' });
    }

    if (password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Check for valid username characters
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ message: 'Username can only contain letters, numbers, and underscores' });
    }

    // Check if username already exists
    if (await db.findUserByUsername(username)) {
        return res.status(409).json({ message: 'Username already taken' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        // Atomic transaction: consume invite code + create user + set used_by
        const newUser = await db.registerWithInviteCode(inviteCode, {
            username: username,
            email: encryptString(email),
            passwordHash: passwordHash,
            role: 'user',
            isActive: true,
            totpSecret: null,
            totpEnabled: false,
            backupCodes: []
        });

        if (!newUser) {
            return res.status(409).json({ message: 'Invalid or already used invite code' });
        }

        res.status(201).json({
            message: 'Registration successful',
            user: {
                id: newUser.id,
                username: newUser.username,
                role: newUser.role
            }
        });
    } catch (error) {
        // Rollback: unconsume the invite code if registration failed after consumption
        await db.rollbackInviteCode(inviteCode);
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed' });
    }
}));

// Forgot password endpoint
app.post('/api/forgot-password', forgotPasswordLimiter, asyncHandler(async (req, res) => {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        return res.json({ message: 'If an account with that username exists and has an email on file, a reset code has been sent.' });
    }

    // Always return the same generic message to prevent user enumeration
    const genericMessage = 'If an account with that username exists and has an email on file, a reset code has been sent.';

    // Respond immediately, then do all user-dependent work in background
    // to prevent timing-based user enumeration
    res.json({ message: genericMessage });

    setImmediate(async () => {
        try {
            const user = await db.findUserByUsername(username);
            if (user && user.isActive && user.email && smtpTransport) {
                const email = decryptString(user.email.encryptedData, user.email.iv);
                const code = createResetCode(user.id);
                sendEmail(
                    email,
                    'Password Reset Code - Asset Manager',
                    `Your password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you did not request this, you can safely ignore this email.`
                ).catch(error => {
                    console.error('Error sending reset email:', error.message);
                });
            }
        } catch (error) {
            console.error('Error in forgot-password flow:', error.message);
        }
    });
}));

// Reset password endpoint
app.post('/api/reset-password', loginLimiter, asyncHandler(async (req, res) => {
    const { username, code, newPassword } = req.body;

    if (!username || !code || !newPassword
        || typeof username !== 'string' || typeof code !== 'string' || typeof newPassword !== 'string') {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Per-(username + IP) attempt tracking to prevent reset code brute-force and limit DoS impact
    if (!checkAndRecordResetAttempt(username, req.ip)) {
        return res.status(429).json({ message: 'Too many failed reset attempts. Please request a new code.' });
    }

    // Validate username and active status before consuming the code
    // to prevent an attacker from burning valid codes via wrong usernames
    const user = await db.findUserByUsername(username);

    if (!user || !user.isActive) {
        return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    const userId = consumeResetCode(code);
    if (!userId || user.id !== userId) {
        return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    try {
        await db.updateUser(user.id, {
            passwordHash: await bcrypt.hash(newPassword, 10),
            updatedAt: new Date().toISOString()
        });

        // Clear brute-force lockouts since user proved identity via email
        resetFailedLogins(username);
        clearResetAttempts(username);

        res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Failed to reset password' });
    }
}));

// Get current user info
app.get('/api/user', requireAuth, asyncHandler(async (req, res) => {
    const response = {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        partnerId: null,
        partnerLinkedAt: null,
        partnerUsername: null,
        hasGeminiApiKey: !!(req.user.geminiApiKey && req.user.geminiApiKey.iv && req.user.geminiApiKey.encryptedData),
        hasOpenaiApiKey: !!(req.user.openaiApiKey && req.user.openaiApiKey.iv && req.user.openaiApiKey.encryptedData),
        hasAnthropicApiKey: !!(req.user.anthropicApiKey && req.user.anthropicApiKey.iv && req.user.anthropicApiKey.encryptedData),
        hasClaudeOauthToken: !!(req.user.claudeOauthToken && req.user.claudeOauthToken.iv && req.user.claudeOauthToken.encryptedData),
        hasGithubCopilotToken: !!(req.user.githubCopilotToken && req.user.githubCopilotToken.iv && req.user.githubCopilotToken.encryptedData),
        hasGeminiKeyAvailable: !!(req.user.geminiApiKey && req.user.geminiApiKey.iv && req.user.geminiApiKey.encryptedData) || !!config.geminiApiKey,
        hasOpenaiKeyAvailable: !!(req.user.openaiApiKey && req.user.openaiApiKey.iv && req.user.openaiApiKey.encryptedData) || !!config.openaiApiKey,
        hasAnthropicKeyAvailable: hasAnthropicCredentials(req.user),
        hasCopilotKeyAvailable: hasCopilotCredentials(req.user),
        aiProvider: resolveProvider(req.user),
        aiModel: req.user.aiModel || null,
        has2FA: !!req.user.totpEnabled
    };

    // Include partner info only if partner exists and is mutually linked
    if (req.user.partnerId) {
        const partner = await db.findUserById(req.user.partnerId);
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            response.partnerId = req.user.partnerId;
            response.partnerLinkedAt = req.user.partnerLinkedAt;
            response.partnerUsername = partner.username;
        }
    }

    res.json(response);
}));

// Save Gemini API key (encrypted)
app.post('/api/user/gemini-key', requireAuth, asyncHandler(async (req, res) => {
    const { geminiApiKey } = req.body;

    if (!geminiApiKey || typeof geminiApiKey !== 'string') {
        return res.status(400).json({ message: 'API key is required.' });
    }

    const trimmed = geminiApiKey.trim();
    if (trimmed.length < 30 || trimmed.length > 60) {
        return res.status(400).json({ message: 'API key must be between 30 and 60 characters.' });
    }

    await db.updateUser(req.user.id, { geminiApiKey: encryptString(trimmed), updatedAt: new Date().toISOString() });

    res.json({ message: 'Gemini API key saved successfully.', hasGeminiApiKey: true, hasGeminiKeyAvailable: true });
}));

// Remove saved Gemini API key
app.delete('/api/user/gemini-key', requireAuth, asyncHandler(async (req, res) => {
    await db.updateUser(req.user.id, { geminiApiKey: null, updatedAt: new Date().toISOString() });

    res.json({ message: 'Gemini API key removed.', hasGeminiApiKey: false, hasGeminiKeyAvailable: !!config.geminiApiKey });
}));

// Save OpenAI API key (encrypted)
app.post('/api/user/openai-key', requireAuth, asyncHandler(async (req, res) => {
    const { openaiApiKey } = req.body;

    if (!openaiApiKey || typeof openaiApiKey !== 'string') {
        return res.status(400).json({ message: 'API key is required.' });
    }

    const trimmed = openaiApiKey.trim();
    if (trimmed.length < 30 || trimmed.length > 200) {
        return res.status(400).json({ message: 'API key must be between 30 and 200 characters.' });
    }

    await db.updateUser(req.user.id, { openaiApiKey: encryptString(trimmed), updatedAt: new Date().toISOString() });

    res.json({ message: 'OpenAI API key saved successfully.', hasOpenaiApiKey: true, hasOpenaiKeyAvailable: true });
}));

// Remove saved OpenAI API key
app.delete('/api/user/openai-key', requireAuth, asyncHandler(async (req, res) => {
    await db.updateUser(req.user.id, { openaiApiKey: null, updatedAt: new Date().toISOString() });

    res.json({ message: 'OpenAI API key removed.', hasOpenaiApiKey: false, hasOpenaiKeyAvailable: !!config.openaiApiKey });
}));

// Save Anthropic API key (encrypted)
app.post('/api/user/anthropic-key', requireAuth, asyncHandler(async (req, res) => {
    const { anthropicApiKey } = req.body;

    if (!anthropicApiKey || typeof anthropicApiKey !== 'string') {
        return res.status(400).json({ message: 'API key is required.' });
    }

    const trimmed = anthropicApiKey.trim();
    if (trimmed.length < 30 || trimmed.length > 200) {
        return res.status(400).json({ message: 'API key must be between 30 and 200 characters.' });
    }

    await db.updateUser(req.user.id, { anthropicApiKey: encryptString(trimmed), updatedAt: new Date().toISOString() });

    res.json({ message: 'Anthropic API key saved successfully.', hasAnthropicApiKey: true, hasAnthropicKeyAvailable: true });
}));

// Remove saved Anthropic API key
app.delete('/api/user/anthropic-key', requireAuth, asyncHandler(async (req, res) => {
    await db.updateUser(req.user.id, { anthropicApiKey: null, updatedAt: new Date().toISOString() });

    const updatedUser = await db.findUserById(req.user.id);
    res.json({
        message: 'Anthropic API key removed.',
        hasAnthropicApiKey: false,
        hasAnthropicKeyAvailable: hasAnthropicCredentials(updatedUser)
    });
}));

// ── Claude Code OAuth token (sk-ant-oat01-...) — issue #47 ──
// Generated by `claude setup-token` from the Claude Code CLI. When set,
// Anthropic API calls are billed against the user's Claude Code subscription
// instead of pay-as-you-go API credits. Takes precedence over an API key
// stored on the same user (see resolveAnthropicAuth).

// Get whether an OAuth token is configured (boolean only — never echo the token)
app.get('/api/user/claude-oauth-token', requireAuth, asyncHandler(async (req, res) => {
    res.json({
        hasToken: !!(req.user.claudeOauthToken && req.user.claudeOauthToken.iv && req.user.claudeOauthToken.encryptedData),
        hasEnvToken: !!config.claudeOauthToken
    });
}));

// Save Claude Code OAuth token (encrypted)
app.post('/api/user/claude-oauth-token', requireAuth, asyncHandler(async (req, res) => {
    const { claudeOauthToken } = req.body;

    if (!claudeOauthToken || typeof claudeOauthToken !== 'string') {
        return res.status(400).json({ message: 'OAuth token is required.' });
    }

    const trimmed = claudeOauthToken.trim();
    if (trimmed.length < 30 || trimmed.length > 400) {
        return res.status(400).json({ message: 'OAuth token must be between 30 and 400 characters.' });
    }
    if (!trimmed.startsWith('sk-ant-oat')) {
        return res.status(400).json({
            message: 'This does not look like a Claude Code OAuth token. Tokens generated by `claude setup-token` start with "sk-ant-oat01-". For a regular API key (sk-ant-api...), use the Anthropic API key field instead.'
        });
    }

    await db.updateUser(req.user.id, { claudeOauthToken: encryptString(trimmed), updatedAt: new Date().toISOString() });

    res.json({
        message: 'Claude Code OAuth token saved successfully.',
        hasClaudeOauthToken: true,
        hasAnthropicKeyAvailable: true
    });
}));

// Remove saved Claude Code OAuth token
app.delete('/api/user/claude-oauth-token', requireAuth, asyncHandler(async (req, res) => {
    await db.updateUser(req.user.id, { claudeOauthToken: null, updatedAt: new Date().toISOString() });

    const updatedUser = await db.findUserById(req.user.id);
    res.json({
        message: 'Claude Code OAuth token removed.',
        hasClaudeOauthToken: false,
        hasAnthropicKeyAvailable: hasAnthropicCredentials(updatedUser)
    });
}));

// ── GitHub Copilot OAuth token (gho_/ghu_/ghp_...) ──
// Long-lived GitHub OAuth token belonging to a Copilot-subscribed account.
// Exchanged at request time for a short-lived Copilot session token (cached
// per token in copilotSessionCache).  All Copilot API usage is billed against
// the user's Copilot subscription rather than any pay-as-you-go AI key.

// Get whether a Copilot token is configured (boolean only — never echo the token)
app.get('/api/user/github-copilot-token', requireAuth, asyncHandler(async (req, res) => {
    res.json({
        hasToken: !!(req.user.githubCopilotToken && req.user.githubCopilotToken.iv && req.user.githubCopilotToken.encryptedData),
        hasEnvToken: !!config.githubCopilotToken
    });
}));

// Save GitHub Copilot OAuth token (encrypted)
app.post('/api/user/github-copilot-token', requireAuth, asyncHandler(async (req, res) => {
    const { githubCopilotToken } = req.body;

    if (!githubCopilotToken || typeof githubCopilotToken !== 'string') {
        return res.status(400).json({ message: 'OAuth token is required.' });
    }

    const trimmed = githubCopilotToken.trim();
    if (trimmed.length < 20 || trimmed.length > 400) {
        return res.status(400).json({ message: 'OAuth token must be between 20 and 400 characters.' });
    }
    if (!/^(gho_|ghu_|ghp_)/.test(trimmed)) {
        return res.status(400).json({
            message: 'This does not look like a GitHub OAuth token. Tokens issued by GitHub start with "gho_", "ghu_", or "ghp_". Get one by signing in to a GitHub account that has an active Copilot subscription.'
        });
    }

    await db.updateUser(req.user.id, { githubCopilotToken: encryptString(trimmed), updatedAt: new Date().toISOString() });

    res.json({
        message: 'GitHub Copilot OAuth token saved successfully.',
        hasGithubCopilotToken: true,
        hasCopilotKeyAvailable: true
    });
}));

// Remove saved GitHub Copilot OAuth token
app.delete('/api/user/github-copilot-token', requireAuth, asyncHandler(async (req, res) => {
    // Evict any cached session token derived from the user's stored OAuth token.
    if (req.user.githubCopilotToken) {
        try {
            const oauth = decryptString(req.user.githubCopilotToken.encryptedData, req.user.githubCopilotToken.iv);
            if (oauth) copilotSessionCache.delete(copilotCacheKey(oauth));
        } catch (e) { /* ignore */ }
    }

    await db.updateUser(req.user.id, { githubCopilotToken: null, updatedAt: new Date().toISOString() });

    const updatedUser = await db.findUserById(req.user.id);
    res.json({
        message: 'GitHub Copilot OAuth token removed.',
        hasGithubCopilotToken: false,
        hasCopilotKeyAvailable: hasCopilotCredentials(updatedUser)
    });
}));


// Save AI provider preference
app.put('/api/user/ai-provider', requireAuth, asyncHandler(async (req, res) => {
    const { aiProvider } = req.body;

    if (!aiProvider || !ALLOWED_AI_PROVIDERS.includes(aiProvider)) {
        return res.status(400).json({ message: 'aiProvider must be "gemini", "openai", "anthropic", or "copilot".' });
    }

    await db.updateUser(req.user.id, { aiProvider, aiModel: null, updatedAt: new Date().toISOString() });

    res.json({ message: 'AI provider saved.', aiProvider, aiModel: null });
}));

// List available AI models for the user's current provider
app.get('/api/ai/models', requireAuth, aiModelsLimiter, asyncHandler(async (req, res) => {
    const provider = resolveProvider(req.user);

    // ── Anthropic: handled separately because credentials may be either an
    //    API key (x-api-key) or a Claude Code OAuth token (Bearer + beta header).
    if (provider === 'anthropic') {
        const auth = resolveAnthropicAuth(req.user);
        if (!auth.authToken && !auth.apiKey) {
            return res.json({ provider, models: [], selectedModel: null });
        }
        const credKey = auth.authToken ? ('oat:' + auth.authToken) : ('key:' + auth.apiKey);
        const keyHash = crypto.createHash('sha256').update(credKey).digest('hex').slice(0, 16);
        const cacheKey = provider + ':' + keyHash;
        const cached = modelListCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < MODEL_CACHE_TTL) {
            const selectedModel = (req.user.aiModel && modelMatchesProvider(req.user.aiModel, provider)) ? req.user.aiModel : null;
            return res.json({ provider, models: cached.models, selectedModel });
        }
        try {
            const anthropicClient = createAnthropicClient(auth);
            const response = await anthropicClient.models.list({ limit: 100 });
            const models = [];
            for (const model of response.data) {
                const displayName = model.display_name || model.id;
                models.push({ id: model.id, name: displayName });
            }
            models.sort((a, b) => a.name.localeCompare(b.name));
            modelListCache.set(cacheKey, { models, timestamp: Date.now() });
            const selectedModel = (req.user.aiModel && modelMatchesProvider(req.user.aiModel, provider)) ? req.user.aiModel : null;
            return res.json({ provider, models, selectedModel });
        } catch (err) {
            const upstreamStatus = err && (err.status || err.statusCode || (err.response && err.response.status));
            console.error('Anthropic models.list failed:', err.message, 'status:', upstreamStatus);
            if (upstreamStatus === 401 || upstreamStatus === 403) {
                return res.status(400).json({ message: 'Invalid or unauthorized Anthropic credentials.', error: 'auth_error' });
            }
            if (upstreamStatus === 429) {
                return res.status(429).json({ message: 'Rate limit exceeded. Please try again later.', error: 'rate_limited' });
            }
            return res.status(500).json({ message: 'Failed to fetch model list.', error: 'fetch_failed' });
        }
    }

    // ── Copilot: OpenAI-compatible endpoint, but credentials are a GitHub
    //    OAuth token exchanged at request time for a Copilot session token.
    if (provider === 'copilot') {
        const oauthToken = resolveCopilotOauthToken(req.user);
        if (!oauthToken) {
            return res.json({ provider, models: [], selectedModel: null });
        }
        const keyHash = crypto.createHash('sha256').update('copilot:' + oauthToken).digest('hex').slice(0, 16);
        const cacheKey = provider + ':' + keyHash;
        const cached = modelListCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < MODEL_CACHE_TTL) {
            const selectedModel = (req.user.aiModel && modelMatchesProvider(req.user.aiModel, provider)) ? req.user.aiModel : null;
            return res.json({ provider, models: cached.models, selectedModel });
        }
        try {
            const models = await listCopilotModels(req.user);
            models.sort((a, b) => a.name.localeCompare(b.name));
            modelListCache.set(cacheKey, { models, timestamp: Date.now() });
            const selectedModel = (req.user.aiModel && modelMatchesProvider(req.user.aiModel, provider)) ? req.user.aiModel : null;
            return res.json({ provider, models, selectedModel });
        } catch (err) {
            const upstreamStatus = err && (err.status || err.statusCode || (err.response && err.response.status));
            console.error('Copilot models.list failed:', err.message, 'status:', upstreamStatus);
            // Surface auth / rate-limit failures so the UI can prompt the user to
            // fix their token; falling back silently here would hide the real cause.
            if (upstreamStatus === 401 || upstreamStatus === 403) {
                return res.status(400).json({ message: 'Invalid or unauthorized GitHub Copilot token.', error: 'auth_error' });
            }
            if (upstreamStatus === 429) {
                return res.status(429).json({ message: 'Rate limit exceeded. Please try again later.', error: 'rate_limited' });
            }
            // For transient/unknown failures, fall back to a small hardcoded list of
            // known good model IDs so the UI still has something to pick from.
            const fallback = [
                { id: 'gpt-4.1',         name: 'GPT-4.1' },
                { id: 'gpt-4o',          name: 'GPT-4o' },
                { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
                { id: 'gemini-2.5-pro',  name: 'Gemini 2.5 Pro' }
            ];
            const selectedModel = (req.user.aiModel && modelMatchesProvider(req.user.aiModel, provider)) ? req.user.aiModel : null;
            return res.json({ provider, models: fallback, selectedModel, error: 'fetch_failed' });
        }
    }

    // Resolve API key for non-Anthropic providers: stored user key → server .env key
    let apiKey = null;
    if (provider === 'openai') {
        if (req.user.openaiApiKey) {
            try { apiKey = decryptString(req.user.openaiApiKey.encryptedData, req.user.openaiApiKey.iv); } catch (e) { /* ignore */ }
        }
        if (!apiKey) apiKey = config.openaiApiKey;
    } else {
        if (req.user.geminiApiKey) {
            try { apiKey = decryptString(req.user.geminiApiKey.encryptedData, req.user.geminiApiKey.iv); } catch (e) { /* ignore */ }
        }
        if (!apiKey) apiKey = config.geminiApiKey;
    }

    if (!apiKey) {
        return res.json({ provider, models: [], selectedModel: null });
    }

    // Cache key: provider + truncated hash of API key
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
    const cacheKey = provider + ':' + keyHash;

    // Check cache
    const cached = modelListCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < MODEL_CACHE_TTL) {
        const selectedModel = (req.user.aiModel && modelMatchesProvider(req.user.aiModel, provider)) ? req.user.aiModel : null;
        return res.json({ provider, models: cached.models, selectedModel });
    }

    try {
        let models = [];

        if (provider === 'openai') {
            const openaiClient = new OpenAI({ apiKey });
            const list = await openaiClient.models.list();
            const includePattern = /^(gpt-|o[0-9]|chatgpt-)/;
            const excludePattern = /instruct|realtime|audio|search|embedding/i;
            for (const model of list.data) {
                if (includePattern.test(model.id) && !excludePattern.test(model.id)) {
                    models.push({ id: model.id, name: model.id });
                }
            }
        } else if (provider === 'anthropic') {
            // Defensive: Anthropic is handled by the early-return branch above,
            // so this should never run. If a future refactor breaks that
            // invariant, fail loudly instead of silently hanging the request.
            console.error('Unexpected fall-through to anthropic branch in /api/ai/models');
            return res.status(500).json({ message: 'Internal routing error.', error: 'internal_error' });
        } else {
            const listGenAI = new GoogleGenAI({ apiKey });
            const pager = await listGenAI.models.list({ pageSize: 100 });
            for (const model of pager.page) {
                if (!model.supportedActions || !model.supportedActions.includes('generateContent')) continue;
                if (/embedding/i.test(model.name)) continue;
                // model.name is "models/gemini-..." — extract the short id
                const id = model.name.replace(/^models\//, '');
                const displayName = model.displayName || id;
                models.push({ id, name: displayName });
            }
        }

        models.sort((a, b) => a.name.localeCompare(b.name));

        // Enforce hard cap: evict expired first, then oldest if still over limit
        if (modelListCache.size >= 50) {
            const now = Date.now();
            for (const [k, v] of modelListCache) {
                if (now - v.timestamp >= MODEL_CACHE_TTL) modelListCache.delete(k);
            }
            // Still over limit — remove oldest entries
            while (modelListCache.size >= 50) {
                const oldestKey = modelListCache.keys().next().value;
                modelListCache.delete(oldestKey);
            }
        }

        modelListCache.set(cacheKey, { models, timestamp: Date.now() });
        const selectedModel = (req.user.aiModel && modelMatchesProvider(req.user.aiModel, provider)) ? req.user.aiModel : null;
        res.json({ provider, models, selectedModel });
    } catch (err) {
        console.error('Failed to list AI models:', err.message);
        const status = err.status || err.statusCode || (err.response && err.response.status) || null;
        if (status === 401 || status === 403) {
            return res.status(400).json({ message: 'Invalid or unauthorized API key.', error: 'auth_error' });
        }
        if (status === 429) {
            return res.status(429).json({ message: 'Rate limit exceeded. Please try again later.', error: 'rate_limited' });
        }
        res.status(500).json({ message: 'Failed to fetch model list.' });
    }
}));

// Save AI model preference
app.put('/api/user/ai-model', requireAuth, asyncHandler(async (req, res) => {
    const { aiModel: rawAiModel } = req.body;
    let newModel = null;

    if (rawAiModel === null || rawAiModel === undefined || rawAiModel === '') {
        newModel = null;
    } else {
        if (typeof rawAiModel !== 'string') {
            return res.status(400).json({ message: 'aiModel must be a string (max 100 chars) or empty to clear.' });
        }
        const aiModel = rawAiModel.trim();
        if (aiModel === '') {
            newModel = null;
        } else if (aiModel.length > 100) {
            return res.status(400).json({ message: 'aiModel must be a string (max 100 chars) or empty to clear.' });
        } else {
            // Validate model belongs to the user's active provider
            const provider = resolveProvider(req.user);
            if (!modelMatchesProvider(aiModel, provider)) {
                return res.status(400).json({ message: `Model "${aiModel}" does not match the active provider (${provider}).` });
            }
            newModel = aiModel;
        }
    }

    await db.updateUser(req.user.id, { aiModel: newModel, updatedAt: new Date().toISOString() });

    res.json({ aiModel: newModel });
}));

// ============ 2FA VERIFICATION (LOGIN STEP 2) ============

app.post('/api/login/verify-2fa', totpLimiter, asyncHandler(async (req, res) => {
    const { tempToken, totpCode } = req.body;

    if (!tempToken || !totpCode || typeof tempToken !== 'string' || typeof totpCode !== 'string') {
        return res.status(400).json({ message: 'Token and code are required' });
    }

    const session2FA = pending2FASessions.get(tempToken);
    if (!session2FA) {
        return res.status(401).json({ message: 'Invalid or expired session. Please log in again.' });
    }

    // Check expiry
    if (Date.now() - session2FA.createdAt > PENDING_2FA_EXPIRY) {
        pending2FASessions.delete(tempToken);
        return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    const user = await db.findUserById(session2FA.userId);
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
        pending2FASessions.delete(tempToken);
        return res.status(401).json({ message: 'Invalid session. Please log in again.' });
    }

    // Decrypt TOTP secret
    let secret;
    try {
        secret = decryptString(user.totpSecret.encryptedData, user.totpSecret.iv);
    } catch (e) {
        return res.status(500).json({ message: 'Authentication error' });
    }

    const code = totpCode.trim();
    let verified = false;

    // Try TOTP verification first
    try {
        const result = otplib.verifySync({ token: code, secret });
        verified = result.valid;
    } catch (e) {
        // Invalid token format, will try backup codes
    }

    // If TOTP failed and code is 8 chars, try backup codes
    if (!verified && code.length === 8 && user.backupCodes && user.backupCodes.length > 0) {
        for (let i = 0; i < user.backupCodes.length; i++) {
            try {
                if (await bcrypt.compare(code, user.backupCodes[i])) {
                    const updatedCodes = [...user.backupCodes];
                    updatedCodes.splice(i, 1);
                    await db.updateUser(user.id, { backupCodes: updatedCodes });
                    verified = true;
                    break;
                }
            } catch (e) {
                // Skip invalid hash
            }
        }
    }

    if (!verified) {
        return res.status(401).json({ message: 'Invalid verification code' });
    }

    // Delete temp token
    pending2FASessions.delete(tempToken);

    // Create session (same pattern as normal login)
    const userData = { id: user.id, username: user.username, role: user.role };
    req.session.regenerate((err) => {
        if (err) {
            console.error('Session regeneration error:', err);
            return res.status(500).json({ message: 'Login failed' });
        }
        req.session.user = userData;
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ message: 'Login failed' });
            }
            res.json({ message: 'Login successful', user: userData });
        });
    });
}));

// ============ USER SELF-SERVICE EMAIL ENDPOINTS ============

// Get current user's email (masked)
app.get('/api/user/email', requireAuth, (req, res) => {
    const hasEmail = !!(req.user.email && req.user.email.iv && req.user.email.encryptedData);
    let maskedEmail = null;

    if (hasEmail) {
        try {
            const email = decryptString(req.user.email.encryptedData, req.user.email.iv);
            const parts = email.split('@');
            if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
                maskedEmail = parts[0].charAt(0) + '***@' + parts[1];
            }
        } catch (e) {
            // Decryption failed
        }
    }

    res.json({ hasEmail, maskedEmail });
});

// Update current user's email
app.put('/api/user/email', requireAuth, asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (email === undefined) {
        return res.status(400).json({ message: 'Email field is required' });
    }

    if (email === '' || email === null) {
        await db.updateUser(req.user.id, { email: null, updatedAt: new Date().toISOString() });
        return res.json({ message: 'Email removed', hasEmail: false, maskedEmail: null });
    }

    if (typeof email !== 'string') {
        return res.status(400).json({ message: 'Invalid email' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    if (email.length > 254 || /[<>]/.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    const parts = email.split('@');
    const maskedEmail = parts[0].charAt(0) + '***@' + parts[1];

    await db.updateUser(req.user.id, { email: encryptString(email), updatedAt: new Date().toISOString() });
    res.json({ message: 'Email updated', hasEmail: true, maskedEmail });
}));

// ============ TOTP 2FA ENDPOINTS ============

// Get 2FA status
app.get('/api/user/2fa/status', requireAuth, (req, res) => {
    res.json({
        enabled: !!req.user.totpEnabled,
        backupCodesRemaining: (req.user.backupCodes || []).length
    });
});

// Start 2FA setup - generate secret and QR code
app.post('/api/user/2fa/setup', requireAuth, asyncHandler(async (req, res) => {
    if (req.user.totpEnabled) {
        return res.status(400).json({ message: 'Two-factor authentication is already enabled. Disable it first before setting up again.' });
    }

    const secret = otplib.generateSecret();
    const otpauth = otplib.generateURI({ label: req.user.username, issuer: 'AssetManager', secret });

    try {
        const qrCode = await QRCode.toDataURL(otpauth);

        // Store encrypted secret but don't enable yet
        await db.updateUser(req.user.id, { totpSecret: encryptString(secret), updatedAt: new Date().toISOString() });

        res.json({ secret, qrCode });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ message: 'Failed to setup 2FA' });
    }
}));

// Verify 2FA setup - enable 2FA and generate backup codes
app.post('/api/user/2fa/verify', requireAuth, asyncHandler(async (req, res) => {
    const { totpCode } = req.body;

    if (!totpCode || typeof totpCode !== 'string') {
        return res.status(400).json({ message: 'Verification code is required' });
    }

    if (!req.user.totpSecret) {
        return res.status(400).json({ message: 'Please start 2FA setup first' });
    }

    // Decrypt the stored secret
    let secret;
    try {
        secret = decryptString(req.user.totpSecret.encryptedData, req.user.totpSecret.iv);
    } catch (e) {
        return res.status(500).json({ message: 'Failed to verify code' });
    }

    // Verify the code
    let isValid = false;
    try {
        isValid = otplib.verifySync({ token: totpCode.trim(), secret }).valid;
    } catch (e) {
        // Invalid token format
    }
    if (!isValid) {
        return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Generate 10 backup codes (8-char hex)
    const backupCodes = [];
    const hashedCodes = [];
    for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex');
        backupCodes.push(code);
        hashedCodes.push(await bcrypt.hash(code, 10));
    }

    await db.updateUser(req.user.id, { totpEnabled: true, backupCodes: hashedCodes, updatedAt: new Date().toISOString() });

    res.json({ message: '2FA enabled successfully', backupCodes });
}));

// Disable 2FA
app.post('/api/user/2fa/disable', requireAuth, asyncHandler(async (req, res) => {
    const { totpCode } = req.body;

    if (!totpCode || typeof totpCode !== 'string') {
        return res.status(400).json({ message: 'Current code is required to disable 2FA' });
    }

    if (!req.user.totpEnabled || !req.user.totpSecret) {
        return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Decrypt and verify
    let secret;
    try {
        secret = decryptString(req.user.totpSecret.encryptedData, req.user.totpSecret.iv);
    } catch (e) {
        return res.status(500).json({ message: 'Failed to verify code' });
    }

    let isValid = false;
    try {
        isValid = otplib.verifySync({ token: totpCode.trim(), secret }).valid;
    } catch (e) {
        // Invalid token format
    }
    if (!isValid) {
        return res.status(400).json({ message: 'Invalid verification code' });
    }

    await db.updateUser(req.user.id, { totpSecret: null, totpEnabled: false, backupCodes: [], updatedAt: new Date().toISOString() });

    res.json({ message: '2FA disabled successfully' });
}));

// Logout endpoint
const logoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many logout requests. Please try again later.' },
    keyGenerator: (req, res) => req.session?.user?.id?.toString() || rateLimit.ipKeyGenerator(req, res)
});

app.post('/api/logout', logoutLimiter, (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session during logout:', err);
            return res.status(500).json({ message: 'Failed to log out' });
        }
        res.clearCookie('connect.sid');
        return res.json({ message: 'Logged out successfully' });
    });
});

// Get all entries for current user
const VALID_VIEW_MODES = new Set(['individual', 'combined', 'myshare']);
app.get('/api/entries', requireAuth, asyncHandler(async (req, res) => {
    const requestedViewMode = req.query.viewMode || 'individual';
    if (!VALID_VIEW_MODES.has(requestedViewMode)) {
        return res.status(400).json({ message: 'Invalid viewMode. Must be one of: individual, combined, myshare.' });
    }
    const viewMode = requestedViewMode;
    const month = req.query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : null;
    let userEntries;

    // Validate partner relationship (used for both combined and individual views)
    let validPartner = null;
    if (req.user.partnerId) {
        const partner = await db.findUserById(req.user.partnerId);
        // Only treat as valid partner if partner exists, is active, and mutually linked
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            validPartner = partner;
        }
    }

    if (viewMode === 'combined' && validPartner) {
        userEntries = await db.getCoupleEntries(req.user.id, validPartner.id, month);
    } else if (viewMode === 'myshare' && validPartner) {
        userEntries = await db.getMyShareEntries(req.user.id, validPartner.id, month);
    } else if (viewMode === 'myshare') {
        // Without a valid partner there are no couple entries to halve, so
        // My Share is equivalent to the user's individual entries.
        userEntries = await db.getIndividualEntries(req.user.id, month);
    } else if (viewMode === 'individual' && validPartner) {
        userEntries = await db.getIndividualEntries(req.user.id, month);
    } else {
        // viewMode === 'individual' without a partner: all entries belong to
        // this user only, so the legacy per-user query is the right answer.
        userEntries = await db.getEntriesByUser(req.user.id, month);
    }

    res.json(userEntries);
}));

// Entry field validation constants
const VALID_ENTRY_TYPES = ['income', 'expense'];
const VALID_TAGS = ['food', 'groceries', 'transport', 'travel', 'entertainment', 'utilities', 'healthcare', 'education', 'shopping', 'subscription', 'housing', 'salary', 'freelance', 'investment', 'transfer', 'wedding', 'other'];
const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

// Add new entry
app.post('/api/entries', requireAuth, asyncHandler(async (req, res) => {
    const { month, type, amount, description, tags, isCoupleExpense } = req.body;

    if (!month || !type || !amount || !description
        || typeof month !== 'string' || typeof type !== 'string'
        || typeof description !== 'string') {
        return res.status(400).json({ message: 'All fields are required' });
    }

    const trimmedDescription = description.trim();

    if (trimmedDescription.length > 500) {
        return res.status(400).json({ message: 'Description must be 500 characters or less' });
    }

    if (!MONTH_FORMAT.test(month)) {
        return res.status(400).json({ message: 'Month must be in YYYY-MM format' });
    }

    if (!VALID_ENTRY_TYPES.includes(type)) {
        return res.status(400).json({ message: 'Type must be income or expense' });
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ message: 'Amount must be a positive number' });
    }

    const sanitizedTags = Array.isArray(tags)
        ? tags.map(t => String(t).toLowerCase().trim()).filter(t => VALID_TAGS.includes(t))
        : [];

    // Validate partner relationship before allowing couple expense
    let validCoupleExpense = false;
    if (isCoupleExpense && req.user.partnerId) {
        const partner = await db.findUserById(req.user.partnerId);
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            validCoupleExpense = true;
        }
    }

    const newEntry = await db.createEntry({
        userId: req.user.id,
        month,
        type,
        amount: parsedAmount,
        description: trimmedDescription,
        tags: sanitizedTags,
        isCoupleExpense: validCoupleExpense
    });

    res.status(201).json(newEntry);
}));

// Update entry - ensure user owns the entry
app.put('/api/entries/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await db.getEntryByIdAndUser(id, req.user.id);

    if (!existing) {
        return res.status(404).json({ message: 'Entry not found' });
    }

    const { month, type, amount, description, tags, isCoupleExpense } = req.body;

    if (!month || !type || !amount || !description
        || typeof month !== 'string' || typeof type !== 'string'
        || typeof description !== 'string') {
        return res.status(400).json({ message: 'All fields are required' });
    }

    const trimmedDescription = description.trim();

    if (trimmedDescription.length > 500) {
        return res.status(400).json({ message: 'Description must be 500 characters or less' });
    }

    if (!MONTH_FORMAT.test(month)) {
        return res.status(400).json({ message: 'Month must be in YYYY-MM format' });
    }

    if (!VALID_ENTRY_TYPES.includes(type)) {
        return res.status(400).json({ message: 'Type must be income or expense' });
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ message: 'Amount must be a positive number' });
    }

    const sanitizedTags = Array.isArray(tags)
        ? tags.map(t => String(t).toLowerCase().trim()).filter(t => VALID_TAGS.includes(t))
        : [];

    // Validate partner relationship before allowing couple expense
    let validCoupleExpense = false;
    if (isCoupleExpense && req.user.partnerId) {
        const partner = await db.findUserById(req.user.partnerId);
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            validCoupleExpense = true;
        }
    }

    const updated = await db.updateEntry(id, req.user.id, {
        month,
        type,
        amount: parsedAmount,
        description: trimmedDescription,
        tags: sanitizedTags,
        isCoupleExpense: validCoupleExpense
    });

    res.json(updated);
}));

// Delete entry - ensure user owns the entry
app.delete('/api/entries/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await db.deleteEntry(id, req.user.id);

    if (!deleted) {
        return res.status(404).json({ message: 'Entry not found' });
    }

    res.json({ message: 'Entry deleted successfully' });
}));

// ============ ADMIN ENDPOINTS ============

// Get all users (admin only)
app.get('/api/admin/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const allUsers = await db.getAllUsers();
    const entriesCountByUserId = await db.getEntriesCountByUser();

    // Precompute users by ID for O(1) partner lookup
    const usersById = {};
    allUsers.forEach(u => { usersById[u.id] = u; });

    const sanitizedUsers = allUsers.map(u => {
        const userData = {
            id: u.id,
            username: u.username,
            role: u.role,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
            isActive: u.isActive,
            entriesCount: entriesCountByUserId[u.id] || 0,
            partnerId: u.partnerId || null,
            hasEmail: !!(u.email && u.email.iv && u.email.encryptedData),
            has2FA: !!u.totpEnabled
        };

        if (u.partnerId) {
            const partner = usersById[u.partnerId];
            if (partner) {
                userData.partnerUsername = partner.username;
            }
        }

        return userData;
    });
    res.json(sanitizedUsers);
}));

// Create user (admin only)
app.post('/api/admin/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    if (await db.findUserByUsername(username)) {
        return res.status(409).json({ message: 'Username already exists' });
    }

    const validRoles = ['user', 'admin'];
    const userRole = validRoles.includes(role) ? role : 'user';

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await db.createUser({
            username,
            passwordHash,
            role: userRole,
            email: null,
            isActive: true,
            totpSecret: null,
            totpEnabled: false,
            backupCodes: []
        });

        res.status(201).json({
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            createdAt: newUser.createdAt,
            isActive: newUser.isActive
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create user' });
    }
}));

// Update user (admin only)
app.put('/api/admin/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);
    const user = await db.findUserById(userId);

    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    const { username, role, isActive } = req.body;

    // Prevent admin from demoting themselves
    if (userId === req.user.id && role && role !== 'admin') {
        return res.status(400).json({ message: 'Cannot demote yourself' });
    }

    // Prevent deactivating last admin
    if (isActive === false && user.role === 'admin') {
        const activeAdmins = await db.getActiveAdminCount();
        if (activeAdmins === 1) {
            return res.status(400).json({ message: 'Cannot deactivate the last admin' });
        }
    }

    const updates = { updatedAt: new Date().toISOString() };

    if (username && username !== user.username) {
        if (await db.findUserByUsername(username)) {
            return res.status(409).json({ message: 'Username already taken' });
        }
        updates.username = username;
    }

    if (role && ['user', 'admin'].includes(role)) {
        updates.role = role;
    }

    if (typeof isActive === 'boolean') {
        updates.isActive = isActive;
    }

    const updated = await db.updateUser(userId, updates);

    res.json({
        id: updated.id,
        username: updated.username,
        role: updated.role,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        isActive: updated.isActive
    });
}));

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);
    const user = await db.findUserById(userId);

    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    // Prevent self-deletion
    if (userId === req.user.id) {
        return res.status(400).json({ message: 'Cannot delete yourself' });
    }

    // Prevent deleting last admin
    if (user.role === 'admin') {
        const adminCount = await db.getAdminCount();
        if (adminCount === 1) {
            return res.status(400).json({ message: 'Cannot delete the last admin' });
        }
    }

    // Unlink partner if user has one (cleans up partner's state)
    if (user.partnerId) {
        await db.unlinkCouple(userId);
    }

    // Delete user (entries cascade via FK)
    await db.deleteUser(userId);

    res.json({ message: 'User deleted successfully' });
}));

// ============ COUPLE MANAGEMENT ENDPOINTS ============

// Get all couples (admin only)
app.get('/api/admin/couples', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const couples = await db.getCouples();
    res.json({ couples });
}));

// Link two users as a couple (admin only)
app.post('/api/admin/couples/link', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { userId1, userId2 } = req.body;

    if (!userId1 || !userId2) {
        return res.status(400).json({ message: 'Both user IDs are required' });
    }

    try {
        const result = await linkCouple(parseInt(userId1), parseInt(userId2));
        res.json({
            message: 'Users linked as couple successfully',
            couple: {
                user1: { id: result.user1.id, username: result.user1.username },
                user2: { id: result.user2.id, username: result.user2.username },
                linkedAt: result.linkedAt
            }
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
}));

// Unlink a couple (admin only)
app.post('/api/admin/couples/unlink', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
    }

    try {
        const affectedUsers = await db.unlinkCouple(parseInt(userId));
        res.json({
            message: 'Couple unlinked successfully',
            affectedUsers
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
}));

// ============ INVITE CODE ENDPOINTS ============

// ============ PAYPAL PAYMENT ENDPOINTS ============

// Cleanup abandoned/failed PayPal orders every 30 minutes (keep COMPLETED for audit)
setInterval(() => {
    db.cleanupExpiredPaypalOrders(24 * 60 * 60 * 1000).catch(err => {
        console.error('PayPal order cleanup error:', err.message);
    });
}, 30 * 60 * 1000);

// GET /api/paypal/config — public, returns whether PayPal is enabled, price, and client ID
app.get('/api/paypal/config', (req, res) => {
    res.json({
        enabled: !!paypalClient,
        price: paypalClient ? config.inviteCodePrice : null,
        clientId: paypalClient ? config.paypalClientId : null
    });
});

// POST /api/paypal/create-order — public, rate-limited, creates a PayPal order
app.post('/api/paypal/create-order', paypalOrderLimiter, asyncHandler(async (req, res) => {
    if (!ordersController) {
        return res.status(503).json({ message: 'PayPal payments are not configured' });
    }

    try {
        const amount = parseFloat(config.inviteCodePrice).toFixed(2);
        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(500).json({ message: 'Invalid price configuration' });
        }

        const { result } = await ordersController.createOrder({
            body: {
                intent: 'CAPTURE',
                purchaseUnits: [{
                    amount: {
                        currencyCode: 'BRL', // Intentional: app targets Brazilian market
                        value: amount
                    },
                    description: 'Invite Code Purchase'
                }]
            }
        });

        await db.createPaypalOrder({
            orderId: result.id,
            amount,
            currency: 'BRL',
            status: result.status,
            userId: null
        });

        res.status(201).json({ orderId: result.id });
    } catch (error) {
        console.error('Error creating PayPal order:', error.message || error);
        res.status(500).json({ message: 'Failed to create PayPal order' });
    }
}));

// POST /api/paypal/capture-order/:orderId — public, rate-limited, captures a PayPal order after approval
app.post('/api/paypal/capture-order/:orderId', paypalOrderLimiter, asyncHandler(async (req, res) => {
    if (!ordersController) {
        return res.status(503).json({ message: 'PayPal payments are not configured' });
    }

    const { orderId } = req.params;

    // Validate orderId format (PayPal order IDs are alphanumeric, may include hyphens)
    if (!/^[A-Z0-9\-]{10,25}$/.test(orderId)) {
        return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const order = await db.findPaypalOrder(orderId);
    if (!order) {
        return res.status(404).json({ message: 'Order not found' });
    }

    // Already captured — return the invite code
    if (order.status === 'COMPLETED' && order.inviteCode) {
        return res.json({ inviteCode: order.inviteCode });
    }

    try {
        const { result } = await ordersController.captureOrder({ id: orderId });

        if (result.status === 'COMPLETED') {
            // Idempotency: re-check after async capture in case a concurrent request already set it
            const freshOrder = await db.findPaypalOrder(orderId);
            if (freshOrder.inviteCode) {
                return res.json({ inviteCode: freshOrder.inviteCode });
            }

            const newCode = await createInviteCodeHelper('paypal');
            const completed = await db.completePaypalOrder(orderId, newCode.code);

            // If conditional update returned null, a concurrent request won the race
            if (!completed) {
                const existing = await db.findPaypalOrder(orderId);
                if (existing && existing.inviteCode) {
                    return res.json({ inviteCode: existing.inviteCode });
                }
                return res.status(500).json({ message: 'Failed to finalize PayPal order' });
            }

            return res.json({ inviteCode: newCode.code });
        }

        // Update stored status
        await db.updatePaypalOrderStatus(orderId, result.status);

        return res.status(400).json({ message: 'Payment not completed. Status: ' + result.status });
    } catch (error) {
        console.error('Error capturing PayPal order:', error.message || error);
        const statusCode = error.statusCode;
        if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
            res.status(400).json({ message: 'Failed to capture payment' });
        } else {
            res.status(500).json({ message: 'Failed to capture payment' });
        }
    }
}));

// Generate a new invite code (admin only)
app.post('/api/admin/invite-codes', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    try {
        const inviteCode = await createInviteCodeHelper(req.user.id);
        res.status(201).json({ code: inviteCode.code, createdAt: inviteCode.createdAt });
    } catch (error) {
        console.error('Error generating invite code:', error);
        res.status(500).json({ message: 'Failed to generate invite code' });
    }
}));

// List all invite codes (admin only)
app.get('/api/admin/invite-codes', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const allCodes = await db.getAllInviteCodes();
    const allUsers = await db.getAllUsers();
    const usersById = {};
    allUsers.forEach(u => { usersById[u.id] = u; });

    const codesWithDetails = allCodes.map(ic => {
        const creatorId = parseInt(ic.createdBy, 10);
        const creator = (ic.createdBy === 'paypal' || ic.createdBy === 'pix') ? null : usersById[creatorId];
        const consumer = ic.usedBy ? usersById[ic.usedBy] : null;
        return {
            code: ic.code,
            createdAt: ic.createdAt,
            createdByUsername: ic.createdBy === 'paypal'
                ? 'PayPal Purchase'
                : ic.createdBy === 'pix'
                    ? 'PIX Purchase'
                    : (creator ? creator.username : 'Unknown'),
            isUsed: ic.isUsed,
            usedAt: ic.usedAt,
            usedByUsername: consumer ? consumer.username : null
        };
    });
    res.json(codesWithDetails);
}));

// Delete an unused invite code (admin only)
app.delete('/api/admin/invite-codes/:code', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const ic = await db.findInviteCode(code);

    if (!ic) {
        return res.status(404).json({ message: 'Invite code not found' });
    }
    if (ic.isUsed) {
        return res.status(400).json({ message: 'Cannot delete a used invite code' });
    }

    await db.deleteInviteCode(code);
    res.json({ message: 'Invite code deleted' });
}));

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// ============ AI CHAT FINANCIAL ADVISOR ============

const chatToolDeclarations = [
    {
        name: 'getFinancialSummary',
        description: 'Get total income, total expenses, net balance, and savings rate for the user, optionally filtered by date range.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                startMonth: { type: Type.STRING, description: 'Start month in YYYY-MM format (inclusive). Omit for all time.' },
                endMonth: { type: Type.STRING, description: 'End month in YYYY-MM format (inclusive). Omit for all time.' }
            }
        }
    },
    {
        name: 'getCategoryBreakdown',
        description: 'Get spending or income broken down by category tag, with totals and percentages.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                type: { type: Type.STRING, enum: ['income', 'expense'], description: 'Filter by "income" or "expense". Defaults to "expense".' },
                startMonth: { type: Type.STRING, description: 'Start month YYYY-MM (inclusive).' },
                endMonth: { type: Type.STRING, description: 'End month YYYY-MM (inclusive).' }
            }
        }
    },
    {
        name: 'getMonthlyTrends',
        description: 'Get month-by-month income, expenses, and net amounts, plus averages.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                startMonth: { type: Type.STRING, description: 'Start month YYYY-MM (inclusive).' },
                endMonth: { type: Type.STRING, description: 'End month YYYY-MM (inclusive).' }
            }
        }
    },
    {
        name: 'getTopExpenses',
        description: 'Get the largest expense entries, optionally filtered by category or date range.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                limit: { type: Type.NUMBER, description: 'Number of top entries to return. Default 10.' },
                category: { type: Type.STRING, description: 'Filter by category tag (e.g. "food", "transport").' },
                startMonth: { type: Type.STRING, description: 'Start month YYYY-MM (inclusive).' },
                endMonth: { type: Type.STRING, description: 'End month YYYY-MM (inclusive).' }
            }
        }
    },
    {
        name: 'comparePeriods',
        description: 'Compare two time periods side by side: total income, expenses, net, and percentage changes.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                period1Start: { type: Type.STRING, description: 'First period start month YYYY-MM.' },
                period1End: { type: Type.STRING, description: 'First period end month YYYY-MM.' },
                period2Start: { type: Type.STRING, description: 'Second period start month YYYY-MM.' },
                period2End: { type: Type.STRING, description: 'Second period end month YYYY-MM.' }
            },
            required: ['period1Start', 'period1End', 'period2Start', 'period2End']
        }
    },
    {
        name: 'searchEntries',
        description: 'Search the user\'s financial entries by keyword in description or by category tag.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                keyword: { type: Type.STRING, description: 'Search keyword to match in entry descriptions (case-insensitive).' },
                category: { type: Type.STRING, description: 'Filter by category tag.' },
                type: { type: Type.STRING, enum: ['income', 'expense'], description: 'Filter by "income" or "expense".' },
                startMonth: { type: Type.STRING, description: 'Start month YYYY-MM (inclusive).' },
                endMonth: { type: Type.STRING, description: 'End month YYYY-MM (inclusive).' },
                limit: { type: Type.NUMBER, description: 'Max results to return. Default 20.' }
            }
        }
    },
    {
        name: 'editEntry',
        description: 'Propose an edit to an existing financial entry. The system will show a confirmation card to the user in the chat UI — do NOT ask the user to confirm in conversation. Just describe the changes you are proposing. Use searchEntries first to find the entry ID.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                entryId: { type: Type.NUMBER, description: 'The ID of the entry to edit. Required. Use searchEntries to find it.' },
                description: { type: Type.STRING, description: 'New description for the entry (max 500 characters).' },
                amount: { type: Type.NUMBER, description: 'New amount for the entry (positive number, max 10000000).' },
                type: { type: Type.STRING, enum: ['income', 'expense'], description: 'New type: "income" or "expense".' },
                month: { type: Type.STRING, description: 'New month in YYYY-MM format.' },
                tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'New category tags (e.g. ["food", "groceries"]).' },
                isCoupleExpense: { type: Type.BOOLEAN, description: 'Whether this is a shared/couple expense.' }
            },
            required: ['entryId']
        }
    },
    {
        name: 'undoLastEdit',
        description: 'Undo the most recent AI edit on a specific entry, restoring it to its previous state. Only works if the entry was edited via the editEntry tool in the current session and has not already been undone.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                entryId: { type: Type.NUMBER, description: 'The ID of the entry to undo. Must match a previously edited entry.' }
            },
            required: ['entryId']
        }
    }
];

// OpenAI tool declarations (same functionality, OpenAI function-calling format)
const openaiToolDeclarations = [
    {
        type: 'function',
        function: {
            name: 'getFinancialSummary',
            description: 'Get total income, total expenses, net balance, and savings rate for the user, optionally filtered by date range.',
            parameters: {
                type: 'object',
                properties: {
                    startMonth: { type: 'string', description: 'Start month in YYYY-MM format (inclusive). Omit for all time.' },
                    endMonth: { type: 'string', description: 'End month in YYYY-MM format (inclusive). Omit for all time.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getCategoryBreakdown',
            description: 'Get spending or income broken down by category tag, with totals and percentages.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['income', 'expense'], description: 'Filter by "income" or "expense". Defaults to "expense".' },
                    startMonth: { type: 'string', description: 'Start month YYYY-MM (inclusive).' },
                    endMonth: { type: 'string', description: 'End month YYYY-MM (inclusive).' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getMonthlyTrends',
            description: 'Get month-by-month income, expenses, and net amounts, plus averages.',
            parameters: {
                type: 'object',
                properties: {
                    startMonth: { type: 'string', description: 'Start month YYYY-MM (inclusive).' },
                    endMonth: { type: 'string', description: 'End month YYYY-MM (inclusive).' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getTopExpenses',
            description: 'Get the largest expense entries, optionally filtered by category or date range.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Number of top entries to return. Default 10.' },
                    category: { type: 'string', description: 'Filter by category tag (e.g. "food", "transport").' },
                    startMonth: { type: 'string', description: 'Start month YYYY-MM (inclusive).' },
                    endMonth: { type: 'string', description: 'End month YYYY-MM (inclusive).' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'comparePeriods',
            description: 'Compare two time periods side by side: total income, expenses, net, and percentage changes.',
            parameters: {
                type: 'object',
                properties: {
                    period1Start: { type: 'string', description: 'First period start month YYYY-MM.' },
                    period1End: { type: 'string', description: 'First period end month YYYY-MM.' },
                    period2Start: { type: 'string', description: 'Second period start month YYYY-MM.' },
                    period2End: { type: 'string', description: 'Second period end month YYYY-MM.' }
                },
                required: ['period1Start', 'period1End', 'period2Start', 'period2End']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'searchEntries',
            description: 'Search the user\'s financial entries by keyword in description or by category tag.',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: 'Search keyword to match in entry descriptions (case-insensitive).' },
                    category: { type: 'string', description: 'Filter by category tag.' },
                    type: { type: 'string', enum: ['income', 'expense'], description: 'Filter by "income" or "expense".' },
                    startMonth: { type: 'string', description: 'Start month YYYY-MM (inclusive).' },
                    endMonth: { type: 'string', description: 'End month YYYY-MM (inclusive).' },
                    limit: { type: 'number', description: 'Max results to return. Default 20.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'editEntry',
            description: 'Propose an edit to an existing financial entry. The system will show a confirmation card to the user in the chat UI — do NOT ask the user to confirm in conversation. Just describe the changes you are proposing. Use searchEntries first to find the entry ID.',
            parameters: {
                type: 'object',
                properties: {
                    entryId: { type: 'number', description: 'The ID of the entry to edit. Required. Use searchEntries to find it.' },
                    description: { type: 'string', description: 'New description for the entry (max 500 characters).' },
                    amount: { type: 'number', description: 'New amount for the entry (positive number, max 10000000).' },
                    type: { type: 'string', enum: ['income', 'expense'], description: 'New type: "income" or "expense".' },
                    month: { type: 'string', description: 'New month in YYYY-MM format.' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'New category tags (e.g. ["food", "groceries"]).' },
                    isCoupleExpense: { type: 'boolean', description: 'Whether this is a shared/couple expense.' }
                },
                required: ['entryId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'undoLastEdit',
            description: 'Undo the most recent AI edit on a specific entry, restoring it to its previous state. Only works if the entry was edited via the editEntry tool in the current session and has not already been undone.',
            parameters: {
                type: 'object',
                properties: {
                    entryId: { type: 'number', description: 'The ID of the entry to undo. Must match a previously edited entry.' }
                },
                required: ['entryId']
            }
        }
    }
];

// Anthropic tool declarations — same tools, restructured for Anthropic's format
const anthropicToolDeclarations = openaiToolDeclarations.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters
}));

// Cleared on undo or server restart — only the last edit per entry is reversible.
// Capped at 1000 entries; oldest snapshots are evicted when the limit is reached.
const lastEditSnapshots = new Map();
const SNAPSHOT_MAX_SIZE = 1000;

const pendingEdits = new Map(); // keyed by userId, array of pending edits
const PENDING_EDIT_TTL_MS = 5 * 60 * 1000; // 5 min expiry

// Periodically remove expired pending edits to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [userId, edits] of pendingEdits.entries()) {
        const active = edits.filter(e => now - e.createdAt <= PENDING_EDIT_TTL_MS);
        if (active.length === 0) {
            pendingEdits.delete(userId);
        } else if (active.length !== edits.length) {
            pendingEdits.set(userId, active);
        }
    }
}, 60 * 1000);

const chatSystemPrompt = `You are a personal financial advisor assistant. You help users understand their finances by analyzing their real data.

RULES:
- ALWAYS use the available tools to look up the user's actual financial data before answering questions. Never guess or make up numbers.
- Be concise: 2-4 short paragraphs max.
- Be encouraging but honest. If spending is high, say so tactfully.
- Respond in the same language the user writes in.
- Format currency amounts clearly.
- Do NOT give specific investment advice, tax advice, or legal advice. You can suggest general financial principles.
- When showing data, use simple formatting with bold for emphasis.
- If the user asks about something unrelated to finances, politely redirect them.
- When the user asks to edit entries, ALWAYS use searchEntries first to find the correct entries. Then call editEntry for each entry with the proposed changes. You can call editEntry multiple times in a single turn for bulk edits. The system will automatically show confirmation cards to the user — do NOT ask them to confirm in chat. Simply describe the changes you are proposing.
- After proposing edits, briefly describe what you proposed. The user will confirm or cancel each edit via buttons in the UI.
- If the user wants to undo a recent edit, use undoLastEdit with the entry ID. Only the most recent edit per entry can be undone.`;

function filterByDateRange(userEntries, startMonth, endMonth) {
    return userEntries.filter(e => {
        if (startMonth && e.month < startMonth) return false;
        if (endMonth && e.month > endMonth) return false;
        return true;
    });
}

async function toolGetFinancialSummary(userId, args) {
    let userEntries = await db.getEntriesByUser(userId);
    userEntries = filterByDateRange(userEntries, args.startMonth, args.endMonth);

    const totalIncome = userEntries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    const totalExpenses = userEntries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
    const balance = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? ((balance / totalIncome) * 100).toFixed(1) : 0;

    return {
        totalIncome: totalIncome.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        balance: balance.toFixed(2),
        savingsRate: `${savingsRate}%`,
        entryCount: userEntries.length,
        period: {
            from: args.startMonth || 'all time',
            to: args.endMonth || 'all time'
        }
    };
}

async function toolGetCategoryBreakdown(userId, args) {
    const type = args.type || 'expense';
    let userEntries = await db.getEntriesByUser(userId);
    userEntries = userEntries.filter(e => e.type === type);
    userEntries = filterByDateRange(userEntries, args.startMonth, args.endMonth);

    const total = userEntries.reduce((s, e) => s + e.amount, 0);
    const byCategory = {};

    userEntries.forEach(e => {
        const cat = (e.tags && e.tags[0]) || 'uncategorized';
        byCategory[cat] = (byCategory[cat] || 0) + e.amount;
    });

    const breakdown = Object.entries(byCategory)
        .map(([category, amount]) => ({
            category,
            amount: amount.toFixed(2),
            percentage: total > 0 ? ((amount / total) * 100).toFixed(1) + '%' : '0%'
        }))
        .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));

    return { type, total: total.toFixed(2), breakdown };
}

async function toolGetMonthlyTrends(userId, args) {
    let userEntries = await db.getEntriesByUser(userId);
    userEntries = filterByDateRange(userEntries, args.startMonth, args.endMonth);

    const byMonth = {};
    userEntries.forEach(e => {
        if (!byMonth[e.month]) byMonth[e.month] = { income: 0, expenses: 0 };
        if (e.type === 'income') byMonth[e.month].income += e.amount;
        else byMonth[e.month].expenses += e.amount;
    });

    const months = Object.keys(byMonth).sort();
    const trends = months.map(m => ({
        month: m,
        income: byMonth[m].income.toFixed(2),
        expenses: byMonth[m].expenses.toFixed(2),
        net: (byMonth[m].income - byMonth[m].expenses).toFixed(2)
    }));

    const totalIncome = months.reduce((s, m) => s + byMonth[m].income, 0);
    const totalExpenses = months.reduce((s, m) => s + byMonth[m].expenses, 0);
    const count = months.length || 1;

    return {
        months: trends,
        averages: {
            income: (totalIncome / count).toFixed(2),
            expenses: (totalExpenses / count).toFixed(2),
            net: ((totalIncome - totalExpenses) / count).toFixed(2)
        }
    };
}

async function toolGetTopExpenses(userId, args) {
    let userEntries = await db.getEntriesByUser(userId);
    userEntries = userEntries.filter(e => e.type === 'expense');
    userEntries = filterByDateRange(userEntries, args.startMonth, args.endMonth);

    if (args.category) {
        const catQuery = String(args.category).toLowerCase().trim();
        userEntries = userEntries.filter(e =>
            Array.isArray(e.tags) && e.tags.some(t => String(t).toLowerCase().trim() === catQuery)
        );
    }

    let limit = parseInt(args.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10;
    limit = Math.min(limit, 50);
    const sorted = userEntries.sort((a, b) => b.amount - a.amount).slice(0, limit);

    return {
        topExpenses: sorted.map(e => ({
            id: e.id,
            description: e.description,
            amount: e.amount.toFixed(2),
            month: e.month,
            category: (e.tags && e.tags[0]) || 'uncategorized'
        })),
        count: sorted.length
    };
}

async function toolComparePeriods(userId, args) {
    const allEntries = await db.getEntriesByUser(userId);
    const get = (start, end) => {
        const ue = filterByDateRange(allEntries, start, end);
        const income = ue.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
        const expenses = ue.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
        return { income, expenses, net: income - expenses, entryCount: ue.length };
    };

    const p1 = get(args.period1Start, args.period1End);
    const p2 = get(args.period2Start, args.period2End);

    const pctChange = (a, b) => {
        if (a === 0) return b === 0 ? '0%' : 'N/A';
        return ((b - a) / a * 100).toFixed(1) + '%';
    };

    return {
        period1: {
            range: `${args.period1Start} to ${args.period1End}`,
            income: p1.income.toFixed(2), expenses: p1.expenses.toFixed(2), net: p1.net.toFixed(2), entryCount: p1.entryCount
        },
        period2: {
            range: `${args.period2Start} to ${args.period2End}`,
            income: p2.income.toFixed(2), expenses: p2.expenses.toFixed(2), net: p2.net.toFixed(2), entryCount: p2.entryCount
        },
        changes: {
            income: pctChange(p1.income, p2.income),
            expenses: pctChange(p1.expenses, p2.expenses),
            net: pctChange(p1.net, p2.net)
        }
    };
}

async function toolSearchEntries(userId, args) {
    let userEntries = await db.getEntriesByUser(userId);
    userEntries = filterByDateRange(userEntries, args.startMonth, args.endMonth);

    if (args.type) userEntries = userEntries.filter(e => e.type === args.type);
    if (args.category) {
        const catQuery = String(args.category).toLowerCase().trim();
        userEntries = userEntries.filter(e =>
            Array.isArray(e.tags) && e.tags.some(t => String(t).toLowerCase().trim() === catQuery)
        );
    }
    if (args.keyword && typeof args.keyword === 'string') {
        const kw = args.keyword.trim().toLowerCase();
        userEntries = userEntries.filter(e => e.description.toLowerCase().includes(kw));
    }

    let limit = 20;
    if (args.limit != null) {
        const parsed = parseInt(args.limit, 10);
        if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(parsed, 100);
    }
    const results = userEntries.slice(0, limit);

    return {
        results: results.map(e => ({
            id: e.id,
            description: e.description,
            amount: e.amount.toFixed(2),
            type: e.type,
            month: e.month,
            category: (e.tags && e.tags[0]) || 'uncategorized'
        })),
        totalMatches: userEntries.length,
        showing: results.length
    };
}

/**
 * Validates editEntry arguments and resolves the target entry without applying changes.
 * @param {number} userId - The authenticated user's ID.
 * @param {object} args - Tool arguments (entryId, description, amount, type, month, tags).
 * @returns {object} { entry, updates, rejectedTags } on success, or { error } on failure.
 */
async function validateEditArgs(userId, args) {
    const entryId = args.entryId != null ? Number(args.entryId) : NaN;
    if (!Number.isInteger(entryId)) {
        return { error: 'entryId is required and must be a valid integer.' };
    }

    const entry = await db.getEntryByIdAndUser(entryId, userId);
    if (!entry) {
        return { error: 'Entry not found or does not belong to the current user. Use searchEntries to find valid entry IDs.' };
    }
    const updates = {};

    if (args.description != null) {
        const desc = String(args.description).trim();
        if (!desc) return { error: 'Description cannot be empty.' };
        if (desc.length > 500) return { error: 'Description must be 500 characters or fewer.' };
        updates.description = desc;
    }

    if (args.amount != null) {
        const amount = parseFloat(args.amount);
        if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be a positive number.' };
        if (amount > 10000000) return { error: 'Amount must not exceed 10,000,000.' };
        updates.amount = amount;
    }

    if (args.type != null) {
        if (!VALID_ENTRY_TYPES.includes(args.type)) return { error: 'Type must be "income" or "expense".' };
        updates.type = args.type;
    }

    if (args.month != null) {
        if (!MONTH_FORMAT.test(args.month)) return { error: 'Month must be in YYYY-MM format.' };
        updates.month = args.month;
    }

    let rejectedTags = [];
    if (args.tags != null) {
        if (!Array.isArray(args.tags)) return { error: 'Tags must be an array of strings.' };
        const rawTags = args.tags.map(t => String(t).toLowerCase().trim());
        const sanitizedTags = rawTags.filter(t => VALID_TAGS.includes(t));
        rejectedTags = rawTags.filter(t => !VALID_TAGS.includes(t));
        if (rejectedTags.length > 0 && sanitizedTags.length === 0) {
            return { error: `None of the provided tags are valid. Valid tags are: ${VALID_TAGS.join(', ')}` };
        }
        updates.tags = sanitizedTags;
    }

    if (args.isCoupleExpense != null) {
        updates.isCoupleExpense = Boolean(args.isCoupleExpense);
    }

    if (Object.keys(updates).length === 0) {
        return { error: 'No valid fields to update. Provide at least one of: description, amount, type, month, tags, isCoupleExpense.' };
    }

    return { entry, updates, rejectedTags };
}

/**
 * Edit an existing financial entry. Requires confirmed: true (passed by the confirm endpoint).
 * @param {number} userId - The authenticated user's ID (from session).
 * @param {object} args - Tool arguments from the AI model.
 * @returns {object} Updated entry on success, or `{ error }` on failure.
 */
async function toolEditEntry(userId, args) {
    // Require explicit confirmation flag
    if (args.confirmed !== true) {
        return { error: 'Edit must be confirmed by the user. Set confirmed: true after user approval.' };
    }

    const validation = await validateEditArgs(userId, args);
    if (validation.error) return validation;

    const { entry, updates, rejectedTags } = validation;
    const entryId = entry.id;

    // Save pre-edit snapshot so the user can undo this edit.
    const snapshotKey = `${userId}:${entryId}`;
    if (lastEditSnapshots.has(snapshotKey)) {
        lastEditSnapshots.delete(snapshotKey);
    } else if (lastEditSnapshots.size >= SNAPSHOT_MAX_SIZE) {
        const oldestKey = lastEditSnapshots.keys().next().value;
        if (oldestKey !== undefined) {
            lastEditSnapshots.delete(oldestKey);
        }
    }

    const before = { ...entry };
    const updated = await db.updateEntry(entryId, userId, updates);
    lastEditSnapshots.set(snapshotKey, { before, after: { ...updated } });
    const result = {
        success: true,
        message: `Entry updated successfully. This edit can be undone by requesting to undo entry ${updated.id} (undo is only available until the next server restart).`,
        entry: {
            id: updated.id,
            description: updated.description,
            amount: updated.amount.toFixed(2),
            type: updated.type,
            month: updated.month,
            tags: updated.tags || [],
            isCoupleExpense: updated.isCoupleExpense || false
        }
    };
    if (rejectedTags.length > 0) {
        result.warning = `The following tags were not recognized and were ignored: ${rejectedTags.join(', ')}. Valid tags are: ${VALID_TAGS.join(', ')}`;
    }
    return result;
}

/**
 * Undo the most recent AI edit on a specific entry, restoring the pre-edit state.
 * Only works if a snapshot exists for this user+entry (i.e., the entry was edited via
 * editEntry in the current server session and hasn't already been undone).
 *
 * @param {number} userId - The authenticated user's ID (from session).
 * @param {object} args - Tool arguments from the AI model.
 * @param {number} args.entryId - The entry to undo (required).
 * @returns {object} Restored entry on success, or `{ error }` on failure.
 */
async function toolUndoLastEdit(userId, args) {
    const entryId = args.entryId != null ? Number(args.entryId) : NaN;
    if (!Number.isInteger(entryId)) {
        return { error: 'entryId is required and must be a valid integer.' };
    }

    const snapshotKey = `${userId}:${entryId}`;
    const snapshotData = lastEditSnapshots.get(snapshotKey);
    if (!snapshotData) {
        return { error: 'No recent edit to undo for this entry. Only the most recent AI edit can be undone, and only once.' };
    }

    // Verify the entry still exists and belongs to the user
    const current = await db.getEntryByIdAndUser(entryId, userId);
    if (!current) {
        lastEditSnapshots.delete(snapshotKey);
        return { error: 'Entry not found or does not belong to the current user.' };
    }

    // Verify the entry hasn't been modified since the AI edit (e.g. via the UI).
    const expected = snapshotData.after;
    if (current.description !== expected.description || current.amount !== expected.amount
        || current.type !== expected.type || current.month !== expected.month
        || JSON.stringify(current.tags) !== JSON.stringify(expected.tags)
        || current.isCoupleExpense !== expected.isCoupleExpense) {
        lastEditSnapshots.delete(snapshotKey);
        return { error: 'This entry has been modified since the AI edit (possibly via the UI). Undo is no longer available to avoid overwriting those changes.' };
    }

    // Restore the pre-edit snapshot
    const before = snapshotData.before;
    await db.updateEntry(entryId, userId, {
        description: before.description,
        amount: before.amount,
        type: before.type,
        month: before.month,
        tags: before.tags || [],
        isCoupleExpense: before.isCoupleExpense || false
    });
    lastEditSnapshots.delete(snapshotKey);

    return {
        success: true,
        message: 'Edit undone. Entry restored to its previous state.',
        entry: {
            id: before.id,
            description: before.description,
            amount: before.amount.toFixed(2),
            type: before.type,
            month: before.month,
            tags: before.tags || [],
            isCoupleExpense: before.isCoupleExpense || false
        }
    };
}

async function executeTool(name, userId, args) {
    switch (name) {
        case 'getFinancialSummary': return toolGetFinancialSummary(userId, args);
        case 'getCategoryBreakdown': return toolGetCategoryBreakdown(userId, args);
        case 'getMonthlyTrends': return toolGetMonthlyTrends(userId, args);
        case 'getTopExpenses': return toolGetTopExpenses(userId, args);
        case 'comparePeriods': return toolComparePeriods(userId, args);
        case 'searchEntries': return toolSearchEntries(userId, args);
        case 'editEntry': return toolEditEntry(userId, args);
        case 'undoLastEdit': return toolUndoLastEdit(userId, args);
        default: return { error: `Unknown tool: ${name}` };
    }
}

// AI Chat endpoint
const MAX_CHAT_MESSAGE_LENGTH = 8000;

app.post('/api/ai/chat', requireAuth, chatRateLimiter, asyncHandler(async (req, res) => {
    const { messages: clientMessages, message: rawMessage } = req.body;

    if (!rawMessage || typeof rawMessage !== 'string' || !rawMessage.trim()) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    const message = rawMessage.trim();
    if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
        return res.status(413).json({ error: 'Message is too long.' });
    }

    // Sanitize client-provided history: accept user and assistant messages for conversation context.
    const messages = Array.isArray(clientMessages)
        ? clientMessages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        : [];

    // Determine provider: use user's stored preference (default gemini)
    const provider = resolveProvider(req.user);

    // Resolve API key: stored user key → server .env key
    // (Anthropic uses resolveAnthropicAuth instead — see below.
    //  Copilot uses createCopilotClient which exchanges an OAuth token for
    //  a session token at request time.)
    let apiKey = null;
    let anthropicAuth = null;
    if (provider === 'openai') {
        if (req.user.openaiApiKey) {
            try {
                apiKey = decryptString(req.user.openaiApiKey.encryptedData, req.user.openaiApiKey.iv);
            } catch (e) {
                console.error('Failed to decrypt stored OpenAI API key for chat:', e.message);
            }
        }
        if (!apiKey) apiKey = config.openaiApiKey;
    } else if (provider === 'anthropic') {
        anthropicAuth = resolveAnthropicAuth(req.user);
        if (!anthropicAuth.authToken && !anthropicAuth.apiKey) {
            return res.status(400).json({ error: 'no_api_key' });
        }
    } else if (provider === 'copilot') {
        if (!hasCopilotCredentials(req.user)) {
            return res.status(400).json({ error: 'no_api_key' });
        }
    } else {
        if (req.user.geminiApiKey) {
            try {
                apiKey = decryptString(req.user.geminiApiKey.encryptedData, req.user.geminiApiKey.iv);
            } catch (e) {
                console.error('Failed to decrypt stored Gemini API key for chat:', e.message);
            }
        }
        if (!apiKey) apiKey = config.geminiApiKey;
    }
    if (provider !== 'anthropic' && provider !== 'copilot' && !apiKey) {
        return res.status(400).json({ error: 'no_api_key' });
    }

    // Shared helper: handle editEntry tool call interception.
    // Validates the proposed edit, stores it as a pending edit for UI confirmation,
    // and returns a result message for the AI to relay to the user.
    // @param {object} toolArgs - Raw arguments from the AI tool call.
    // @param {Array}  pendingEditsList - Accumulator for pending edits to include in the response.
    // @returns {object} - Result to return to the AI as the tool response.
    async function handleEditEntryCall(toolArgs, pendingEditsList) {
        const validation = await validateEditArgs(req.user.id, toolArgs);
        if (validation.error) return validation;
        const entryId = validation.entry.id;
        const currentEntry = {
            id: validation.entry.id,
            description: validation.entry.description,
            amount: validation.entry.amount,
            type: validation.entry.type,
            month: validation.entry.month,
            tags: validation.entry.tags || [],
            isCoupleExpense: validation.entry.isCoupleExpense || false
        };
        const editItem = { entryId, changes: validation.updates, currentEntry, createdAt: Date.now() };
        const existing = pendingEdits.get(req.user.id) || [];
        const idx = existing.findIndex(e => e.entryId === entryId);
        if (idx !== -1) existing[idx] = editItem;
        else existing.push(editItem);
        pendingEdits.set(req.user.id, existing);
        pendingEditsList.push({ entryId, changes: validation.updates, currentEntry });
        return { pending: true, message: 'Edit sent to user for UI confirmation. Tell them what you proposed and that they can use the buttons to confirm or cancel.' };
    }

    try {
        let finalText = null;
        const pendingEditsList = [];
        const maxIterations = 5;

        if (provider === 'openai') {
            // ── OpenAI branch ──────────────────────────────────────────
            const openaiClient = new OpenAI({ apiKey });
            const MAX_HISTORY_TEXT_LENGTH = 8000;
            const openaiMessages = [{ role: 'system', content: chatSystemPrompt }];
            for (const msg of messages.slice(-20)) {
                const text = msg.content.trim().slice(0, MAX_HISTORY_TEXT_LENGTH);
                if (!text) continue;
                openaiMessages.push({ role: msg.role, content: text });
            }
            openaiMessages.push({ role: 'user', content: message });

            let currentMessages = openaiMessages;
            for (let i = 0; i < maxIterations; i++) {
                const response = await openaiClient.chat.completions.create({
                    model: resolveModel(req.user, 'openai', 'chat'),
                    messages: currentMessages,
                    tools: openaiToolDeclarations,
                    tool_choice: 'auto',
                    temperature: 0.7
                });

                const choice = response.choices[0];
                if (!choice) { finalText = 'Sorry, I could not generate a response.'; break; }

                const assistantMsg = choice.message;
                currentMessages = [...currentMessages, assistantMsg];

                if (choice.finish_reason !== 'tool_calls' || !assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
                    finalText = assistantMsg.content || 'Sorry, I could not generate a response.';
                    break;
                }

                // Execute tool calls
                const toolResultMessages = [];
                for (const toolCall of assistantMsg.tool_calls) {
                    const toolName = toolCall.function.name;
                    let toolArgs = {};
                    try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch (parseErr) {
                        console.error(`Failed to parse OpenAI tool args for ${toolName}:`, parseErr.message);
                    }
                    let result;
                    if (toolName === 'editEntry') {
                        result = await handleEditEntryCall(toolArgs, pendingEditsList);
                    } else {
                        result = await executeTool(toolName, req.user.id, toolArgs);
                    }
                    toolResultMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    });
                }
                currentMessages = [...currentMessages, ...toolResultMessages];
            }
        } else if (provider === 'copilot') {
            // ── GitHub Copilot branch (OpenAI-compatible API) ──────────
            // Mirrors the OpenAI branch: same chat completions schema, same
            // tool-calling protocol. The Copilot client wraps a fresh session
            // token with one automatic 401-retry.
            const MAX_HISTORY_TEXT_LENGTH = 8000;
            const copilotMessages = [{ role: 'system', content: chatSystemPrompt }];
            for (const msg of messages.slice(-20)) {
                const text = msg.content.trim().slice(0, MAX_HISTORY_TEXT_LENGTH);
                if (!text) continue;
                copilotMessages.push({ role: msg.role, content: text });
            }
            copilotMessages.push({ role: 'user', content: message });

            let currentMessages = copilotMessages;
            for (let i = 0; i < maxIterations; i++) {
                const response = await copilotCallWithRetry(req.user, (client) =>
                    client.chat.completions.create({
                        model: resolveModel(req.user, 'copilot', 'chat'),
                        messages: currentMessages,
                        tools: openaiToolDeclarations,
                        tool_choice: 'auto',
                        temperature: 0.7
                    })
                );

                const choice = response.choices[0];
                if (!choice) { finalText = 'Sorry, I could not generate a response.'; break; }

                const assistantMsg = choice.message;
                currentMessages = [...currentMessages, assistantMsg];

                if (choice.finish_reason !== 'tool_calls' || !assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
                    finalText = assistantMsg.content || 'Sorry, I could not generate a response.';
                    break;
                }

                const toolResultMessages = [];
                for (const toolCall of assistantMsg.tool_calls) {
                    const toolName = toolCall.function.name;
                    let toolArgs = {};
                    try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch (parseErr) {
                        console.error(`Failed to parse Copilot tool args for ${toolName}:`, parseErr.message);
                    }
                    let result;
                    if (toolName === 'editEntry') {
                        result = await handleEditEntryCall(toolArgs, pendingEditsList);
                    } else {
                        result = await executeTool(toolName, req.user.id, toolArgs);
                    }
                    toolResultMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    });
                }
                currentMessages = [...currentMessages, ...toolResultMessages];
            }
        } else if (provider === 'anthropic') {
            // ── Anthropic branch ─────────────────────────────────────
            const anthropicClient = createAnthropicClient(anthropicAuth);
            const MAX_HISTORY_TEXT_LENGTH = 8000;
            const anthropicMessages = [];
            for (const msg of messages.slice(-20)) {
                const text = msg.content.trim().slice(0, MAX_HISTORY_TEXT_LENGTH);
                if (!text) continue;
                const last = anthropicMessages[anthropicMessages.length - 1];
                if (last && last.role === msg.role) {
                    // Merge consecutive same-role messages (Anthropic requires alternating roles)
                    last.content += '\n' + text;
                } else {
                    anthropicMessages.push({ role: msg.role, content: text });
                }
            }
            // Ensure first message is from user (Anthropic requirement)
            while (anthropicMessages.length > 0 && anthropicMessages[0].role !== 'user') {
                anthropicMessages.shift();
            }
            // Append new user message (merge if last history was also user)
            const lastMsg = anthropicMessages[anthropicMessages.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
                lastMsg.content += '\n' + message;
            } else {
                anthropicMessages.push({ role: 'user', content: message });
            }

            let currentMessages = anthropicMessages;
            for (let i = 0; i < maxIterations; i++) {
                const response = await anthropicClient.messages.create({
                    model: resolveModel(req.user, 'anthropic', 'chat'),
                    max_tokens: 4096,
                    system: chatSystemPrompt,
                    messages: currentMessages,
                    tools: anthropicToolDeclarations,
                    temperature: 0.7
                });

                if (response.stop_reason !== 'tool_use') {
                    const textBlocks = response.content.filter(b => b.type === 'text');
                    finalText = textBlocks.map(b => b.text).join('') || 'Sorry, I could not generate a response.';
                    break;
                }

                // Extract tool_use blocks and execute them
                const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
                const toolResults = [];
                for (const toolUse of toolUseBlocks) {
                    const toolName = toolUse.name;
                    const toolArgs = toolUse.input || {};
                    let result;
                    if (toolName === 'editEntry') {
                        result = await handleEditEntryCall(toolArgs, pendingEditsList);
                    } else {
                        result = await executeTool(toolName, req.user.id, toolArgs);
                    }
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: JSON.stringify(result)
                    });
                }
                currentMessages = [
                    ...currentMessages,
                    { role: 'assistant', content: response.content },
                    { role: 'user', content: toolResults }
                ];
            }
        } else {
            // ── Gemini branch ──────────────────────────────────────────
            const chatGenAI = new GoogleGenAI({ apiKey });

            // Build contents from sanitized history + new message.
            // Map 'assistant' → 'model' for Gemini. Merge consecutive same-role
            // messages to satisfy Gemini's alternating-turn requirement.
            const contents = [];
            const MAX_HISTORY_TEXT_LENGTH = 8000;
            const recent = messages.slice(-20);
            for (const msg of recent) {
                const text = msg.content.trim().slice(0, MAX_HISTORY_TEXT_LENGTH);
                if (!text) continue;
                const role = msg.role === 'assistant' ? 'model' : 'user';
                const last = contents[contents.length - 1];
                if (last && last.role === role) {
                    // Merge consecutive same-role messages into one turn
                    last.parts[0].text += '\n' + text;
                } else {
                    contents.push({ role, parts: [{ text }] });
                }
            }
            // Ensure the new message is a user turn (merge if last history was also user)
            const lastEntry = contents[contents.length - 1];
            if (lastEntry && lastEntry.role === 'user') {
                lastEntry.parts[0].text += '\n' + message;
            } else {
                contents.push({ role: 'user', parts: [{ text: message }] });
            }

            let currentContents = contents;
            for (let i = 0; i < maxIterations; i++) {
                const response = await chatGenAI.models.generateContent({
                    model: resolveModel(req.user, 'gemini', 'chat'),
                    contents: currentContents,
                    config: {
                        temperature: 0.7,
                        tools: [{ functionDeclarations: chatToolDeclarations }],
                        systemInstruction: chatSystemPrompt
                    }
                });

                const candidate = response.candidates?.[0];
                if (!candidate || !candidate.content) {
                    finalText = response.text || 'Sorry, I could not generate a response.';
                    break;
                }

                const parts = candidate.content.parts || [];
                const functionCalls = parts.filter(p => p.functionCall);

                if (functionCalls.length === 0) {
                    // No tool calls — extract text response
                    const textParts = parts.filter(p => p.text);
                    finalText = textParts.map(p => p.text).join('\n') || 'Sorry, I could not generate a response.';
                    break;
                }

                // Execute tool calls and feed results back
                currentContents = [...currentContents, { role: 'model', parts }];

                const toolResultParts = [];
                for (const fc of functionCalls) {
                    const toolName = fc.functionCall.name;
                    const toolArgs = fc.functionCall.args || {};
                    let result;
                    if (toolName === 'editEntry') {
                        result = await handleEditEntryCall(toolArgs, pendingEditsList);
                    } else {
                        result = await executeTool(toolName, req.user.id, toolArgs);
                    }
                    toolResultParts.push({
                        functionResponse: { name: toolName, response: result }
                    });
                }
                currentContents.push({ role: 'user', parts: toolResultParts });
            }
        }

        if (!finalText) {
            finalText = 'Sorry, I was unable to complete the analysis. Please try rephrasing your question.';
        }

        const responsePayload = { reply: finalText };
        if (pendingEditsList.length > 0) {
            responsePayload.pendingEdits = pendingEditsList;
        }
        res.json(responsePayload);
    } catch (error) {
        console.error('AI Chat error:', error.message, error.status ? `(status ${error.status})` : '');
        if (error.message?.includes('API key') || error.message?.includes('authentication') || error.status === 401) {
            return res.status(400).json({ error: 'invalid_api_key' });
        }
        if (error.message?.includes('quota') || error.message?.includes('credit balance') || error.status === 429) {
            return res.status(429).json({ error: 'quota_exceeded' });
        }
        res.status(500).json({ error: 'generic' });
    }
}));

// Confirm a pending AI edit via UI button
const editActionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
    keyGenerator: (req, res) => req.session?.user?.id?.toString() || rateLimit.ipKeyGenerator(req, res)
});

app.post('/api/ai/confirm-edit', requireAuth, editActionLimiter, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const allPending = pendingEdits.get(userId);

    if (!allPending || allPending.length === 0) {
        return res.status(404).json({ error: 'No pending edit found.' });
    }

    const requestedEntryId = req.body.entryId != null ? Number(req.body.entryId) : null;
    if (requestedEntryId == null || !Number.isInteger(requestedEntryId)) {
        return res.status(400).json({ error: 'entryId must be a valid integer.' });
    }

    const idx = allPending.findIndex(e => e.entryId === requestedEntryId);
    if (idx === -1) {
        return res.status(404).json({ error: 'No pending edit found for this entry.' });
    }

    const pending = allPending[idx];

    // Check TTL
    if (Date.now() - pending.createdAt > PENDING_EDIT_TTL_MS) {
        allPending.splice(idx, 1);
        if (allPending.length === 0) pendingEdits.delete(userId);
        return res.status(410).json({ error: 'expired' });
    }

    // Execute the edit via toolEditEntry with confirmed: true
    const result = await toolEditEntry(userId, { entryId: pending.entryId, confirmed: true, ...pending.changes });

    // Remove this specific pending edit
    allPending.splice(idx, 1);
    if (allPending.length === 0) pendingEdits.delete(userId);

    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    res.json(result);
}));

// Cancel a pending AI edit via UI button
app.post('/api/ai/cancel-edit', requireAuth, editActionLimiter, (req, res) => {
    const userId = req.user.id;
    const allPending = pendingEdits.get(userId);

    if (!allPending || allPending.length === 0) {
        return res.json({ success: true });
    }

    const requestedEntryId = req.body.entryId != null ? Number(req.body.entryId) : null;
    if (requestedEntryId != null) {
        // Cancel specific edit
        const idx = allPending.findIndex(e => e.entryId === requestedEntryId);
        if (idx !== -1) allPending.splice(idx, 1);
        if (allPending.length === 0) pendingEdits.delete(userId);
    } else {
        // Cancel all pending edits
        pendingEdits.delete(userId);
    }

    res.json({ success: true });
});

// Set up multer for file uploads (store in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files are allowed'), false);
        }
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.pdf') {
            return cb(new Error('Only PDF files are allowed'), false);
        }
        cb(null, true);
    }
});

// PDF processing endpoint with AI (Gemini, OpenAI, or Anthropic based on user preference)
app.post('/api/process-pdf', requireAuth, pdfUploadLimiter, (req, res, next) => {
    upload.single('pdfFile')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ message: 'File too large. Maximum size is 10MB.' });
            }
            return res.status(400).json({ message: err.message });
        }
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No PDF file uploaded.' });
    }

    // Determine provider: use user's stored preference (default gemini)
    const provider = resolveProvider(req.user);

    // Resolve API key: stored user key → server .env key
    // (Anthropic uses resolveAnthropicAuth — see below.)
    let apiKey = null;
    let anthropicAuth = null;
    if (provider === 'openai') {
        if (req.user.openaiApiKey) {
            try {
                apiKey = decryptString(req.user.openaiApiKey.encryptedData, req.user.openaiApiKey.iv);
            } catch (e) {
                console.error('Failed to decrypt stored OpenAI API key:', e.message);
            }
        }
        if (!apiKey) apiKey = config.openaiApiKey;
        if (!apiKey) {
            return res.status(400).json({ message: 'No OpenAI API key available. Please add one in Settings.' });
        }
    } else if (provider === 'anthropic') {
        anthropicAuth = resolveAnthropicAuth(req.user);
        if (!anthropicAuth.authToken && !anthropicAuth.apiKey) {
            return res.status(400).json({ message: 'No Anthropic credentials available. Please add an API key or Claude Code OAuth token in Settings.' });
        }
    } else if (provider === 'copilot') {
        if (!hasCopilotCredentials(req.user)) {
            return res.status(400).json({ message: 'No GitHub Copilot OAuth token available. Please add one in Settings.' });
        }
    } else {
        if (req.user.geminiApiKey) {
            try {
                apiKey = decryptString(req.user.geminiApiKey.encryptedData, req.user.geminiApiKey.iv);
            } catch (e) {
                console.error('Failed to decrypt stored Gemini API key:', e.message);
            }
        }
        if (!apiKey) apiKey = config.geminiApiKey;
        if (!apiKey) {
            return res.status(400).json({ message: 'No Gemini API key available. Please provide an API key in Settings.' });
        }
    }

    try {
        // Parse the PDF buffer
        const data = await pdfParse(req.file.buffer);
        const text = data.text;

        console.log('=== PDF EXTRACTED TEXT ===');
        console.log(text.substring(0, 500) + '...');
        console.log('=== END PDF TEXT ===');

        // Get current month as fallback
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Build the prompt
        const prompt = `Extract financial transactions from this document.

RULES:
- Convert dates to YYYY-MM format. Use ${currentMonth} if no date found.
- Amount must be a positive number (convert "R$ 1.234,56" to 1234.56)
- Type is "expense" for purchases/bills/payments, "income" for deposits/salary/refunds
- Skip totals and subtotals, only individual transactions
- Choose the most appropriate category tag for each transaction
- tag must be one of: food, groceries, transport, travel, entertainment, utilities, healthcare, education, shopping, subscription, housing, salary, freelance, investment, transfer, wedding, other
- Return JSON with an "entries" array, each item having: month (YYYY-MM), amount (number), description (string), tag (string), type ("expense" or "income")

DOCUMENT:
${text}`;

        let aiResponse;

        if (provider === 'openai') {
            console.log('Starting OpenAI API call...');
            const openaiClient = new OpenAI({ apiKey });
            try {
                const response = await openaiClient.chat.completions.create({
                    model: resolveModel(req.user, 'openai', 'pdf'),
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    temperature: 0.2
                });
                aiResponse = response.choices[0]?.message?.content || '{}';
            } catch (openaiError) {
                console.error('OpenAI API error details:', openaiError.message);
                throw openaiError;
            }
            console.log('OpenAI response received, length:', aiResponse.length);
        } else if (provider === 'anthropic') {
            console.log('Starting Anthropic API call...');
            const anthropicClient = createAnthropicClient(anthropicAuth);
            try {
                const response = await anthropicClient.messages.create({
                    model: resolveModel(req.user, 'anthropic', 'pdf'),
                    max_tokens: 4096,
                    system: 'You are a financial document parser. Respond with valid JSON only — no markdown, no code fences, no commentary.',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.2
                });
                aiResponse = response.content
                    .filter(b => b.type === 'text')
                    .map(b => b.text)
                    .join('') || '{}';
            } catch (anthropicError) {
                console.error('Anthropic API error details:', anthropicError.message);
                throw anthropicError;
            }
            console.log('Anthropic response received, length:', aiResponse.length);
        } else if (provider === 'copilot') {
            console.log('Starting GitHub Copilot API call...');
            // System prompt nudges JSON-only output; not all Copilot-served
            // models honour `response_format: json_object`, so we also strip
            // markdown fences below (see cleanedResponse).
            const copilotMessages = [
                { role: 'system', content: 'You are a financial document parser. Respond with valid JSON only — no markdown, no code fences, no commentary.' },
                { role: 'user', content: prompt }
            ];
            try {
                const response = await copilotCallWithRetry(req.user, (client) =>
                    client.chat.completions.create({
                        model: resolveModel(req.user, 'copilot', 'pdf'),
                        messages: copilotMessages,
                        response_format: { type: 'json_object' },
                        temperature: 0.2
                    })
                );
                aiResponse = response.choices[0]?.message?.content || '{}';
            } catch (copilotError) {
                console.error('Copilot API error details:', copilotError.message);
                throw copilotError;
            }
            console.log('Copilot response received, length:', aiResponse.length);
        } else {
            // Define the response schema for Gemini structured output
            const responseSchema = {
                type: Type.OBJECT,
                properties: {
                    entries: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                month: {
                                    type: Type.STRING,
                                    description: 'Transaction date in YYYY-MM format'
                                },
                                amount: {
                                    type: Type.NUMBER,
                                    description: 'Transaction amount as positive number'
                                },
                                description: {
                                    type: Type.STRING,
                                    description: 'Description of the transaction'
                                },
                                tag: {
                                    type: Type.STRING,
                                    enum: ['food', 'groceries', 'transport', 'travel', 'entertainment', 'utilities',
                                           'healthcare', 'education', 'shopping', 'subscription', 'housing',
                                           'salary', 'freelance', 'investment', 'transfer', 'wedding', 'other'],
                                    description: 'Category tag for the transaction'
                                },
                                type: {
                                    type: Type.STRING,
                                    enum: ['expense', 'income'],
                                    description: 'Transaction type'
                                }
                            },
                            required: ['month', 'amount', 'description', 'tag', 'type']
                        }
                    }
                },
                required: ['entries']
            };

            const requestGenAI = new GoogleGenAI({ apiKey });
            console.log('Starting Gemini API call...');
            console.log('Prompt length:', prompt.length, 'chars');
            let response;
            try {
                response = await requestGenAI.models.generateContent({
                    model: resolveModel(req.user, 'gemini', 'pdf'),
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: responseSchema,
                        temperature: 0.2
                    }
                });
            } catch (geminiError) {
                console.error('Gemini API error details:', geminiError.message);
                console.error('Gemini API error cause:', geminiError.cause);
                console.error('Full error:', JSON.stringify(geminiError, Object.getOwnPropertyNames(geminiError)));
                throw geminiError;
            }
            aiResponse = response.text;
            console.log('Gemini response received, length:', aiResponse.length);
        }

        // Strip markdown code fences if present (Anthropic may wrap JSON in ```json...```)
        let cleanedResponse = aiResponse.trim();
        const fenceMatch = cleanedResponse.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
        if (fenceMatch) cleanedResponse = fenceMatch[1].trim();

        // Parse the structured JSON response
        let entries = [];
        try {
            const parsed = JSON.parse(cleanedResponse);

            // Extract entries from the response
            if (parsed.entries && Array.isArray(parsed.entries)) {
                entries = parsed.entries;
            } else if (Array.isArray(parsed)) {
                entries = parsed;
            }

            // Validate and clean the entries
            entries = entries.filter(entry => {
                if (!entry || !entry.description) return false;
                const amount = typeof entry.amount === 'string'
                    ? parseFloat(entry.amount.replace(/[^\d.-]/g, '').replace(',', '.'))
                    : entry.amount;
                return entry.month && !isNaN(amount) && amount > 0;
            });

            // Normalize: convert single tag to tags array, set default type
            entries = entries.map(entry => {
                // Handle tag (single string) to tags array conversion
                let tags = [];
                if (entry.tag && typeof entry.tag === 'string') {
                    tags = [entry.tag.toLowerCase().trim()];
                } else if (Array.isArray(entry.tags)) {
                    tags = entry.tags.slice(0, 1).map(t => String(t).toLowerCase().trim());
                }

                // Determine type (default to expense if not specified)
                let type = 'expense';
                if (entry.type && (entry.type === 'income' || entry.type === 'expense')) {
                    type = entry.type;
                }

                return {
                    ...entry,
                    tags,
                    type,
                    userId: req.user.id,  // Associate with current user
                    id: Date.now() + Math.floor(Math.random() * 10000)
                };
            });

        } catch (parseError) {
            console.error('Error parsing AI response:', parseError.message);
            return res.status(500).json({
                message: 'Failed to parse AI response. Please check the PDF format.'
            });
        }

        console.log('PDF processing complete, extracted', entries.length, 'entries');
        res.json(entries);
    } catch (error) {
        console.error('Error processing PDF with AI:', error);

        // Provide more specific error messages with appropriate status codes
        let errorMessage = 'Failed to process PDF with AI. Please check your API key and try again.';
        let statusCode = 500;
        const providerName = provider === 'openai' ? 'OpenAI'
            : provider === 'anthropic' ? 'Anthropic'
            : provider === 'copilot' ? 'GitHub Copilot'
            : 'Gemini';
        if (error.message?.includes('API key') || error.status === 401) {
            const credLabel = (provider === 'copilot') ? 'GitHub Copilot token'
                : (provider === 'anthropic') ? 'Anthropic credentials'
                : `${providerName} API key`;
            errorMessage = `Invalid ${credLabel}. Please check your settings and try again.`;
            statusCode = 400;
        } else if (error.message?.includes('quota') || error.message?.includes('credit balance') || error.status === 429) {
            errorMessage = `${providerName} API quota exceeded. Please try again later.`;
            statusCode = 429;
        } else if (error.message?.includes('safety')) {
            errorMessage = 'Content was blocked by safety filters.';
        }

        res.status(statusCode).json({ message: errorMessage });
    }
});

// Global error handler - suppress stack traces in production
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ message: 'Invalid JSON in request body' });
    }
    console.error('Unhandled error:', err.message);
    res.status(err.status || 500).json({ message: 'Internal server error' });
});

// HTTPS configuration

const PORT = config.port;

// Test DB connection and run migrations before starting
(async () => {
    try {
        await testDbConnection();
        await migrateInitialAdmin();
    } catch (err) {
        console.error('FATAL: Database initialization failed:', err.message);
        process.exit(1);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on https://localhost:${PORT}`);

        // Verify SMTP configuration
        if (smtpTransport) {
            console.log('SMTP configured — self-service password reset is available.');
        } else {
            console.log('No SMTP configured — password resets require admin action.');
        }

        // Verify PayPal configuration
        if (paypalClient) {
            console.log(`PayPal configured — invite code purchases available at R$ ${config.inviteCodePrice}`);
        } else {
            console.log('No PayPal configured — invite code purchases disabled.');
        }

        // Verify Gemini API configuration
        if (config.geminiApiKey) {
            console.log(`Gemini AI configured with model: ${GEMINI_MODEL}`);
            const startupGenAI = new GoogleGenAI({ apiKey: config.geminiApiKey });
            startupGenAI.models.generateContent({
                model: GEMINI_MODEL,
                contents: 'Hello'
            }).then(() => {
                console.log('Gemini API key verified successfully.');
            }).catch((error) => {
                console.warn('Warning: Gemini API key may be invalid:', error.message);
            });
        } else {
            console.log('No global GEMINI_API_KEY configured. PDF processing will use per-user stored keys.');
        }

        // Verify OpenAI API configuration
        if (config.openaiApiKey) {
            console.log(`OpenAI configured with model: ${OPENAI_MODEL}`);
            const openaiStartup = new OpenAI({ apiKey: config.openaiApiKey });
            openaiStartup.models.list().then(() => {
                console.log('OpenAI API key verified successfully.');
            }).catch((error) => {
                console.warn('Warning: OpenAI API key may be invalid:', error.message);
            });
        } else {
            console.log('No global OPENAI_API_KEY configured. OpenAI features will use per-user stored keys.');
        }

        // Verify Anthropic API configuration (API key)
        if (config.anthropicApiKey) {
            console.log(`Anthropic configured with model: ${ANTHROPIC_MODEL}`);
            const anthropicStartup = new Anthropic({ apiKey: config.anthropicApiKey });
            anthropicStartup.models.list({ limit: 1 }).then(() => {
                console.log('Anthropic API key verified successfully.');
            }).catch((error) => {
                console.warn('Warning: Anthropic API key may be invalid:', error.message);
            });
        } else {
            console.log('No global ANTHROPIC_API_KEY configured. Anthropic features will use per-user stored keys.');
        }

        // Verify Claude Code OAuth token (issue #47)
        if (config.claudeOauthToken) {
            console.log('Claude Code OAuth token configured (env CLAUDE_CODE_OAUTH_TOKEN).');
            const oauthStartup = createAnthropicClient({ authToken: config.claudeOauthToken, apiKey: null });
            oauthStartup.models.list({ limit: 1 }).then(() => {
                console.log('Claude Code OAuth token verified successfully.');
            }).catch((error) => {
                console.warn('Warning: Claude Code OAuth token may be invalid:', error.message);
            });
        } else {
            console.log('No global CLAUDE_CODE_OAUTH_TOKEN configured. Per-user OAuth tokens (if any) will still work.');
        }

        // Verify GitHub Copilot OAuth token (env)
        if (config.githubCopilotToken) {
            console.log(`GitHub Copilot OAuth token configured (env GITHUB_COPILOT_TOKEN). Default model: ${COPILOT_MODEL}`);
            getCopilotSessionToken(config.githubCopilotToken).then(() => {
                console.log('GitHub Copilot OAuth token verified successfully (session token exchanged).');
            }).catch((error) => {
                console.warn('Warning: GitHub Copilot OAuth token may be invalid:', error.message);
            });
        } else {
            console.log('No global GITHUB_COPILOT_TOKEN configured. Per-user Copilot OAuth tokens (if any) will still work.');
        }
    });
})();