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
const { execSync } = require('child_process');
const readline = require('readline');

// ── Paths ───────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BACKUP_SCRIPT = path.join(__dirname, 'backup.sh');

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

    // Re-encrypt API keys inside entries (entries.json only)
    if (filePath === ENTRIES_FILE && Array.isArray(plaintext)) {
        for (const entry of plaintext) {
            if (entry.geminiApiKey && entry.geminiApiKey.encryptedData) {
                const apiKey = decryptString(oldKey, entry.geminiApiKey.encryptedData, entry.geminiApiKey.iv);
                entry.geminiApiKey = encryptString(newKey, apiKey);
            }
        }
    }

    // Create .bak before writing
    const bakPath = filePath + '.bak';
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

    // Run backup.sh
    console.log('');
    console.log('--- Running backup.sh (Google Drive snapshot) ---');
    try {
        execSync(`bash "${BACKUP_SCRIPT}"`, { stdio: 'inherit' });
    } catch (err) {
        console.error('');
        console.error('backup.sh failed. Aborting rotation — no files were modified.');
        process.exit(1);
    }
    console.log('--- Backup complete ---');
    console.log('');

    // Re-encrypt data files
    console.log('--- Re-encrypting data files ---');
    try {
        reEncryptFile(ENTRIES_FILE, OLD_KEY, NEW_KEY);
        reEncryptFile(USERS_FILE, OLD_KEY, NEW_KEY);
    } catch (err) {
        console.error('');
        console.error(`ERROR: ${err.message}`);
        console.error('');
        console.error('Rollback: restore from .bak files:');
        console.error(`  cp ${ENTRIES_FILE}.bak ${ENTRIES_FILE}`);
        console.error(`  cp ${USERS_FILE}.bak ${USERS_FILE}`);
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
    console.log('  sudo systemctl edit asset-management');
    console.log(`  # Set ENCRYPTION_KEY to: ${NEW_KEY_HEX}`);
    console.log('  sudo systemctl daemon-reload');
    console.log('  sudo systemctl restart asset-management');
    console.log('');
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
