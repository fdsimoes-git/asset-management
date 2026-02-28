
const config = require('./config');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer'); // For handling file uploads
const rateLimit = require('express-rate-limit');
const pdfParse = require('pdf-parse'); // For parsing PDF files
const { GoogleGenAI, Type } = require('@google/genai');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');
const otplib = require('otplib');
const QRCode = require('qrcode');

const app = express();

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

// Model list cache for /api/ai/models endpoint
const modelListCache = new Map(); // "provider:keyHash" → { models, timestamp }
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * Resolve AI model: user preference → hardcoded default.
 * @param {object} user - user object
 * @param {'openai'|'gemini'} provider
 * @param {'chat'|'pdf'} usage
 */
function resolveModel(user, provider, usage) {
    if (user.aiModel) return user.aiModel;
    if (provider === 'openai') {
        return usage === 'chat' ? OPENAI_CHAT_MODEL : OPENAI_MODEL;
    }
    return usage === 'chat' ? GEMINI_CHAT_MODEL : GEMINI_MODEL;
}

// Data file path
const DATA_FILE = path.join(__dirname, 'data', 'entries.json');

const ENCRYPTION_KEY = config.encryptionKey;
const ALGORITHM = 'aes-256-cbc';

// Function to encrypt data
function encryptData(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { iv: iv.toString('hex'), encryptedData: encrypted };
}

// Function to decrypt data
function decryptData(encryptedData, iv) {
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

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

// Initialize entries from file or create empty array
let entries = [];
let nextId = 1;

// Load entries from file
function loadEntries() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.iv && parsed.encryptedData) {
                entries = decryptData(parsed.encryptedData, parsed.iv);
            } else {
                entries = parsed;
            }
            // Set nextId to the highest id + 1
            nextId = Math.max(...entries.map(e => e.id), 0) + 1;
        }
    } catch (error) {
        console.error('Error loading entries:', error);
        entries = [];
    }
}

// Save entries to file
function saveEntries() {
    try {
        // Ensure data directory exists
        const dataDir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const encrypted = encryptData(entries);
        fs.writeFileSync(DATA_FILE, JSON.stringify(encrypted, null, 2));
    } catch (error) {
        console.error('Error saving entries:', error);
    }
}

// ============ USER STORAGE SYSTEM ============

// Users file path
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Initialize users storage
let users = [];
let nextUserId = 1;
let inviteCodes = [];
let paypalOrders = [];

// Load users from file
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.iv && parsed.encryptedData) {
                const decrypted = decryptData(parsed.encryptedData, parsed.iv);
                users = decrypted.users || [];
                nextUserId = decrypted.nextUserId || 1;
                inviteCodes = decrypted.inviteCodes || [];
                // Migration: pixCharges → paypalOrders
                paypalOrders = decrypted.paypalOrders || decrypted.pixCharges || [];
            }
        }
    } catch (error) {
        console.error('Error loading users:', error);
        users = [];
        inviteCodes = [];
        paypalOrders = [];
    }
}

