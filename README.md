# Asset Management Web Application

A secure multi-user web-based asset management system with AI-powered expense tracking that automatically processes financial documents using Google Gemini AI.

## Features

### Core Functionality
- **Multi-User Support**: Multiple users with independent data isolation
- **User Registration**: Public registration for new users
- **User Authentication**: Secure login with bcrypt password hashing
- **Asset Tracking**: Add monthly income and expense entries manually
- **Data Visualization**: Interactive charts showing asset progression, income vs expenses, and expense categories
- **Advanced Filtering**: Filter entries by date range, transaction type, and categories
- **Sortable Columns**: Click table headers to sort by any column
- **Data Management**: Edit and delete existing entries
- **Encrypted Storage**: All data encrypted at rest using AES-256-CBC

### Multi-User System
- **Public Registration**: New users can create accounts
- **Self-Service Password Reset**: Users reset their own password via email (one-time code, 15-min expiry)
- **Two-Factor Authentication (2FA)**: Optional TOTP-based 2FA using authenticator apps (Google Authenticator, Duo, Authy) with backup codes
- **Data Isolation**: Each user sees only their own entries
- **Admin Panel**: Admins can create, activate/deactivate, and delete users; view email/2FA status indicators
- **Role-Based Access**: Admin and regular user roles
- **User Settings**: Users manage their own email and 2FA via the Settings modal

### Couples/Partner Feature
- **Partner Linking**: Admins can link two users as a couple
- **View Modes**: Toggle between Individual and Combined (Couple) views
- **Couple Expenses**: Mark entries as shared couple expenses
- **Combined Analytics**: View aggregated finances for both partners
- **Admin Couple Management**: Link/unlink couples from Admin Panel

### AI-Powered Processing
- **PDF Analysis**: Upload financial documents for automatic expense extraction using Google Gemini AI
- **Smart Data Extraction**: Automatically identifies amounts, dates, descriptions, and categories from PDFs
- **Category Tagging**: AI automatically assigns expense category tags (food, transport, utilities, etc.)
- **Bulk Import**: Process multiple expenses from a single document with preview and editing
- **Per-User API Keys**: Each user can store their own encrypted Gemini API key or enter one manually per session
- **Key Priority Chain**: Manual input > user's stored key > global env var fallback

#### Bulk Import Workflow
1. Click "Bulk PDF Upload" in the header
2. Enter your Gemini API key (or use a previously saved key)
3. Optionally check "Save this key for future use" to store it encrypted
4. Select a PDF file (bank statement, receipt, etc.)
5. Click "Upload and Process" to send to Gemini AI
6. Review extracted entries in the preview table
7. Edit any entries inline (month, type, amount, description, category)
8. Use Edit/Delete buttons to modify or remove individual rows
9. Click "Confirm and Add Entries" to save all entries

### Data Visualization
- **Asset Progression**: Line chart showing cumulative total assets over time
- **Monthly Comparison**: Grouped bar chart of income vs expenses per month
- **Category Distribution**: Horizontal bar chart showing expense breakdown by category
- **Category Trends**: Stacked bar chart showing expense categories evolution per month
- **Summary Statistics**: Total income, expenses, and net balance

### Internationalization (i18n)
- **Multilingual Support**: Full English and Portuguese translations across all pages
- **Language Toggle**: Globe icon button (🌐) in the bottom-right corner of every page
- **Persistent Preference**: Language selection saved in browser localStorage

### Network & Security
- **Local DNS**: Access via `https://asset-manager.local` on your network
- **HTTPS Encryption**: All communications secured with SSL/TLS
- **Network Access**: Available to all devices on your LAN
- **Session Management**: Secure session-based authentication
- **Data Encryption**: User and entry data encrypted before storage

## Requirements

- **Node.js** 18.x or higher
- **npm** (Node Package Manager)
- **Modern web browser** with JavaScript enabled
- **Google Gemini API Key** (optional globally; users can provide their own)

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

