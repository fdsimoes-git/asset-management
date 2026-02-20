#!/usr/bin/env node

/**
 * ENCRYPTION_KEY Rotation Script
 *
 * Decrypts data/entries.json and data/users.json with the current key,
 * then re-encrypts both files with a freshly generated key.
 *
 * Usage:
 *   sudo systemctl stop asset-management
 *   node rotate-encryption-key.js
 *   sudo systemctl edit asset-management   # update ENCRYPTION_KEY
 *   sudo systemctl daemon-reload
 *   sudo systemctl restart asset-management
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── Paths ───────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ALGORITHM = 'aes-256-cbc';

// ── Load current key via config.js (validates format & presence) ────
const config = require('./config');
const OLD_KEY = config.encryptionKey; // Buffer, 32 bytes
const OLD_KEY_HEX = OLD_KEY.toString('hex');

// ── AES-256-CBC helpers (same logic as server.js) ───────────────────
function encryptData(key, data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { iv: iv.toString('hex'), encryptedData: encrypted };
}

function decryptData(key, encryptedData, iv) {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

function encryptString(key, value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { iv: iv.toString('hex'), encryptedData: encrypted };
}

function decryptString(key, encryptedData, iv) {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// ── Helpers ─────────────────────────────────────────────────────────
function pause(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

function rollback() {
    console.error('Attempting automatic rollback from .bak files...');
    for (const filePath of [ENTRIES_FILE, USERS_FILE]) {
        const bakPath = filePath + '.bak';
        if (fs.existsSync(bakPath)) {
            try {
                fs.copyFileSync(bakPath, filePath);
                console.error(`  Restored ${path.basename(filePath)} from ${path.basename(bakPath)}`);
            } catch (copyErr) {
                console.error(`  Failed to restore ${path.basename(filePath)}: ${copyErr.message}`);
            }
        }
    }
}

function reEncryptFile(filePath, oldKey, newKey) {
    if (!fs.existsSync(filePath)) {
        console.log(`  Skipping ${path.basename(filePath)} (file does not exist)`);
        return;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const stored = JSON.parse(raw);

    // Validate decryption with old key before touching anything
    let plaintext;
    try {
        plaintext = decryptData(oldKey, stored.encryptedData, stored.iv);
    } catch (err) {
        throw new Error(`Failed to decrypt ${path.basename(filePath)} with old key: ${err.message}`);
    }

    // Validate decrypted structure
    if (filePath === ENTRIES_FILE && !Array.isArray(plaintext)) {
        throw new Error(`Decrypted ${path.basename(filePath)} is not an array as expected`);
    }
    if (filePath === USERS_FILE) {
        const isObj = plaintext !== null && typeof plaintext === 'object' && !Array.isArray(plaintext);
        if (!isObj || !plaintext.users || !plaintext.nextUserId || !plaintext.inviteCodes) {
            throw new Error(`Decrypted ${path.basename(filePath)} does not have the expected users/nextUserId/inviteCodes structure`);
        }
    }

    // Re-encrypt API keys inside entries (entries.json only)
    if (filePath === ENTRIES_FILE) {
        for (const entry of plaintext) {
            if (entry.geminiApiKey && entry.geminiApiKey.encryptedData) {
                const apiKey = decryptString(oldKey, entry.geminiApiKey.encryptedData, entry.geminiApiKey.iv);
                entry.geminiApiKey = encryptString(newKey, apiKey);
            }
        }
    }

    // Create .bak before writing (timestamped if one already exists)
    let bakPath = filePath + '.bak';
    if (fs.existsSync(bakPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        bakPath = path.join(DATA_DIR, `${path.basename(filePath)}.${timestamp}.bak`);
        console.log(`  Warning: .bak already exists, using ${path.basename(bakPath)}`);
    }
    fs.copyFileSync(filePath, bakPath);
    console.log(`  Created backup: ${path.basename(bakPath)}`);

    // Re-encrypt and write
    const encrypted = encryptData(newKey, plaintext);
    fs.writeFileSync(filePath, JSON.stringify(encrypted, null, 2));
    console.log(`  Re-encrypted:   ${path.basename(filePath)}`);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
    const NEW_KEY = crypto.randomBytes(32);
    const NEW_KEY_HEX = NEW_KEY.toString('hex');

    console.log('');
    console.log('=== ENCRYPTION KEY ROTATION ===');
    console.log('');
    console.log(`Old key: ${OLD_KEY_HEX}`);
    console.log('');
    console.log('Save the old key to your password manager NOW.');
    console.log('You will need it to decrypt Google Drive backups made before this rotation.');
    console.log('');

    await pause('Press Enter after you have saved the old key...');

    // Re-encrypt data files
    console.log('--- Re-encrypting data files ---');
    try {
        reEncryptFile(ENTRIES_FILE, OLD_KEY, NEW_KEY);
        reEncryptFile(USERS_FILE, OLD_KEY, NEW_KEY);
    } catch (err) {
        console.error('');
        console.error(`ERROR: ${err.message}`);
        console.error('');
        rollback();
        process.exit(1);
    }
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
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