// Save users to file
function saveUsers() {
    try {
        const dataDir = path.dirname(USERS_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const encrypted = encryptData({ users, nextUserId, inviteCodes, paypalOrders });
        fs.writeFileSync(USERS_FILE, JSON.stringify(encrypted, null, 2));
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

// Find user by username (case-insensitive)
function findUserByUsername(username) {
    return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

// Find user by ID
function findUserById(id) {
    return users.find(u => u.id === id);
}

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
const resetAttempts = new Map(); // per-username failed reset code attempts
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

function checkAndRecordResetAttempt(username) {
    const key = username.toLowerCase();
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
    resetAttempts.delete(username.toLowerCase());
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

function findInviteCode(code) {
    return inviteCodes.find(ic => ic.code === code.toUpperCase());
}

function createInviteCode(adminUserId) {
    let code;
    do {
        code = generateInviteCode();
    } while (findInviteCode(code));

    const inviteCode = {
        code,
        createdAt: new Date().toISOString(),
        createdBy: adminUserId,
        isUsed: false,
        usedAt: null,
        usedBy: null
    };

    inviteCodes.push(inviteCode);
    saveUsers();
    return inviteCode;
}

function consumeInviteCode(code, userId) {
    const invite = findInviteCode(code);
    if (!invite || invite.isUsed) return false;
    invite.isUsed = true;
    invite.usedAt = new Date().toISOString();
    invite.usedBy = userId;
    saveUsers();
    return true;
}

// Migration: Create initial admin user from env vars if no users exist
async function migrateInitialAdmin() {
    if (users.length === 0) {
        const adminUsername = config.adminUsername;
        const adminPasswordHash = config.adminPasswordHash;

        if (adminPasswordHash) {
            users.push({
                id: nextUserId++,
                username: adminUsername,
                passwordHash: adminPasswordHash,
                role: 'admin',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isActive: true
            });
            saveUsers();
            console.log(`Migrated admin user: ${adminUsername}`);
        }
    }
}

// Migration: Add userId to existing entries (assign to first admin)
function migrateExistingEntries() {
    const adminUser = users.find(u => u.role === 'admin');
    if (adminUser) {
        let migrated = false;
        entries.forEach(entry => {
            if (!entry.userId) {
                entry.userId = adminUser.id;
                migrated = true;
            }
        });
        if (migrated) {
            saveEntries();
            console.log('Migrated existing entries to admin user');
        }
    }
}

// Migration: Add partnerId field to existing users
function migrateUsersForCouples() {
    let migrated = false;
    users.forEach(user => {
        if (user.partnerId === undefined) {
            user.partnerId = null;
            user.partnerLinkedAt = null;
            migrated = true;
        }
    });
    if (migrated) {
        saveUsers();
        console.log('Migrated users for couples feature');
    }
}

// Migration: Add isCoupleExpense field to existing entries
function migrateEntriesForCouples() {
    let migrated = false;
    entries.forEach(entry => {
        if (entry.isCoupleExpense === undefined) {
            entry.isCoupleExpense = false;
            migrated = true;
        }
    });
    if (migrated) {
        saveEntries();
        console.log('Migrated entries for couples feature');
    }
}

// ============ COUPLE MANAGEMENT HELPERS ============

// Link two users as a couple
function linkCouple(userId1, userId2) {
    const user1 = findUserById(userId1);
    const user2 = findUserById(userId2);

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

    user1.partnerId = userId2;
    user1.partnerLinkedAt = now;
    user1.updatedAt = now;

    user2.partnerId = userId1;
    user2.partnerLinkedAt = now;
    user2.updatedAt = now;

    saveUsers();

    return { user1, user2, linkedAt: now };
}

// Unlink a couple (idempotent - safe to call even if user has no partner)
function unlinkCouple(userId) {
    const user = findUserById(userId);
    const now = new Date().toISOString();
    const affectedUsers = [];

    // Make unlinkCouple idempotent so it can be safely called from
    // user deletion/deactivation flows even if the user is already
    // unlinked or missing.
    if (!user || !user.partnerId) {
        return affectedUsers;
    }

    const partner = findUserById(user.partnerId);

    affectedUsers.push(user.id);

    user.partnerId = null;
    user.partnerLinkedAt = null;
    user.updatedAt = now;

    if (partner) {
        partner.partnerId = null;
        partner.partnerLinkedAt = null;
        partner.updatedAt = now;
        affectedUsers.push(partner.id);
    }

    saveUsers();

    return affectedUsers;
}

// Load data on startup
loadUsers();
loadEntries();

// Run migrations
migrateInitialAdmin();
migrateExistingEntries();
migrateUsersForCouples();
migrateEntriesForCouples();

// Migration: Add email field to existing users
function migrateUsersForEmail() {
    let migrated = false;
    users.forEach(user => {
        if (user.email === undefined) {
            user.email = null;
            migrated = true;
        }
    });
    if (migrated) {
        saveUsers();
        console.log('Migrated users for email field');
    }
}
migrateUsersForEmail();

// Migration: Add TOTP 2FA fields to existing users
function migrateUsersForTOTP() {
    let migrated = false;
    users.forEach(user => {
        let userUpdated = false;
        if (user.totpSecret === undefined) {
            user.totpSecret = null;
            userUpdated = true;
        }
        if (user.totpEnabled === undefined) {
            user.totpEnabled = false;
            userUpdated = true;
        }
        if (user.backupCodes === undefined) {
            user.backupCodes = [];
            userUpdated = true;
        }
        if (userUpdated) {
            migrated = true;
        }
    });
    if (migrated) {
        saveUsers();
        console.log('Migrated users for TOTP 2FA');
    }
}
migrateUsersForTOTP();

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
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cloud.umami.is", "https://*.paypal.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", "https://cloud.umami.is", "https://api-gateway.umami.dev", "https://cdn.jsdelivr.net", "https://*.paypal.com"],
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
        '/data', '/ssl', '/certs', '/node_modules', '/ios', '/www'
    ];
    if (blocked.some(p => requestPath === p || requestPath.startsWith(p + '/'))) {
        return res.status(404).end();
    }
    next();
});

// Serve HTML pages with Umami analytics injection (if configured)
const UMAMI_WEBSITE_ID = config.umamiWebsiteId;
const htmlPages = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/login.html': 'login.html',
    '/register.html': 'register.html',
    '/forgot-password.html': 'forgot-password.html'
};

if (UMAMI_WEBSITE_ID) {
    Object.entries(htmlPages).forEach(([route, file]) => {
        app.get(route, (req, res) => {
            const filePath = path.join(__dirname, file);
            let html = fs.readFileSync(filePath, 'utf8');
            const script = `<script defer src="https://cloud.umami.is/script.js" data-website-id="${UMAMI_WEBSITE_ID}"></script>`;
            html = html.replace('</head>', `    ${script}\n</head>`);
            res.type('html').send(html);
        });
    });
}

app.use(express.static(__dirname));

// Trust Nginx proxy
app.set('trust proxy', 1);

// Session configuration
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
    skip: (req) => req.session && req.session.user
});

