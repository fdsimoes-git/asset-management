#!/usr/bin/env node

/**
 * ENCRYPTION_KEY Rotation Script (PostgreSQL version)
 *
 * Reads all encrypted fields from the database, decrypts with the current key,
 * re-encrypts with a freshly generated key, and updates each row in a transaction.
 *
 * Encrypted user fields: email, gemini_api_key, openai_api_key,
 *                        anthropic_api_key, totp_secret
 *
 * Usage:
 *   sudo systemctl stop asset-management
 *   node rotate-encryption-key.js
 *   sudo systemctl edit asset-management   # update ENCRYPTION_KEY
 *   sudo systemctl daemon-reload
 *   sudo systemctl restart asset-management
 */

require('dotenv').config();

const crypto = require('crypto');
const readline = require('readline');
const { pool } = require('./db/pool');

const ALGORITHM = 'aes-256-cbc';

// ── Load current key via config.js (validates format & presence) ────
const config = require('./config');
const OLD_KEY = config.encryptionKey; // Buffer, 32 bytes
const OLD_KEY_HEX = OLD_KEY.toString('hex');

// ── AES-256-CBC helpers ─────────────────────────────────────────────
function encryptString(key, value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return JSON.stringify({ iv: iv.toString('hex'), encryptedData: encrypted });
}

function decryptString(key, jsonStr) {
    const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(parsed.iv, 'hex'));
    let decrypted = decipher.update(parsed.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function isEncryptedField(value) {
    if (!value || typeof value !== 'string') return false;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed.iv === 'string' && typeof parsed.encryptedData === 'string';
    } catch {
        return false;
    }
}

// ── Helpers ─────────────────────────────────────────────────────────
function pause(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

const ENCRYPTED_COLUMNS = [
    'email',
    'gemini_api_key',
    'openai_api_key',
    'anthropic_api_key',
    'totp_secret'
];

// ── Main ────────────────────────────────────────────────────────────
async function main() {
    const NEW_KEY = crypto.randomBytes(32);
    const NEW_KEY_HEX = NEW_KEY.toString('hex');

    console.log('');
    console.log('=== ENCRYPTION KEY ROTATION (PostgreSQL) ===');
    console.log('');
    console.log(`Old key: ${OLD_KEY_HEX}`);
    console.log('');
    console.log('Save the old key to your password manager NOW.');
    console.log('You will need it to decrypt database backups made before this rotation.');
    console.log('');

    await pause('Press Enter after you have saved the old key...');

    const client = await pool.connect();
    try {
        // Fetch all users
        const { rows: users } = await client.query('SELECT id, ' + ENCRYPTED_COLUMNS.join(', ') + ' FROM users');
        console.log(`Found ${users.length} users to process.`);

        // Validate: try decrypting all fields with old key BEFORE starting the transaction
        console.log('');
        console.log('--- Validating decryption with old key ---');
        let fieldCount = 0;
        for (const user of users) {
            for (const col of ENCRYPTED_COLUMNS) {
                if (isEncryptedField(user[col])) {
                    try {
                        decryptString(OLD_KEY, user[col]);
                        fieldCount++;
                    } catch (err) {
                        throw new Error(`Failed to decrypt ${col} for user id=${user.id}: ${err.message}`);
                    }
                }
            }
        }
        console.log(`Validated ${fieldCount} encrypted fields across ${users.length} users.`);

        // Re-encrypt in a transaction
        console.log('');
        console.log('--- Re-encrypting fields ---');
        await client.query('BEGIN');

        let updatedUsers = 0;
        for (const user of users) {
            const updates = {};
            for (const col of ENCRYPTED_COLUMNS) {
                if (isEncryptedField(user[col])) {
                    const plaintext = decryptString(OLD_KEY, user[col]);
                    updates[col] = encryptString(NEW_KEY, plaintext);
                }
            }

            const cols = Object.keys(updates);
            if (cols.length === 0) continue;

            const setClauses = cols.map((col, i) => `${col} = $${i + 1}`);
            const values = cols.map(col => updates[col]);
            values.push(user.id);

            await client.query(
                `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${values.length}`,
                values
            );
            updatedUsers++;
        }

        // Verify: decrypt a sample field with the new key
        if (fieldCount > 0) {
            const { rows: verifyRows } = await client.query(
                'SELECT id, ' + ENCRYPTED_COLUMNS.join(', ') + ' FROM users'
            );
            let verifyCount = 0;
            for (const user of verifyRows) {
                for (const col of ENCRYPTED_COLUMNS) {
                    if (isEncryptedField(user[col])) {
                        try {
                            decryptString(NEW_KEY, user[col]);
                            verifyCount++;
                        } catch (err) {
                            await client.query('ROLLBACK');
                            throw new Error(`Verification failed: cannot decrypt ${col} for user id=${user.id} with new key: ${err.message}`);
                        }
                    }
                }
            }
            console.log(`Verified ${verifyCount} fields decrypt correctly with new key.`);

            if (verifyCount !== fieldCount) {
                await client.query('ROLLBACK');
                throw new Error(`Field count mismatch: expected ${fieldCount}, verified ${verifyCount}. Rolled back.`);
            }
        }

        await client.query('COMMIT');
        console.log(`Updated ${updatedUsers} users.`);
        console.log('--- Done ---');

        console.log('');
        console.log('=== ROTATION COMPLETE ===');
        console.log('');
        console.log(`New key: ${NEW_KEY_HEX}`);
        console.log('');
        console.log('Update the systemd service with the new key:');
        console.log('');
        console.log('  sudo systemctl edit --full asset-management');
        console.log(`  # Set ENCRYPTION_KEY to: ${NEW_KEY_HEX}`);
        console.log('  sudo systemctl daemon-reload');
        console.log('  sudo systemctl restart asset-management');
        console.log('');
        console.log('Remember to clear your terminal history after updating the key.');
        console.log('');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('');
        console.error(`ERROR: ${err.message}`);
        console.error('Transaction rolled back — no data was modified.');
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
