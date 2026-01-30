// Polyfill fetch for Node.js < 18
if (!globalThis.fetch) {
    globalThis.fetch = require('node-fetch');
}

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer'); // For handling file uploads
const pdfParse = require('pdf-parse'); // For parsing PDF files
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();

// Initialize Gemini AI
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = 'gemini-3-flash-preview';

// Data file path
const DATA_FILE = path.join(__dirname, 'data', 'entries.json');

// Encryption key (in production, use a secure key management system)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  : crypto.randomBytes(32);
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
            }
        }
    } catch (error) {
        console.error('Error loading users:', error);
        users = [];
    }
}

// Save users to file
function saveUsers() {
    try {
        const dataDir = path.dirname(USERS_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const encrypted = encryptData({ users, nextUserId });
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

// Migration: Create initial admin user from env vars if no users exist
async function migrateInitialAdmin() {
    if (users.length === 0) {
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

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

// Unlink a couple
function unlinkCouple(userId) {
    const user = findUserById(userId);
    if (!user || !user.partnerId) {
        throw new Error('User has no partner');
    }

    const partner = findUserById(user.partnerId);
    const now = new Date().toISOString();

    const affectedUsers = [user.id];

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

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Disable CSP for development
}));
app.use(express.json());
app.use(express.static(__dirname)); // Serve files from the current directory

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = findUserByUsername(username);

    if (user && user.isActive && await bcrypt.compare(password, user.passwordHash)) {
        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };
        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

// Registration endpoint
app.post('/api/register', async (req, res) => {
    const { username, password, confirmPassword } = req.body;

    // Validation
    if (!username || !password || !confirmPassword) {
        return res.status(400).json({ message: 'All fields are required' });
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
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
            id: nextUserId++,
            username: username,
            passwordHash: passwordHash,
            role: 'user',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true
        };

        users.push(newUser);
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
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed' });
    }
});

// Get current user info
app.get('/api/user', requireAuth, (req, res) => {
    const response = {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        partnerId: req.user.partnerId || null,
        partnerLinkedAt: req.user.partnerLinkedAt || null
    };

    // Include partner username if linked
    if (req.user.partnerId) {
        const partner = findUserById(req.user.partnerId);
        if (partner) {
            response.partnerUsername = partner.username;
        }
    }

    res.json(response);
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

    if (viewMode === 'combined' && req.user.partnerId) {
        // Combined view: Get couple-flagged entries from both user and partner
        userEntries = entries.filter(entry =>
            entry.isCoupleExpense === true &&
            (entry.userId === req.user.id || entry.userId === req.user.partnerId)
        );
    } else {
        // Individual view: Only non-couple expenses from current user
        userEntries = entries.filter(entry =>
            entry.userId === req.user.id &&
            entry.isCoupleExpense !== true
        );
    }

    res.json(userEntries);
});

// Add new entry
app.post('/api/entries', requireAuth, (req, res) => {
    const { month, type, amount, description, tags, isCoupleExpense } = req.body;

    if (!month || !type || !amount || !description) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    const newEntry = {
        id: nextId++,
        userId: req.user.id,  // Associate with current user
        month,
        type,
        amount: parseFloat(amount),
        description,
        tags: Array.isArray(tags) ? tags.map(t => String(t).toLowerCase().trim()) : [],
        isCoupleExpense: Boolean(isCoupleExpense)
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

    if (!month || !type || !amount || !description) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    entries[index] = {
        ...entries[index],
        month,
        type,
        amount: parseFloat(amount),
        description,
        tags: Array.isArray(tags) ? tags.map(t => String(t).toLowerCase().trim()) : [],
        isCoupleExpense: Boolean(isCoupleExpense)
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
    const sanitizedUsers = users.map(u => {
        const userData = {
            id: u.id,
            username: u.username,
            role: u.role,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
            isActive: u.isActive,
            entriesCount: entries.filter(e => e.userId === u.id).length,
            partnerId: u.partnerId || null
        };

        // Include partner username if linked
        if (u.partnerId) {
            const partner = findUserById(u.partnerId);
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
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true
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

    const { username, password, role, isActive } = req.body;
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

    if (password) {
        user.passwordHash = await bcrypt.hash(password, 10);
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
            if (partner) {
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

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Set up multer for file uploads (store in memory)
const upload = multer({ storage: multer.memoryStorage() });

// PDF processing endpoint with Gemini AI (for web interface)
app.post('/api/process-pdf', requireAuth, upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No PDF file uploaded.' });
    }

    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ message: 'Gemini API key not configured.' });
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

        // Define the response schema for structured output
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
                                       'salary', 'freelance', 'investment', 'transfer', 'other'],
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

        // Build the prompt
        const prompt = `Extract financial transactions from this document.

RULES:
- Convert dates to YYYY-MM format. Use ${currentMonth} if no date found.
- Amount must be a positive number (convert "R$ 1.234,56" to 1234.56)
- Type is "expense" for purchases/bills/payments, "income" for deposits/salary/refunds
- Skip totals and subtotals, only individual transactions
- Choose the most appropriate category tag for each transaction

DOCUMENT:
${text}`;

        // Call Gemini API with structured output
        const response = await genAI.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: responseSchema,
                temperature: 0.2
            }
        });

        const aiResponse = response.text;

        console.log('=== GEMINI RESPONSE ===');
        console.log(aiResponse);
        console.log('=== END GEMINI RESPONSE ===');

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
        console.error('Error processing PDF with Gemini:', error);

        // Provide more specific error messages
        let errorMessage = 'Failed to process PDF with AI.';
        if (error.message?.includes('API key')) {
            errorMessage = 'Invalid Gemini API key. Please check your configuration.';
        } else if (error.message?.includes('quota')) {
            errorMessage = 'Gemini API quota exceeded. Please try again later.';
        } else if (error.message?.includes('safety')) {
            errorMessage = 'Content was blocked by safety filters.';
        }

        res.status(500).json({ message: errorMessage });
    }
});

// HTTPS configuration
const options = {
    key: fs.readFileSync(path.join(__dirname, process.env.SSL_KEY_PATH)),
    cert: fs.readFileSync(path.join(__dirname, process.env.SSL_CERT_PATH))
};

const PORT = process.env.PORT || 443;
https.createServer(options, app).listen(PORT, () => {
    console.log(`Server running on https://localhost:${PORT}`);

    // Verify Gemini API configuration
    if (process.env.GEMINI_API_KEY) {
        console.log(`Gemini AI configured with model: ${GEMINI_MODEL}`);
        // Make a test API call to verify the key is valid
        genAI.models.generateContent({
            model: GEMINI_MODEL,
            contents: 'Hello'
        }).then(() => {
            console.log('Gemini API key verified successfully.');
        }).catch((error) => {
            console.warn('Warning: Gemini API key may be invalid:', error.message);
        });
    } else {
        console.warn('Warning: GEMINI_API_KEY not configured. PDF processing will not work.');
    }
});