app.use('/api/', generalLimiter);

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.id) {
        const user = findUserById(req.session.user.id);
        if (user && user.isActive) {
            req.user = user;
            return next();
        }
        req.session.destroy();
        return res.status(401).json({ message: 'Session invalid. Please log in again.' });
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
app.post('/api/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    // Check brute-force lockout before any password check
    const lockStatus = getLoginLockStatus(username);
    if (lockStatus.locked) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = findUserByUsername(username);

    if (user && user.isActive && await bcrypt.compare(password, user.passwordHash)) {
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
});

// Registration endpoint
app.post('/api/register', registerLimiter, async (req, res) => {
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
    const invite = findInviteCode(inviteCode);
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
    if (findUserByUsername(username)) {
        return res.status(409).json({ message: 'Username already taken' });
    }

    try {
        // Consume invite code atomically before async bcrypt to prevent race conditions
        const inviteConsumed = consumeInviteCode(inviteCode, null);
        if (!inviteConsumed) {
            return res.status(409).json({ message: 'Invalid or already used invite code' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
            id: nextUserId++,
            username: username,
            email: encryptString(email),
            passwordHash: passwordHash,
            role: 'user',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true,
            totpSecret: null,
            totpEnabled: false,
            backupCodes: []
        };

        users.push(newUser);

        // Update the invite code with the actual user ID
        const usedInvite = findInviteCode(inviteCode);
        if (usedInvite) usedInvite.usedBy = newUser.id;
        saveUsers();

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
        const burnedInvite = findInviteCode(inviteCode);
        if (burnedInvite && burnedInvite.isUsed && burnedInvite.usedBy === null) {
            burnedInvite.isUsed = false;
            burnedInvite.usedAt = null;
            saveUsers();
        }
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed' });
    }
});

// Forgot password endpoint
app.post('/api/forgot-password', forgotPasswordLimiter, async (req, res) => {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        return res.json({ message: 'If an account with that username exists and has an email on file, a reset code has been sent.' });
    }

    // Always return the same generic message to prevent user enumeration
    const genericMessage = 'If an account with that username exists and has an email on file, a reset code has been sent.';

    // Respond immediately, then do all user-dependent work in background
    // to prevent timing-based user enumeration
    res.json({ message: genericMessage });

    setImmediate(() => {
        try {
            const user = findUserByUsername(username);
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
});

// Reset password endpoint
app.post('/api/reset-password', loginLimiter, async (req, res) => {
    const { username, code, newPassword } = req.body;

    if (!username || !code || !newPassword
        || typeof username !== 'string' || typeof code !== 'string' || typeof newPassword !== 'string') {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Validate username and active status before consuming the code
    // to prevent an attacker from burning valid codes via wrong usernames
    const user = findUserByUsername(username);
    if (!user) {
        return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    if (!user.isActive) {
        return res.status(403).json({ message: 'User account is inactive' });
    }

    // Per-username attempt tracking to prevent reset code brute-force
    if (!checkAndRecordResetAttempt(username)) {
        return res.status(429).json({ message: 'Too many failed reset attempts. Please request a new code.' });
    }

    const userId = consumeResetCode(code);
    if (!userId || user.id !== userId) {
        return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    try {
        user.passwordHash = await bcrypt.hash(newPassword, 10);
        user.updatedAt = new Date().toISOString();
        saveUsers();

        // Clear brute-force lockouts since user proved identity via email
        resetFailedLogins(username);
        clearResetAttempts(username);

        res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Failed to reset password' });
    }
});

// Get current user info
app.get('/api/user', requireAuth, (req, res) => {
    const response = {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        partnerId: null,
        partnerLinkedAt: null,
        partnerUsername: null,
        hasGeminiApiKey: !!(req.user.geminiApiKey && req.user.geminiApiKey.iv && req.user.geminiApiKey.encryptedData),
        hasOpenaiApiKey: !!(req.user.openaiApiKey && req.user.openaiApiKey.iv && req.user.openaiApiKey.encryptedData),
        hasGeminiKeyAvailable: !!(req.user.geminiApiKey && req.user.geminiApiKey.iv && req.user.geminiApiKey.encryptedData) || !!config.geminiApiKey,
        hasOpenaiKeyAvailable: !!(req.user.openaiApiKey && req.user.openaiApiKey.iv && req.user.openaiApiKey.encryptedData) || !!config.openaiApiKey,
        aiProvider: req.user.aiProvider || 'gemini',
        aiModel: req.user.aiModel || null,
        has2FA: !!req.user.totpEnabled
    };

    // Include partner info only if partner exists and is mutually linked
    if (req.user.partnerId) {
        const partner = findUserById(req.user.partnerId);
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            response.partnerId = req.user.partnerId;
            response.partnerLinkedAt = req.user.partnerLinkedAt;
            response.partnerUsername = partner.username;
        }
    }

    res.json(response);
});

// Save Gemini API key (encrypted)
app.post('/api/user/gemini-key', requireAuth, (req, res) => {
    const { geminiApiKey } = req.body;

    if (!geminiApiKey || typeof geminiApiKey !== 'string') {
        return res.status(400).json({ message: 'API key is required.' });
    }

    const trimmed = geminiApiKey.trim();
    if (trimmed.length < 30 || trimmed.length > 60) {
        return res.status(400).json({ message: 'API key must be between 30 and 60 characters.' });
    }

    req.user.geminiApiKey = encryptString(trimmed);
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ message: 'Gemini API key saved successfully.', hasGeminiApiKey: true, hasGeminiKeyAvailable: true });
});

// Remove saved Gemini API key
app.delete('/api/user/gemini-key', requireAuth, (req, res) => {
    delete req.user.geminiApiKey;
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ message: 'Gemini API key removed.', hasGeminiApiKey: false, hasGeminiKeyAvailable: !!config.geminiApiKey });
});

// Save OpenAI API key (encrypted)
app.post('/api/user/openai-key', requireAuth, (req, res) => {
    const { openaiApiKey } = req.body;

    if (!openaiApiKey || typeof openaiApiKey !== 'string') {
        return res.status(400).json({ message: 'API key is required.' });
    }

    const trimmed = openaiApiKey.trim();
    if (trimmed.length < 30 || trimmed.length > 200) {
        return res.status(400).json({ message: 'API key must be between 30 and 200 characters.' });
    }

    req.user.openaiApiKey = encryptString(trimmed);
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ message: 'OpenAI API key saved successfully.', hasOpenaiApiKey: true, hasOpenaiKeyAvailable: true });
});

// Remove saved OpenAI API key
app.delete('/api/user/openai-key', requireAuth, (req, res) => {
    delete req.user.openaiApiKey;
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ message: 'OpenAI API key removed.', hasOpenaiApiKey: false, hasOpenaiKeyAvailable: !!config.openaiApiKey });
});

