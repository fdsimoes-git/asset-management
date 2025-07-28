# Asset Management Web Application

A secure web-based asset management system with AI-powered expense tracking that automatically processes financial documents and emails.

## 🚀 Features

### Core Functionality
- **User Authentication**: Secure login with bcrypt password hashing
- **Asset Tracking**: Add monthly income and expense entries manually
- **Data Visualization**: Interactive charts showing asset progression and income vs expenses
- **Advanced Filtering**: Filter entries by date range and transaction type
- **Data Management**: Edit and delete existing entries
- **Encrypted Storage**: All data encrypted at rest using AES-256-CBC

### AI-Powered Processing
- **PDF Analysis**: Upload financial documents for automatic expense extraction using Google Gemini AI
- **Smart Data Extraction**: Automatically identifies amounts, dates, and descriptions from PDFs
- **Bulk Import**: Process multiple expenses from a single document

### Email Integration
- **Gmail Automation**: Automatically monitors Gmail for Nubank "fatura fechou" emails
- **Attachment Processing**: Downloads PDF attachments and processes them with AI
- **Auto-Import**: Extracted expenses are automatically added to your system
- **Background Service**: Runs continuously, checking every 5 minutes

### Network & Security
- **Local DNS**: Access via `https://asset-manager.local` on your network
- **HTTPS Encryption**: All communications secured with SSL/TLS
- **Network Access**: Available to all devices on your LAN
- **Session Management**: Secure session-based authentication
- **Data Encryption**: Client data encrypted before storage

## 📋 Requirements

- **Node.js** 14.x or higher
- **npm** (Node Package Manager)
- **Modern web browser** with JavaScript enabled
- **Gmail API credentials** (for email integration)
- **Google Gemini API key** (for AI processing)

## 🛠 Installation

1. **Clone or download** this repository
2. **Navigate** to the project directory
3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Create SSL certificates** (for HTTPS):
   ```bash
   mkdir ssl
   cd ssl
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout server.key -out server.crt \
     -subj "/C=US/ST=State/L=City/O=Organization/CN=asset-manager.local"
   cd ..
   ```

5. **Configure environment variables** by creating `.env`:
   ```env
   SESSION_SECRET=your-secure-session-secret
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=your-bcrypt-hashed-password
   SSL_KEY_PATH=ssl/server.key
   SSL_CERT_PATH=ssl/server.crt
   PORT=443
   GEMINI_API_KEY=your-google-gemini-api-key
   ENCRYPTION_KEY=your-32-byte-hex-encryption-key
   GMAIL_SERVICE_API_KEY=gmail-service-secret-key-2024
   ```

## 🔑 Authentication Setup

The default login credentials are:
- **Username**: `admin`
- **Password**: `isa_e_fe_management`

To change the password:
1. Generate a new bcrypt hash:
   ```bash
   node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('your-new-password', 10).then(hash => console.log(hash));"
   ```
2. Update `ADMIN_PASSWORD_HASH` in your `.env` file

## 🌐 Network Setup (Local DNS)

To access via `https://asset-manager.local`:

1. **Add to hosts file** on each device:
   - **Linux/macOS**: `echo "192.168.86.80 asset-manager.local" | sudo tee -a /etc/hosts`
   - **Windows**: Add `192.168.86.80 asset-manager.local` to `C:\Windows\System32\drivers\etc\hosts`

2. **Or configure your router** to use the Raspberry Pi as DNS server:
   - Router admin panel → DNS Settings
   - Primary DNS: `192.168.86.80`
   - Secondary DNS: `8.8.8.8`

## 📧 Gmail Integration Setup

1. **Google Cloud Console Setup**:
   - Create a new project or use existing
   - Enable Gmail API
   - Create OAuth 2.0 credentials
   - Download `credentials.json` to project root

2. **Enable Gemini AI**:
   - Get API key from Google AI Studio
   - Add to `.env` as `GEMINI_API_KEY`

