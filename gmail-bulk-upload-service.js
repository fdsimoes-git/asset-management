// gmail-bulk-upload-service.js
// Background service to fetch Nubank 'fatura fechou' PDFs and upload to asset management site

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const fetch = require('node-fetch');

// Allow self-signed certificates for local development
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BULK_UPLOAD_URL = 'https://asset-manager.local/api/gmail-process-pdf'; // Gmail service endpoint
const API_KEY = 'gmail-service-secret-key-2024'; // API key for Gmail service authentication

// 1. Load client secrets from a local file.
function loadCredentials() {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
}

// 2. Authorize a client with credentials, then call the Gmail API.
async function authorize() {
    const credentials = loadCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        oAuth2Client.setCredentials(token);
        
        // Check if token has the required scopes, if not, get a new token
        try {
            // Test if we can modify messages (this requires gmail.modify scope)
            const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
            // This will fail if we don't have modify scope
            await gmail.users.getProfile({ userId: 'me' });
            return oAuth2Client;
        } catch (error) {
            console.log('Token missing required scopes, getting new token...');
            // Delete old token and get new one with proper scopes
            fs.unlinkSync(TOKEN_PATH);
            return getNewToken(oAuth2Client);
        }
    }
    return getNewToken(oAuth2Client);
}

function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify'
        ],
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve, reject) => {
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) return reject('Error retrieving access token');
                oAuth2Client.setCredentials(token);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
                console.log('Token stored to', TOKEN_PATH);
                resolve(oAuth2Client);
            });
        });
    });
}

async function checkForNubankEmails(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    // Search for unread emails from the sender with the subject
    const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'from:todomundo@nubank.com.br subject:"fatura fechou" has:attachment is:unread',
        maxResults: 5,
    });
    const messages = res.data.messages || [];
    if (messages.length === 0) {
        console.log('No new Nubank fatura fechou emails found.');
        return;
    }
    for (const msg of messages) {
        await processEmail(gmail, msg.id);
    }
}

async function processEmail(gmail, messageId) {
    const msg = await gmail.users.messages.get({ userId: 'me', id: messageId });
    const parts = msg.data.payload.parts || [];
    let pdfPart = null;
    for (const part of parts) {
        if (part.filename && part.filename.endsWith('.pdf')) {
            pdfPart = part;
            break;
        }
    }
    if (!pdfPart) {
        console.log('No PDF attachment found in email:', messageId);
        return;
    }
    // Download the PDF
    const attachmentId = pdfPart.body.attachmentId;
    const attachment = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
    });
    const pdfBuffer = Buffer.from(attachment.data.data, 'base64');
    const tempPdfPath = path.join(__dirname, 'temp-nubank.pdf');
    fs.writeFileSync(tempPdfPath, pdfBuffer);
    console.log('Downloaded PDF to', tempPdfPath);
    // Upload to bulk upload endpoint
    await uploadPdf(tempPdfPath);
    // Mark email as read
    await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] },
    });
    console.log('Processed and marked email as read:', messageId);
    // Clean up temp file
    fs.unlinkSync(tempPdfPath);
}

async function uploadPdf(pdfPath) {
    const formData = new (require('form-data'))();
    formData.append('pdfFile', fs.createReadStream(pdfPath)); // Changed from 'pdf' to 'pdfFile'
    
    try {
        const res = await fetch(BULK_UPLOAD_URL, {
            method: 'POST',
            body: formData,
            headers: {
                ...formData.getHeaders(),
                'X-API-Key': API_KEY,
            },
        });
        
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Bulk upload failed: ${res.status} ${res.statusText} - ${errorText}`);
        }
        
        const result = await res.json();
        console.log('PDF uploaded successfully:', result);
    } catch (err) {
        console.error('Error uploading PDF:', err);
    }
}

// Main loop
(async () => {
    const auth = await authorize();
    setInterval(() => {
        checkForNubankEmails(auth).catch(console.error);
    }, CHECK_INTERVAL_MS);
    // Run immediately on start
    checkForNubankEmails(auth).catch(console.error);
})();

// ---
// USAGE:
// 1. Place credentials.json in project root (from Google Cloud Console)
// 2. Run: node gmail-bulk-upload-service.js
// 3. On first run, follow the link to authorize and paste the code
// 4. Service will check every 5 minutes for new Nubank fatura PDFs and upload them
// --- 