// Save AI provider preference
app.put('/api/user/ai-provider', requireAuth, (req, res) => {
    const { aiProvider } = req.body;

    if (!aiProvider || !['gemini', 'openai'].includes(aiProvider)) {
        return res.status(400).json({ message: 'aiProvider must be "gemini" or "openai".' });
    }

    req.user.aiProvider = aiProvider;
    req.user.aiModel = null;
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ message: 'AI provider saved.', aiProvider, aiModel: null });
});

// List available AI models for the user's current provider
app.get('/api/ai/models', requireAuth, async (req, res) => {
    const provider = req.user.aiProvider || 'gemini';

    // Resolve API key: stored user key → server .env key
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
        return res.json({ provider, models: cached.models, selectedModel: req.user.aiModel || null });
    }

    try {
        let models = [];

        if (provider === 'openai') {
            const openaiClient = new OpenAI({ apiKey });
            const list = await openaiClient.models.list();
            const includePattern = /^(gpt-|o[0-9]|chatgpt-)/;
            const excludePattern = /instruct|realtime|audio|search|embedding/i;
            for await (const model of list) {
                if (includePattern.test(model.id) && !excludePattern.test(model.id)) {
                    models.push({ id: model.id, name: model.id });
                }
            }
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
        res.json({ provider, models, selectedModel: req.user.aiModel || null });
    } catch (err) {
        console.error('Failed to list AI models:', err.message);
        res.status(500).json({ message: 'Failed to fetch model list.' });
    }
});

// Save AI model preference
app.put('/api/user/ai-model', requireAuth, (req, res) => {
    const { aiModel } = req.body;

    if (aiModel !== null && aiModel !== undefined && aiModel !== '') {
        if (typeof aiModel !== 'string' || aiModel.length > 100) {
            return res.status(400).json({ message: 'aiModel must be a string (max 100 chars) or empty to clear.' });
        }
        req.user.aiModel = aiModel;
    } else {
        req.user.aiModel = null;
    }

    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ aiModel: req.user.aiModel || null });
});

// ============ 2FA VERIFICATION (LOGIN STEP 2) ============

app.post('/api/login/verify-2fa', totpLimiter, async (req, res) => {
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

    const user = findUserById(session2FA.userId);
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
                    user.backupCodes.splice(i, 1);
                    saveUsers();
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
});

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
app.put('/api/user/email', requireAuth, (req, res) => {
    const { email } = req.body;

    if (email === undefined) {
        return res.status(400).json({ message: 'Email field is required' });
    }

    if (email === '' || email === null) {
        req.user.email = null;
        req.user.updatedAt = new Date().toISOString();
        saveUsers();
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

    req.user.email = encryptString(email);
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    const parts = email.split('@');
    if (parts.length !== 2 || !parts[0].length || !parts[1].length) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    const maskedEmail = parts[0].charAt(0) + '***@' + parts[1];
    res.json({ message: 'Email updated', hasEmail: true, maskedEmail });
});

// ============ TOTP 2FA ENDPOINTS ============

// Get 2FA status
app.get('/api/user/2fa/status', requireAuth, (req, res) => {
    res.json({
        enabled: !!req.user.totpEnabled,
        backupCodesRemaining: (req.user.backupCodes || []).length
    });
});

// Start 2FA setup - generate secret and QR code
app.post('/api/user/2fa/setup', requireAuth, async (req, res) => {
    if (req.user.totpEnabled) {
        return res.status(400).json({ message: 'Two-factor authentication is already enabled. Disable it first before setting up again.' });
    }

    const secret = otplib.generateSecret();
    const otpauth = otplib.generateURI({ label: req.user.username, issuer: 'AssetManager', secret });

    try {
        const qrCode = await QRCode.toDataURL(otpauth);

        // Store encrypted secret but don't enable yet
        req.user.totpSecret = encryptString(secret);
        req.user.updatedAt = new Date().toISOString();
        saveUsers();

        res.json({ secret, qrCode });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ message: 'Failed to setup 2FA' });
    }
});

// Verify 2FA setup - enable 2FA and generate backup codes
app.post('/api/user/2fa/verify', requireAuth, async (req, res) => {
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

    req.user.totpEnabled = true;
    req.user.backupCodes = hashedCodes;
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ message: '2FA enabled successfully', backupCodes });
});

// Disable 2FA
app.post('/api/user/2fa/disable', requireAuth, (req, res) => {
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

    req.user.totpSecret = null;
    req.user.totpEnabled = false;
    req.user.backupCodes = [];
    req.user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({ message: '2FA disabled successfully' });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
});