3. **Start Gmail Service**:
   ```bash
   sudo node gmail-bulk-upload-service.js
   ```
   - Follow authorization prompts on first run
   - Service runs in background, checking every 5 minutes

## 🚀 Usage

### Starting the Server
```bash
sudo node server.js
```

### Accessing the Application
- **Local**: `https://asset-manager.local`
- **Network**: `https://192.168.86.80`
- **Localhost**: `https://localhost:443`

### Using the System

1. **Login** with your credentials
2. **Manual Entry**: Add income/expenses using the form
3. **PDF Upload**: Drag & drop financial documents for AI processing
4. **Email Automation**: Gmail service automatically processes Nubank emails
5. **Data Analysis**: View charts and filter data by date/type
6. **Export/Import**: Bulk operations for data management

## 📊 Features Overview

### Manual Entry
- Select month, type (income/expense), amount, and description
- Real-time validation and formatting
- Instant addition to dashboard

### PDF Processing
- Upload bank statements, invoices, or receipts
- AI extracts transaction details automatically
- Batch import of multiple expenses
- Smart date and amount recognition

### Email Automation
- Monitors Gmail for specific email patterns
- Downloads PDF attachments automatically
- Processes with AI and imports expenses
- Marks emails as read after processing

### Data Visualization
- **Asset Progression**: Line chart showing total assets over time
- **Monthly Comparison**: Bar chart of income vs expenses
- **Summary Statistics**: Total income, expenses, and net balance
- **Filtering**: Date ranges and transaction types

## 🔒 Security Features

- **HTTPS Encryption**: All data transmitted securely
- **Password Hashing**: bcrypt with salt rounds
- **Session Security**: HTTP-only, secure cookies
- **Data Encryption**: AES-256-CBC for stored data
- **API Authentication**: Separate keys for different services
- **Input Validation**: Server-side validation for all inputs

## 📁 Data Storage

- **Location**: `data/entries.json` (encrypted)
- **Format**: JSON with AES-256-CBC encryption
- **Backup**: Automatic backup files created
- **Migration**: Built-in data migration tools

## 🔧 Technical Details

### Architecture
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript with Chart.js
- **Database**: Encrypted JSON file storage
- **AI Integration**: Google Gemini 2.5 Pro
- **Email**: Gmail API with OAuth 2.0
- **Security**: Helmet.js, bcrypt, custom encryption

### API Endpoints
- `POST /api/login` - User authentication
- `GET /api/entries` - Retrieve all entries
- `POST /api/entries` - Add new entry
- `DELETE /api/entries/:id` - Delete entry
- `POST /api/process-pdf` - Process PDF with AI
- `POST /api/gmail-process-pdf` - Gmail service endpoint

### File Structure
```
asset_management/
├── ssl/                 # SSL certificates
├── data/               # Encrypted data storage
├── js/                 # Frontend JavaScript
├── css/               # Styling
├── server.js          # Main server application
├── gmail-bulk-upload-service.js  # Email automation
├── index.html         # Main dashboard
├── login.html         # Authentication page
├── package.json       # Dependencies
└── .env              # Configuration (not in repo)
```

## 🔄 Maintenance

- **Logs**: Server logs available in terminal output
- **Backups**: Data automatically backed up before changes
- **Updates**: `npm update` to update dependencies
- **SSL Renewal**: Regenerate certificates annually
- **Performance**: Monitor Gmail service for API limits

## 🐛 Troubleshooting

### Common Issues
1. **Certificate Errors**: Regenerate SSL certificates or accept self-signed
2. **Gmail Auth**: Re-run Gmail service and re-authorize if needed
3. **DNS Issues**: Verify hosts file or router DNS configuration
4. **Permission Errors**: Run server with `sudo` for port 443

### Debug Mode
- Check browser developer console for client-side errors
- Server logs show detailed processing information
- Gmail service logs show email processing status

---

**Note**: This system is designed for personal financial management. For production use, consider implementing additional security measures and using a proper database system. 