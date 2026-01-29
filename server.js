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

// Load entries on startup
loadEntries();

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
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized' });
    }
};

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    const validUsername = process.env.ADMIN_USERNAME || 'admin';
    const validPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (username === validUsername &&
        await bcrypt.compare(password, validPasswordHash)) {
        req.session.user = { username };
        res.json({ message: 'Login successful' });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
});

// Get all entries
app.get('/api/entries', requireAuth, (req, res) => {
    res.json(entries);
});

// Add new entry
app.post('/api/entries', requireAuth, (req, res) => {
    const { month, type, amount, description, tags } = req.body;

    if (!month || !type || !amount || !description) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    const newEntry = {
        id: nextId++,
        month,
        type,
        amount: parseFloat(amount),
        description,
        tags: Array.isArray(tags) ? tags.map(t => String(t).toLowerCase().trim()) : []
    };

    entries.push(newEntry);
    saveEntries(); // Save to file after adding
    res.status(201).json(newEntry);
});

// Update entry
app.put('/api/entries/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const index = entries.findIndex(entry => entry.id === id);

    if (index === -1) {
        return res.status(404).json({ message: 'Entry not found' });
    }

    const { month, type, amount, description, tags } = req.body;

    if (!month || !type || !amount || !description) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    entries[index] = {
        ...entries[index],
        month,
        type,
        amount: parseFloat(amount),
        description,
        tags: Array.isArray(tags) ? tags.map(t => String(t).toLowerCase().trim()) : []
    };

    saveEntries();
    res.json(entries[index]);
});

// Delete entry
app.delete('/api/entries/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const index = entries.findIndex(entry => entry.id === id);

    if (index === -1) {
        return res.status(404).json({ message: 'Entry not found' });
    }

    entries.splice(index, 1);
    saveEntries(); // Save to file after deleting
    res.json({ message: 'Entry deleted successfully' });
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