// Get all entries for current user
app.get('/api/entries', requireAuth, (req, res) => {
    const viewMode = req.query.viewMode || 'individual';
    let userEntries;

    // Validate partner relationship (used for both combined and individual views)
    let validPartner = null;
    if (req.user.partnerId) {
        const partner = findUserById(req.user.partnerId);
        // Only treat as valid partner if partner exists, is active, and mutually linked
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            validPartner = partner;
        }
    }

    if (viewMode === 'combined' && validPartner) {
        // Combined view: Get couple-flagged entries from both user and partner
        userEntries = entries.filter(entry =>
            entry.isCoupleExpense === true &&
            (entry.userId === req.user.id || entry.userId === validPartner.id)
        );
    } else if (viewMode === 'individual' && validPartner) {
        // Individual view with valid partner: Only non-couple expenses from current user
        userEntries = entries.filter(entry =>
            entry.userId === req.user.id &&
            entry.isCoupleExpense !== true
        );
    } else {
        // No valid partner relationship: return all entries for current user
        userEntries = entries.filter(entry =>
            entry.userId === req.user.id
        );
    }

    res.json(userEntries);
});

// Entry field validation constants
const VALID_ENTRY_TYPES = ['income', 'expense'];
const VALID_TAGS = ['food', 'groceries', 'transport', 'travel', 'entertainment', 'utilities', 'healthcare', 'education', 'shopping', 'subscription', 'housing', 'salary', 'freelance', 'investment', 'transfer', 'wedding', 'other'];
const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

// Add new entry
app.post('/api/entries', requireAuth, (req, res) => {
    const { month, type, amount, description, tags, isCoupleExpense } = req.body;

    if (!month || !type || !amount || !description
        || typeof month !== 'string' || typeof type !== 'string'
        || typeof description !== 'string') {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (!MONTH_FORMAT.test(month)) {
        return res.status(400).json({ message: 'Month must be in YYYY-MM format' });
    }

    if (!VALID_ENTRY_TYPES.includes(type)) {
        return res.status(400).json({ message: 'Type must be income or expense' });
    }

    const sanitizedTags = Array.isArray(tags)
        ? tags.map(t => String(t).toLowerCase().trim()).filter(t => VALID_TAGS.includes(t))
        : [];

    // Validate partner relationship before allowing couple expense
    let validCoupleExpense = false;
    if (isCoupleExpense && req.user.partnerId) {
        const partner = findUserById(req.user.partnerId);
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            validCoupleExpense = true;
        }
    }

    const newEntry = {
        id: nextId++,
        userId: req.user.id,  // Associate with current user
        month,
        type,
        amount: parseFloat(amount),
        description: description.trim(),
        tags: sanitizedTags,
        isCoupleExpense: validCoupleExpense
    };

    entries.push(newEntry);
    saveEntries();
    res.status(201).json(newEntry);
});

// Update entry - ensure user owns the entry
app.put('/api/entries/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const index = entries.findIndex(entry => entry.id === id && entry.userId === req.user.id);

    if (index === -1) {
        return res.status(404).json({ message: 'Entry not found' });
    }

    const { month, type, amount, description, tags, isCoupleExpense } = req.body;

    if (!month || !type || !amount || !description
        || typeof month !== 'string' || typeof type !== 'string'
        || typeof description !== 'string') {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (!MONTH_FORMAT.test(month)) {
        return res.status(400).json({ message: 'Month must be in YYYY-MM format' });
    }

    if (!VALID_ENTRY_TYPES.includes(type)) {
        return res.status(400).json({ message: 'Type must be income or expense' });
    }

    const sanitizedTags = Array.isArray(tags)
        ? tags.map(t => String(t).toLowerCase().trim()).filter(t => VALID_TAGS.includes(t))
        : [];

    // Validate partner relationship before allowing couple expense
    let validCoupleExpense = false;
    if (isCoupleExpense && req.user.partnerId) {
        const partner = findUserById(req.user.partnerId);
        if (partner && partner.isActive && partner.partnerId === req.user.id) {
            validCoupleExpense = true;
        }
    }

    entries[index] = {
        ...entries[index],
        month,
        type,
        amount: parseFloat(amount),
        description: description.trim(),
        tags: sanitizedTags,
        isCoupleExpense: validCoupleExpense
    };

    saveEntries();
    res.json(entries[index]);
});

// Delete entry - ensure user owns the entry
app.delete('/api/entries/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const index = entries.findIndex(entry => entry.id === id && entry.userId === req.user.id);

    if (index === -1) {
        return res.status(404).json({ message: 'Entry not found' });
    }

    entries.splice(index, 1);
    saveEntries();
    res.json({ message: 'Entry deleted successfully' });
});

// ============ ADMIN ENDPOINTS ============

// Get all users (admin only)
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
    // Precompute entries count by userId for O(1) lookup
    const entriesCountByUserId = {};
    entries.forEach(e => {
        entriesCountByUserId[e.userId] = (entriesCountByUserId[e.userId] || 0) + 1;
    });

    // Precompute users by ID for O(1) partner lookup
    const usersById = {};
    users.forEach(u => {
        usersById[u.id] = u;
    });

    const sanitizedUsers = users.map(u => {
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

        // Include partner username if linked
        if (u.partnerId) {
            const partner = usersById[u.partnerId];
            if (partner) {
                userData.partnerUsername = partner.username;
            }
        }

        return userData;
    });
    res.json(sanitizedUsers);
});