5. **Configure environment variables**:

   **Local dev** — copy the example and fill in your values:
   ```bash
   cp .env.example .env
   ```

   **Production** — set secrets as system environment variables (e.g. via systemd `Environment=` directives). No `.env` file should exist on the server.

   Required variables:
   ```env
   ENCRYPTION_KEY=your-64-char-hex-key          # Required — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   SESSION_SECRET=your-secure-session-secret     # Required
   ADMIN_USERNAME=admin                          # Optional (defaults to "admin")
   ADMIN_PASSWORD_HASH=your-bcrypt-hashed-password
   PORT=443
   GEMINI_API_KEY=your-gemini-api-key            # Optional: global fallback for all users
   UMAMI_WEBSITE_ID=your-umami-website-id        # Optional: analytics
   SMTP_HOST=smtp.gmail.com                      # Optional: enables self-service password reset
   SMTP_PORT=587                                 # Optional
   SMTP_USER=your-email@gmail.com                # Optional
   SMTP_PASS=your-app-password                   # Optional (Gmail: use App Password)
   SMTP_FROM=your-email@gmail.com                # Optional
   ```

   > **SMTP is optional.** If not configured, password resets can only be done by an admin. All five `SMTP_*` variables must be set for the feature to activate.

   The server validates `ENCRYPTION_KEY` and `SESSION_SECRET` at startup and exits with a clear error if either is missing.

6. **Generate admin password hash**:
   ```bash
   npm run hash-password your-password
   ```

## Authentication Setup

### Initial Admin Setup
On first run, the system automatically migrates the admin user from environment variables:
- `ADMIN_USERNAME` (defaults to "admin")
- `ADMIN_PASSWORD_HASH` (bcrypt hash from environment variables)

### User Registration
New users can register at `/register.html` with:
- Username (3-30 characters, alphanumeric and underscores)
- Password (minimum 8 characters)

### Password Reset
Users can reset their own password at `/forgot-password.html`:
1. Enter your username
2. Receive a one-time code by email (8-char alphanumeric, expires in 15 minutes)
3. Enter the code and choose a new password

Requires SMTP to be configured and the user to have set an email in Settings.

### Admin User Management
Admins can access the Admin Panel to:
- Create new users with specified roles
- Activate/deactivate user accounts
- Delete users (and their associated entries)
- View user statistics, email status, and 2FA status

## Network Setup (Local DNS)

To access via `https://asset-manager.local`:

1. **Add to hosts file** on each device:
   - **Linux/macOS**: `echo "192.168.86.80 asset-manager.local" | sudo tee -a /etc/hosts`
   - **Windows**: Add `192.168.86.80 asset-manager.local` to `C:\Windows\System32\drivers\etc\hosts`

2. **Or configure your router** to use the server as DNS

## Usage

### Starting the Server

**Production** (systemd):
```bash
sudo systemctl start asset-management
```

**Local dev**:
```bash
node server.js
```

### Accessing the Application
- **Local**: `https://asset-manager.local`
- **Network**: `https://192.168.86.80`
- **Localhost**: `https://localhost:443`

### Using the System

1. **Register/Login**: Create an account or login with existing credentials
2. **Manual Entry**: Add income/expenses using the form with optional category tags
3. **PDF Upload**: Upload financial documents for AI-powered expense extraction
4. **Data Analysis**: View charts and filter data by date/type/category
5. **Admin Panel** (admins only): Manage users from the Admin Panel button

## Category Tags

Available expense/income categories:
- Food, Groceries, Transport, Travel, Entertainment
- Utilities, Healthcare, Education, Shopping, Subscription
- Housing, Salary, Freelance, Investment, Transfer, Wedding, Other

## Security Features

- **HTTPS Encryption**: All data transmitted securely
- **Password Hashing**: bcrypt with 10 salt rounds
- **Session Security**: HTTP-only, secure cookies (24-hour expiration)
- **Data Encryption**: AES-256-CBC for stored data
- **API Key Encryption**: Per-user Gemini keys double-encrypted (field-level + file-level AES-256-CBC)
- **TOTP 2FA**: Time-based one-time passwords with encrypted secret storage and bcrypt-hashed backup codes
- **Email Encryption**: User emails encrypted at rest with AES-256-CBC
- **Email Privacy**: Admins see only email/2FA status indicators, not actual addresses
- **Reset Code Security**: Single-use, 15-min expiry, one active per user, code-username binding verified
- **Anti-Enumeration**: Generic responses on forgot-password; timing-safe (background processing)
- **Input Validation**: Server-side validation for all inputs
- **Data Isolation**: Users can only access their own entries
- **Role-Based Access**: Admin-only endpoints protected

## Data Storage

- **Users**: `data/users.json` (encrypted)
- **Entries**: `data/entries.json` (encrypted)
- **Format**: JSON with AES-256-CBC encryption
- **User Model**: `{ id, username, passwordHash, role, createdAt, updatedAt, isActive, partnerId, partnerLinkedAt, geminiApiKey?, email?, totpSecret?, totpEnabled, backupCodes }`
- **Entry Model**: `{ id, userId, month, type, amount, description, tags, isCoupleExpense }`

