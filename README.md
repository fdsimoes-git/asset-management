# Asset Management Web Application

A secure web-based asset management system with AI-powered expense tracking that automatically processes financial documents using local AI models via Ollama.

## Features

### Core Functionality
- **User Authentication**: Secure login with bcrypt password hashing
- **Asset Tracking**: Add monthly income and expense entries manually
- **Data Visualization**: Interactive charts showing asset progression, income vs expenses, and expense categories
- **Advanced Filtering**: Filter entries by date range and transaction type
- **Data Management**: Edit and delete existing entries
- **Encrypted Storage**: All data encrypted at rest using AES-256-CBC

### AI-Powered Processing
- **PDF Analysis**: Upload financial documents for automatic expense extraction using local Ollama AI models
- **Smart Data Extraction**: Automatically identifies amounts, dates, descriptions, and categories from PDFs
- **Category Tagging**: AI automatically assigns expense category tags (food, transport, utilities, etc.)
- **Bulk Import**: Process multiple expenses from a single document

### Network & Security
- **Local DNS**: Access via `https://asset-manager.local` on your network
- **HTTPS Encryption**: All communications secured with SSL/TLS
- **Network Access**: Available to all devices on your LAN
- **Session Management**: Secure session-based authentication
- **Data Encryption**: Client data encrypted before storage

## Requirements

- **Node.js** 18.x or higher
- **npm** (Node Package Manager)
- **Modern web browser** with JavaScript enabled
- **Ollama** running locally (https://ollama.ai)

## Installation

1. **Clone or download** this repository
2. **Navigate** to the project directory
3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Create SSL certificates** (for HTTPS):
   ```bash
   npm run ssl
   ```

5. **Install and start Ollama**:
   ```bash
   # Install Ollama from https://ollama.ai
   ollama serve
   ollama pull llama3.2
   ```

6. **Configure environment variables** by creating `.env`:
   ```env
   SESSION_SECRET=your-secure-session-secret
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=your-bcrypt-hashed-password
   SSL_KEY_PATH=ssl/server.key
   SSL_CERT_PATH=ssl/server.crt
   PORT=443
   OLLAMA_URL=http://localhost:11434
   OLLAMA_MODEL=llama3.2
   ENCRYPTION_KEY=your-32-byte-hex-encryption-key
   ```

## Authentication Setup

The default login credentials are:
- **Username**: `admin`
- **Password**: `isa_e_fe_management`

To change the password:
1. Generate a new bcrypt hash:
   ```bash
   npm run hash-password your-new-password
   ```
2. Update `ADMIN_PASSWORD_HASH` in your `.env` file

## Network Setup (Local DNS)

To access via `https://asset-manager.local`:

1. **Add to hosts file** on each device:
   - **Linux/macOS**: `echo "192.168.86.80 asset-manager.local" | sudo tee -a /etc/hosts`
   - **Windows**: Add `192.168.86.80 asset-manager.local` to `C:\Windows\System32\drivers\etc\hosts`

2. **Or configure your router** to use the Raspberry Pi as DNS server:
   - Router admin panel > DNS Settings
   - Primary DNS: `192.168.86.80`
   - Secondary DNS: `8.8.8.8`

## Usage

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
2. **Manual Entry**: Add income/expenses using the form (with optional category tags)
3. **PDF Upload**: Upload financial documents for AI-powered expense extraction
4. **Data Analysis**: View charts and filter data by date/type
5. **Category Analysis**: View expense distribution by AI-assigned category tags

## Features Overview

### Manual Entry
- Select month, type (income/expense), amount, and description
- Add category tags (comma-separated) for expense classification
- Real-time validation and formatting
- Instant addition to dashboard

### PDF Processing
- Upload bank statements, invoices, or receipts
- Local AI (Ollama) extracts transaction details automatically
- AI assigns category tags to each expense
- Batch import of multiple expenses with preview
- Smart date and amount recognition

### Data Visualization
- **Asset Progression**: Line chart showing total assets over time
- **Monthly Comparison**: Bar chart of income vs expenses
- **Category Distribution**: Horizontal bar chart showing expense breakdown by category
- **Summary Statistics**: Total income, expenses, and net balance
- **Filtering**: Date ranges and transaction types

## Security Features

- **HTTPS Encryption**: All data transmitted securely
- **Password Hashing**: bcrypt with salt rounds
- **Session Security**: HTTP-only, secure cookies
- **Data Encryption**: AES-256-CBC for stored data
- **Input Validation**: Server-side validation for all inputs

## Data Storage

- **Location**: `data/entries.json` (encrypted)
- **Format**: JSON with AES-256-CBC encryption
- **Entry Model**: `{ id, month, type, amount, description, tags }`

## Technical Details

### Architecture
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript with Chart.js
- **Database**: Encrypted JSON file storage
- **AI Integration**: Ollama (local LLM - llama3.2)
- **Security**: Helmet.js, bcrypt, custom encryption

### API Endpoints
- `POST /api/login` - User authentication
- `GET /api/entries` - Retrieve all entries
- `POST /api/entries` - Add new entry
- `DELETE /api/entries/:id` - Delete entry
- `POST /api/process-pdf` - Process PDF with AI

### File Structure
```
asset-management/
├── ssl/                 # SSL certificates
├── data/               # Encrypted data storage
├── js/                 # Frontend JavaScript
├── server.js          # Main server application
├── index.html         # Main dashboard
├── login.html         # Authentication page
├── package.json       # Dependencies
└── .env              # Configuration (not in repo)
```

## Maintenance

- **Logs**: Server logs available in terminal output
- **Updates**: `npm update` to update dependencies
- **SSL Renewal**: Regenerate certificates annually
- **Ollama Models**: Update with `ollama pull llama3.2`

## Troubleshooting

### Common Issues
1. **Certificate Errors**: Regenerate SSL certificates or accept self-signed
2. **Ollama Not Responding**: Ensure `ollama serve` is running
3. **DNS Issues**: Verify hosts file or router DNS configuration
4. **Permission Errors**: Run server with `sudo` for port 443
5. **PDF Processing Fails**: Check Ollama model is downloaded (`ollama list`)

### Debug Mode
- Check browser developer console for client-side errors
- Server logs show detailed processing information including Ollama responses

---

**Note**: This system is designed for personal financial management. For production use, consider implementing additional security measures and using a proper database system.