// Create user (admin only)
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    if (findUserByUsername(username)) {
        return res.status(409).json({ message: 'Username already exists' });
    }

    const validRoles = ['user', 'admin'];
    const userRole = validRoles.includes(role) ? role : 'user';

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
            id: nextUserId++,
            username,
            passwordHash,
            role: userRole,
            email: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true,
            totpSecret: null,
            totpEnabled: false,
            backupCodes: []
        };

        users.push(newUser);
        saveUsers();

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
});

// Update user (admin only)
app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found' });
    }

    const { username, role, isActive } = req.body;
    const user = users[userIndex];

    // Prevent admin from demoting themselves
    if (userId === req.user.id && role && role !== 'admin') {
        return res.status(400).json({ message: 'Cannot demote yourself' });
    }

    // Prevent deactivating last admin
    if (isActive === false && user.role === 'admin') {
        const activeAdmins = users.filter(u => u.role === 'admin' && u.isActive);
        if (activeAdmins.length === 1) {
            return res.status(400).json({ message: 'Cannot deactivate the last admin' });
        }
    }

    // Update fields
    if (username && username !== user.username) {
        if (findUserByUsername(username)) {
            return res.status(409).json({ message: 'Username already taken' });
        }
        user.username = username;
    }

    if (role && ['user', 'admin'].includes(role)) {
        user.role = role;
    }

    if (typeof isActive === 'boolean') {
        user.isActive = isActive;
    }

    user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        isActive: user.isActive
    });
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found' });
    }

    // Prevent self-deletion
    if (userId === req.user.id) {
        return res.status(400).json({ message: 'Cannot delete yourself' });
    }

    // Prevent deleting last admin
    const user = users[userIndex];
    if (user.role === 'admin') {
        const adminCount = users.filter(u => u.role === 'admin').length;
        if (adminCount === 1) {
            return res.status(400).json({ message: 'Cannot delete the last admin' });
        }
    }

    // Unlink partner if user has one (cleans up partner's state)
    unlinkCouple(userId);

    // Delete user's entries
    entries = entries.filter(e => e.userId !== userId);
    saveEntries();

    // Delete user
    users.splice(userIndex, 1);
    saveUsers();

    res.json({ message: 'User deleted successfully' });
});

// ============ COUPLE MANAGEMENT ENDPOINTS ============

// Get all couples (admin only)
app.get('/api/admin/couples', requireAuth, requireAdmin, (req, res) => {
    const couples = [];
    const processedIds = new Set();

    users.forEach(user => {
        if (user.partnerId && !processedIds.has(user.id)) {
            const partner = findUserById(user.partnerId);
            // Only include mutual partner relationships to avoid inconsistent or one-sided links
            if (partner && partner.partnerId === user.id) {
                couples.push({
                    user1: { id: user.id, username: user.username },
                    user2: { id: partner.id, username: partner.username },
                    linkedAt: user.partnerLinkedAt
                });
                processedIds.add(user.id);
                processedIds.add(partner.id);
            }
        }
    });

    res.json({ couples });
});