## Technical Details

### Architecture
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript with Chart.js
- **Database**: Encrypted JSON file storage
- **AI Integration**: Google Gemini API (gemini-3.1-pro-preview)
- **Security**: Helmet.js, bcrypt, express-session, otplib (TOTP 2FA), custom AES encryption

### API Endpoints

#### Authentication
- `POST /api/login` - User authentication
- `POST /api/register` - User registration
- `POST /api/logout` - End session
- `GET /api/user` - Get current user info (includes `hasGeminiApiKey` flag)
- `POST /api/forgot-password` - Request password reset code (rate limited: 3/15min)
- `POST /api/reset-password` - Reset password with code

#### User Settings (requires authentication)
- `GET /api/user/email` - Get masked email status
- `PUT /api/user/email` - Update email
- `DELETE /api/user/email` - Remove email
- `POST /api/user/gemini-key` - Save encrypted Gemini API key
- `DELETE /api/user/gemini-key` - Remove saved Gemini API key
- `GET /api/user/2fa/status` - Get 2FA status
- `POST /api/user/2fa/setup` - Start 2FA setup (generates QR code)
- `POST /api/user/2fa/verify` - Verify and enable 2FA
- `POST /api/user/2fa/disable` - Disable 2FA

#### Entries (requires authentication)
- `GET /api/entries` - Retrieve user's entries
- `POST /api/entries` - Add new entry
- `PUT /api/entries/:id` - Update entry
- `DELETE /api/entries/:id` - Delete entry
- `POST /api/process-pdf` - Process PDF with AI (accepts optional `geminiApiKey` field)

#### Admin (requires admin role)
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create user
- `PUT /api/admin/users/:id` - Update user
- `DELETE /api/admin/users/:id` - Delete user
- `GET /api/admin/couples` - List all linked couples
- `POST /api/admin/couples/link` - Link two users as a couple
- `POST /api/admin/couples/unlink` - Unlink a couple

### File Structure
```
asset-management/
├── ssl/                 # SSL certificates
├── data/                # Encrypted data storage
│   ├── users.json       # User accounts (encrypted)
│   └── entries.json     # Financial entries (encrypted)
├── js/
│   ├── app.js           # Main application logic
│   ├── i18n.js          # Internationalization (EN/PT translations)
│   ├── login.js         # Login page logic
│   ├── register.js      # Registration page logic
│   └── forgot-password.js # Password reset page logic
├── server.js            # Main server application
├── config.js            # Centralized config with startup validation
├── index.html           # Main dashboard
├── login.html           # Login page
├── register.html        # Registration page
├── forgot-password.html # Self-service password reset page
├── package.json         # Dependencies
└── .env.example         # Environment variable template
```

## Migration

When upgrading from single-user to multi-user:
1. The system automatically creates an admin user from `.env` credentials
2. Existing entries are automatically assigned to the admin user
3. No manual migration steps required

## Maintenance

- **Logs**: Server logs available in terminal output
- **Updates**: `npm update` to update dependencies
- **SSL Renewal**: Regenerate certificates annually
- **Backup**: Run `./backup.sh` to back up `data/` to Google Drive via rclone

### Rotating the Encryption Key

To rotate `ENCRYPTION_KEY` without losing access to encrypted data:

```bash
sudo bash rotate-key.sh
```

The script will:
1. Back up current data to Google Drive
2. Stop the service
3. Print the old key — save it to a password manager (needed to decrypt old backups)
4. Re-encrypt `data/entries.json` and `data/users.json` with a new key
5. Open `systemctl edit --full` for you to update the key
6. Verify the key was changed and restart the service

`.bak` files are created before any modification. If anything fails, the script automatically rolls back.

## Troubleshooting

### Common Issues
1. **Certificate Errors**: Regenerate SSL certificates or accept self-signed
2. **Gemini API Errors**: Verify your API key is valid (per-user key, or global `GEMINI_API_KEY` env var)
3. **DNS Issues**: Verify hosts file or router DNS configuration
4. **Permission Errors**: Run server with `sudo` for port 443
5. **Login Issues**: Ensure user account is active

### Debug Mode
- Check browser developer console for client-side errors
- Server logs show detailed processing information including AI responses

---

**Note**: This system is designed for personal/family financial management. For production use with many users, consider implementing rate limiting, a proper database system, and additional security measures.
