#!/usr/bin/env node
/**
 * One-shot migration: Encrypted JSON files → PostgreSQL.
 *
 * Idempotent — uses ON CONFLICT DO NOTHING for all inserts.
 * Runs inside a single transaction; rolls back on any mismatch.
 *
 * Usage:
 *   node db/migrate-json-to-pg.js
 *
 * Requires: ENCRYPTION_KEY, PGUSER, PGPASSWORD (+ PGHOST, PGDATABASE) in env or .env
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./pool');

// Load env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
    console.error('FATAL: ENCRYPTION_KEY must be set (64 hex chars).');
    process.exit(1);
}
const KEY = Buffer.from(ENCRYPTION_KEY, 'hex');
const ALGORITHM = 'aes-256-cbc';

function decryptData(encryptedData, iv) {
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

function stringifyJsonField(val) {
    if (val == null) return null;
    if (typeof val === 'string') return val;
    return JSON.stringify(val);
}

async function migrate() {
    const DATA_DIR = path.join(__dirname, '..', 'data');
    const USERS_FILE = path.join(DATA_DIR, 'users.json');
    const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');

    // ── Load & decrypt JSON files ────────────────────────────────────
    let users = [], inviteCodes = [], paypalOrders = [], entries = [];

    if (fs.existsSync(USERS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        if (raw.iv && raw.encryptedData) {
            const decrypted = decryptData(raw.encryptedData, raw.iv);
            users = decrypted.users || [];
            inviteCodes = decrypted.inviteCodes || [];
            paypalOrders = decrypted.paypalOrders || decrypted.pixCharges || [];
        }
        console.log(`Loaded ${users.length} users, ${inviteCodes.length} invite codes, ${paypalOrders.length} PayPal orders from users.json`);
    } else {
        console.log('No users.json found — skipping user data.');
    }

    if (fs.existsSync(ENTRIES_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
        if (raw.iv && raw.encryptedData) {
            entries = decryptData(raw.encryptedData, raw.iv);
        } else if (Array.isArray(raw)) {
            entries = raw;
        }
        console.log(`Loaded ${entries.length} entries from entries.json`);
    } else {
        console.log('No entries.json found — skipping entry data.');
    }

    // ── Insert into PostgreSQL ───────────────────────────────────────
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Insert users (preserving IDs)
        let usersInserted = 0;
        for (const u of users) {
            const result = await client.query(
                `INSERT INTO users (id, username, password_hash, role, email, gemini_api_key,
                 openai_api_key, anthropic_api_key, totp_secret, totp_enabled, backup_codes,
                 ai_provider, ai_model, partner_id, partner_linked_at, is_active, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    u.id,
                    u.username,
                    u.passwordHash,
                    u.role || 'user',
                    stringifyJsonField(u.email),
                    stringifyJsonField(u.geminiApiKey),
                    stringifyJsonField(u.openaiApiKey),
                    stringifyJsonField(u.anthropicApiKey),
                    stringifyJsonField(u.totpSecret),
                    u.totpEnabled || false,
                    u.backupCodes || [],
                    u.aiProvider || null,
                    u.aiModel || null,
                    u.partnerId || null,
                    u.partnerLinkedAt || null,
                    u.isActive !== undefined ? u.isActive : true,
                    u.createdAt || new Date().toISOString(),
                    u.updatedAt || new Date().toISOString()
                ]
            );
            if (result.rowCount > 0) usersInserted++;
        }
        console.log(`Users: ${usersInserted} inserted (${users.length - usersInserted} already existed)`);

        // Set user ID sequence
        if (users.length > 0) {
            const maxUserId = Math.max(...users.map(u => u.id));
            await client.query(`SELECT setval('users_id_seq', $1)`, [maxUserId]);
            console.log(`Set users_id_seq to ${maxUserId}`);
        }

        // Insert invite codes
        let codesInserted = 0;
        for (const ic of inviteCodes) {
            const result = await client.query(
                `INSERT INTO invite_codes (code, created_at, created_by, is_used, used_at, used_by)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (code) DO NOTHING`,
                [
                    ic.code,
                    ic.createdAt || new Date().toISOString(),
                    String(ic.createdBy),
                    ic.isUsed || false,
                    ic.usedAt || null,
                    ic.usedBy || null
                ]
            );
            if (result.rowCount > 0) codesInserted++;
        }
        console.log(`Invite codes: ${codesInserted} inserted (${inviteCodes.length - codesInserted} already existed)`);

        // Insert PayPal orders
        let ordersInserted = 0;
        for (const o of paypalOrders) {
            const result = await client.query(
                `INSERT INTO paypal_orders (order_id, amount, currency, status, invite_code, user_id, created_at, confirmed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (order_id) DO NOTHING`,
                [
                    o.orderId,
                    o.amount,
                    o.currency || 'BRL',
                    o.status,
                    o.inviteCode || null,
                    o.userId || null,
                    o.createdAt || new Date().toISOString(),
                    o.confirmedAt || null
                ]
            );
            if (result.rowCount > 0) ordersInserted++;
        }
        console.log(`PayPal orders: ${ordersInserted} inserted (${paypalOrders.length - ordersInserted} already existed)`);

        // Insert entries (preserving IDs)
        let entriesInserted = 0;
        for (const e of entries) {
            const result = await client.query(
                `INSERT INTO entries (id, user_id, month, type, amount, description, tags, is_couple_expense)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    e.id,
                    e.userId,
                    e.month,
                    e.type,
                    e.amount,
                    e.description,
                    e.tags || [],
                    e.isCoupleExpense || false
                ]
            );
            if (result.rowCount > 0) entriesInserted++;
        }
        console.log(`Entries: ${entriesInserted} inserted (${entries.length - entriesInserted} already existed)`);

        // Set entries ID sequence
        if (entries.length > 0) {
            const maxEntryId = Math.max(...entries.map(e => e.id));
            await client.query(`SELECT setval('entries_id_seq', $1)`, [maxEntryId]);
            console.log(`Set entries_id_seq to ${maxEntryId}`);
        }

        // ── Verification ─────────────────────────────────────────────
        const counts = {};
        for (const table of ['users', 'entries', 'invite_codes', 'paypal_orders']) {
            const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
            counts[table] = rows[0].c;
        }

        console.log('\n── Verification ──');
        console.log(`  users:         ${counts.users} rows (source: ${users.length})`);
        console.log(`  entries:       ${counts.entries} rows (source: ${entries.length})`);
        console.log(`  invite_codes:  ${counts.invite_codes} rows (source: ${inviteCodes.length})`);
        console.log(`  paypal_orders: ${counts.paypal_orders} rows (source: ${paypalOrders.length})`);

        // Allow counts >= source (idempotent re-runs may already have data)
        const ok = counts.users >= users.length
            && counts.entries >= entries.length
            && counts.invite_codes >= inviteCodes.length
            && counts.paypal_orders >= paypalOrders.length;

        if (!ok) {
            console.error('\nROW COUNT MISMATCH — ROLLING BACK');
            await client.query('ROLLBACK');
            process.exit(1);
        }

        await client.query('COMMIT');
        console.log('\nMigration committed successfully.');
        console.log('JSON files have NOT been modified or deleted.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed — rolled back:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
