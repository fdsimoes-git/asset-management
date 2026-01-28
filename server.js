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

const app = express();

// Ollama configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

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

// PDF processing endpoint with Ollama AI (for web interface)
app.post('/api/process-pdf', requireAuth, upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No PDF file uploaded.' });
    }

    try {
        // Parse the PDF buffer
        const data = await pdfParse(req.file.buffer);
        const text = data.text;

        console.log('=== PDF EXTRACTED TEXT ===');
        console.log(text.substring(0, 500) + '...');
        console.log('=== END PDF TEXT ===');

        // Build the prompt for Ollama
        const prompt = `Please analyze the following PDF content and extract financial expense entries.

        Look for any financial transactions, expenses, or monetary amounts with dates and descriptions.

        Return the data in this exact JSON format:
        {
            "expenses": [
                {
                    "month": "YYYY-MM",
                    "amount": 123.45,
                    "description": "Description of the expense",
                    "tags": ["category1"]
                }
            ]
        }

        Rules:
        - Convert any date format to YYYY-MM format
        - Extract only numeric amounts (remove currency symbols)
        - Provide clear descriptions for each expense
        - If no clear date is found, use current month
        - Only return valid JSON, no additional text
        - Assign one or more category tags to each entry from this list: "food", "transport", "entertainment", "utilities", "healthcare", "education", "shopping", "subscription", "housing", "salary", "freelance", "investment", "transfer", "other"
        - Choose the most appropriate tags based on the description
        - Always return tags as an array of strings

        PDF Content:
        ${text}`;

        // Call Ollama API
        const ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt: prompt,
                stream: false,
                format: 'json'
            })
        });

        if (!ollamaResponse.ok) {
            const errorText = await ollamaResponse.text();
            console.error('Ollama API error:', ollamaResponse.status, errorText);
            return res.status(500).json({ message: 'Failed to get response from Ollama. Is it running?' });
        }

        const ollamaResult = await ollamaResponse.json();
        const aiResponse = ollamaResult.response;

        console.log('=== OLLAMA RESPONSE ===');
        console.log(aiResponse);
        console.log('=== END OLLAMA RESPONSE ===');

        // Parse the AI response
        let expenses = [];
        try {
            // Try to parse the response as JSON
            const parsed = JSON.parse(aiResponse);

            // Handle both { expenses: [...] } and [...] formats
            if (Array.isArray(parsed)) {
                expenses = parsed;
            } else if (parsed.expenses && Array.isArray(parsed.expenses)) {
                expenses = parsed.expenses;
            } else {
                // Try to extract JSON array from the response
                const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    expenses = JSON.parse(jsonMatch[0]);
                }
            }

            // Validate and clean the expenses
            expenses = expenses.filter(exp =>
                exp &&
                exp.month &&
                typeof exp.amount === 'number' &&
                exp.description &&
                exp.amount > 0
            );

            // Normalize tags
            expenses = expenses.map(exp => ({
                ...exp,
                tags: Array.isArray(exp.tags) ? exp.tags.map(t => String(t).toLowerCase().trim()) : []
            }));

            // Add IDs to the expenses
            expenses = expenses.map(exp => ({
                ...exp,
                id: Date.now() + Math.floor(Math.random() * 10000)
            }));

        } catch (parseError) {
            console.error('Error parsing AI response:', parseError);
            console.error('AI Response was:', aiResponse);
            return res.status(500).json({
                message: 'Failed to parse AI response. Please check the PDF format.',
                debug: aiResponse.substring(0, 200)
            });
        }

        console.log('=== FINAL EXPENSES ===');
        console.log(expenses);

        res.json(expenses);
    } catch (error) {
        console.error('Error processing PDF with Ollama:', error);
        res.status(500).json({ message: 'Failed to process PDF with AI. Ensure Ollama is running.' });
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

    // Check Ollama connectivity
    fetch(`${OLLAMA_URL}/api/tags`)
        .then(res => res.json())
        .then(data => {
            const models = data.models?.map(m => m.name).join(', ') || 'none';
            console.log(`Ollama connected. Available models: ${models}`);
        })
        .catch(() => {
            console.warn('Warning: Could not connect to Ollama. PDF processing will not work until Ollama is running.');
        });
});