// Link two users as a couple (admin only)
app.post('/api/admin/couples/link', requireAuth, requireAdmin, (req, res) => {
    const { userId1, userId2 } = req.body;

    if (!userId1 || !userId2) {
        return res.status(400).json({ message: 'Both user IDs are required' });
    }

    try {
        const result = linkCouple(parseInt(userId1), parseInt(userId2));
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
});

// Unlink a couple (admin only)
app.post('/api/admin/couples/unlink', requireAuth, requireAdmin, (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
    }

    try {
        const affectedUsers = unlinkCouple(parseInt(userId));
        res.json({
            message: 'Couple unlinked successfully',
            affectedUsers
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// ============ INVITE CODE ENDPOINTS ============

// ============ PAYPAL PAYMENT ENDPOINTS ============

// Cleanup abandoned/failed PayPal orders every 30 minutes (keep COMPLETED for audit)
setInterval(() => {
    const now = Date.now();
    const expiry = 24 * 60 * 60 * 1000; // 24 hours
    const before = paypalOrders.length;
    paypalOrders = paypalOrders.filter(order => {
        if (order.status === 'COMPLETED') return true;
        return (now - new Date(order.createdAt).getTime()) < expiry;
    });
    if (paypalOrders.length !== before) saveUsers();
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
app.post('/api/paypal/create-order', paypalOrderLimiter, async (req, res) => {
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

        const order = {
            orderId: result.id,
            amount,
            currency: 'BRL',
            status: result.status,
            inviteCode: null,
            createdAt: new Date().toISOString(),
            confirmedAt: null
        };

        paypalOrders.push(order);
        saveUsers();

        res.status(201).json({ orderId: result.id });
    } catch (error) {
        console.error('Error creating PayPal order:', error.message || error);
        res.status(500).json({ message: 'Failed to create PayPal order' });
    }
});

// POST /api/paypal/capture-order/:orderId — public, rate-limited, captures a PayPal order after approval
app.post('/api/paypal/capture-order/:orderId', paypalOrderLimiter, async (req, res) => {
    if (!ordersController) {
        return res.status(503).json({ message: 'PayPal payments are not configured' });
    }

    const { orderId } = req.params;

    // Validate orderId format (PayPal order IDs are alphanumeric, may include hyphens)
    if (!/^[A-Z0-9\-]{10,25}$/.test(orderId)) {
        return res.status(400).json({ message: 'Invalid order ID format' });
    }

    const order = paypalOrders.find(o => o.orderId === orderId);
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
            if (order.inviteCode) {
                return res.json({ inviteCode: order.inviteCode });
            }

            const newCode = createInviteCode('paypal');
            order.status = 'COMPLETED';
            order.inviteCode = newCode.code;
            order.confirmedAt = new Date().toISOString();
            saveUsers();

            return res.json({ inviteCode: newCode.code });
        }

        // Update stored status
        order.status = result.status;
        saveUsers();

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
});

// Generate a new invite code (admin only)
app.post('/api/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
    try {
        const inviteCode = createInviteCode(req.user.id);
        res.status(201).json({ code: inviteCode.code, createdAt: inviteCode.createdAt });
    } catch (error) {
        console.error('Error generating invite code:', error);
        res.status(500).json({ message: 'Failed to generate invite code' });
    }
});

// List all invite codes (admin only)
app.get('/api/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
    const codesWithDetails = inviteCodes.map(ic => {
        const creator = (ic.createdBy === 'paypal' || ic.createdBy === 'pix') ? null : findUserById(ic.createdBy);
        const consumer = ic.usedBy ? findUserById(ic.usedBy) : null;
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
});

// Delete an unused invite code (admin only)
app.delete('/api/admin/invite-codes/:code', requireAuth, requireAdmin, (req, res) => {
    const code = req.params.code.toUpperCase();
    const index = inviteCodes.findIndex(ic => ic.code === code);

    if (index === -1) {
        return res.status(404).json({ message: 'Invite code not found' });
    }
    if (inviteCodes[index].isUsed) {
        return res.status(400).json({ message: 'Cannot delete a used invite code' });
    }

    inviteCodes.splice(index, 1);
    saveUsers();
    res.json({ message: 'Invite code deleted' });
});

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

function toolGetFinancialSummary(userId, args) {
    let userEntries = entries.filter(e => e.userId === userId);
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

function toolGetCategoryBreakdown(userId, args) {
    const type = args.type || 'expense';
    let userEntries = entries.filter(e => e.userId === userId && e.type === type);
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

function toolGetMonthlyTrends(userId, args) {
    let userEntries = entries.filter(e => e.userId === userId);
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

function toolGetTopExpenses(userId, args) {
    let userEntries = entries.filter(e => e.userId === userId && e.type === 'expense');
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
            // id is intentionally included so the editEntry tool can reference entries by ID
            id: e.id,
            description: e.description,
            amount: e.amount.toFixed(2),
            month: e.month,
            category: (e.tags && e.tags[0]) || 'uncategorized'
        })),
        count: sorted.length
    };
}

function toolComparePeriods(userId, args) {
    const get = (start, end) => {
        let ue = entries.filter(e => e.userId === userId);
        ue = filterByDateRange(ue, start, end);
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

function toolSearchEntries(userId, args) {
    let userEntries = entries.filter(e => e.userId === userId);
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
            // id is intentionally included so the editEntry tool can reference entries by ID
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
 * @returns {object} { entry, updates, entryIndex, rejectedTags } on success, or { error } on failure.
 */
function validateEditArgs(userId, args) {
    const entryId = args.entryId != null ? Number(args.entryId) : NaN;
    if (!Number.isInteger(entryId)) {
        return { error: 'entryId is required and must be a valid integer.' };
    }

    const index = entries.findIndex(e => e.id === entryId && e.userId === userId);
    if (index === -1) {
        return { error: 'Entry not found or does not belong to the current user. Use searchEntries to find valid entry IDs.' };
    }

    const entry = entries[index];
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

    return { entry, updates, entryIndex: index, rejectedTags };
}

/**
 * Edit an existing financial entry. Requires confirmed: true (passed by the confirm endpoint).
 * @param {number} userId - The authenticated user's ID (from session).
 * @param {object} args - Tool arguments from the AI model.
 * @returns {object} Updated entry on success, or `{ error }` on failure.
 */
function toolEditEntry(userId, args) {
    // Require explicit confirmation flag
    if (args.confirmed !== true) {
        return { error: 'Edit must be confirmed by the user. Set confirmed: true after user approval.' };
    }

    const validation = validateEditArgs(userId, args);
    if (validation.error) return validation;

    const { entry, updates, entryIndex: index, rejectedTags } = validation;
    const entryId = entry.id;

    // Save pre-edit snapshot so the user can undo this edit.
    const snapshotKey = `${userId}:${entryId}`;
    // Delete existing key first so re-inserting moves it to most-recent position.
    if (lastEditSnapshots.has(snapshotKey)) {
        lastEditSnapshots.delete(snapshotKey);
    } else if (lastEditSnapshots.size >= SNAPSHOT_MAX_SIZE) {
        const oldestKey = lastEditSnapshots.keys().next().value;
        if (oldestKey !== undefined) {
            lastEditSnapshots.delete(oldestKey);
        }
    }

    // Build updated entry and store snapshot before persisting,
    // so undo remains available even if saveEntries() fails.
    const updated = { ...entry, ...updates };
    lastEditSnapshots.set(snapshotKey, { before: { ...entry }, after: { ...updated } });

    // Apply updates — spread preserves userId, id, and isCoupleExpense from original entry.
    // Only the explicitly validated fields above can appear in `updates`.
    entries[index] = updated;
    saveEntries();
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
function toolUndoLastEdit(userId, args) {
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
    const index = entries.findIndex(e => e.id === entryId && e.userId === userId);
    if (index === -1) {
        lastEditSnapshots.delete(snapshotKey);
        return { error: 'Entry not found or does not belong to the current user.' };
    }

    // Verify the entry hasn't been modified since the AI edit (e.g. via the UI).
    const current = entries[index];
    const expected = snapshotData.after;
    if (current.description !== expected.description || current.amount !== expected.amount
        || current.type !== expected.type || current.month !== expected.month
        || JSON.stringify(current.tags) !== JSON.stringify(expected.tags)
        || current.isCoupleExpense !== expected.isCoupleExpense) {
        lastEditSnapshots.delete(snapshotKey);
        return { error: 'This entry has been modified since the AI edit (possibly via the UI). Undo is no longer available to avoid overwriting those changes.' };
    }

    // Restore the pre-edit snapshot
    entries[index] = { ...snapshotData.before };
    lastEditSnapshots.delete(snapshotKey);
    saveEntries();

    const restored = entries[index];
    return {
        success: true,
        message: 'Edit undone. Entry restored to its previous state.',
        entry: {
            id: restored.id,
            description: restored.description,
            amount: restored.amount.toFixed(2),
            type: restored.type,
            month: restored.month,
            tags: restored.tags || [],
            isCoupleExpense: restored.isCoupleExpense || false
        }
    };
}

function executeTool(name, userId, args) {
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

app.post('/api/ai/chat', requireAuth, chatRateLimiter, async (req, res) => {
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
    const provider = req.user.aiProvider || 'gemini';

    // Resolve API key: stored user key → server .env key
    let apiKey = null;
    if (provider === 'openai') {
        if (req.user.openaiApiKey) {
            try {
                apiKey = decryptString(req.user.openaiApiKey.encryptedData, req.user.openaiApiKey.iv);
            } catch (e) {
                console.error('Failed to decrypt stored OpenAI API key for chat:', e.message);
            }
        }
        if (!apiKey) apiKey = config.openaiApiKey;
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
    if (!apiKey) {
        return res.status(400).json({ error: 'no_api_key' });
    }

    // Shared helper: handle editEntry tool call interception.
    // Validates the proposed edit, stores it as a pending edit for UI confirmation,
    // and returns a result message for the AI to relay to the user.
    // @param {object} toolArgs - Raw arguments from the AI tool call.
    // @param {Array}  pendingEditsList - Accumulator for pending edits to include in the response.
    // @returns {object} - Result to return to the AI as the tool response.
    function handleEditEntryCall(toolArgs, pendingEditsList) {
        const validation = validateEditArgs(req.user.id, toolArgs);
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
                        console.error(`Failed to parse OpenAI tool args for ${toolCall.function.name}:`, parseErr.message, 'Raw:', toolCall.function.arguments);
                    }
                    let result;
                    if (toolName === 'editEntry') {
                        result = handleEditEntryCall(toolArgs, pendingEditsList);
                    } else {
                        result = executeTool(toolName, req.user.id, toolArgs);
                    }
                    toolResultMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    });
                }
                currentMessages = [...currentMessages, ...toolResultMessages];
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
                        result = handleEditEntryCall(toolArgs, pendingEditsList);
                    } else {
                        result = executeTool(toolName, req.user.id, toolArgs);
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
        console.error('AI Chat error:', error.message);
        if (error.message?.includes('API key') || error.status === 401) {
            return res.status(400).json({ error: 'Invalid API key.' });
        }
        if (error.message?.includes('quota') || error.status === 429) {
            return res.status(429).json({ error: 'API quota exceeded. Please try again later.' });
        }
        res.status(500).json({ error: 'generic' });
    }
});

// Confirm a pending AI edit via UI button
const editActionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
    keyGenerator: (req, res) => req.session?.user?.id?.toString() || rateLimit.ipKeyGenerator(req, res)
});

app.post('/api/ai/confirm-edit', requireAuth, editActionLimiter, (req, res) => {
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
    const result = toolEditEntry(userId, { entryId: pending.entryId, confirmed: true, ...pending.changes });

    // Remove this specific pending edit
    allPending.splice(idx, 1);
    if (allPending.length === 0) pendingEdits.delete(userId);

    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    res.json(result);
});

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

// PDF processing endpoint with AI (Gemini or OpenAI, based on user preference)
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
    const provider = req.user.aiProvider || 'gemini';

    // Resolve API key: stored user key → server .env key
    let apiKey = null;
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

        // Parse the structured JSON response
        let entries = [];
        try {
            const parsed = JSON.parse(aiResponse);

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
            console.error('Error parsing AI response:', parseError);
            console.error('AI Response was:', aiResponse);
            return res.status(500).json({
                message: 'Failed to parse AI response. Please check the PDF format.',
                debug: aiResponse ? aiResponse.substring(0, 200) : 'No response'
            });
        }

        console.log('=== FINAL ENTRIES ===');
        console.log(entries);

        res.json(entries);
    } catch (error) {
        console.error('Error processing PDF with AI:', error);

        // Provide more specific error messages with appropriate status codes
        let errorMessage = 'Failed to process PDF with AI. Please check your API key and try again.';
        let statusCode = 500;
        if (error.message?.includes('API key') || error.status === 401) {
            errorMessage = `Invalid ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key. Please check your API key and try again.`;
            statusCode = 400;
        } else if (error.message?.includes('quota') || error.status === 429) {
            errorMessage = `${provider === 'openai' ? 'OpenAI' : 'Gemini'} API quota exceeded. Please try again later.`;
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
});