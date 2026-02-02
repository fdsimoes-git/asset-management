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
- **Data Isolation**: Each user sees only their own entries
- **Admin Panel**: Admins can create, activate/deactivate, and delete users
- **Role-Based Access**: Admin and regular user roles

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

#### Bulk Import Workflow
1. Click "Bulk PDF Upload" in the header
2. Select a PDF file (bank statement, receipt, etc.)
3. Click "Upload and Process" to send to Gemini AI
4. Review extracted entries in the preview table
5. Edit any entries inline (month, type, amount, description, category)
6. Use Edit/Delete buttons to modify or remove individual rows
7. Click "Confirm and Add Entries" to save all entries

### Data Visualization
- **Asset Progression**: Line chart showing cumulative total assets over time
- **Monthly Comparison**: Grouped bar chart of income vs expenses per month
- **Category Distribution**: Horizontal bar chart showing expense breakdown by category
- **Category Trends**: Stacked bar chart showing expense categories evolution per month
- **Summary Statistics**: Total income, expenses, and net balance

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
- **Google Gemini API Key** (for PDF processing)

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

5. **Configure environment variables** by creating `.env`:
   ```env
   SESSION_SECRET=your-secure-session-secret
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=your-bcrypt-hashed-password
   SSL_KEY_PATH=ssl/server.key
   SSL_CERT_PATH=ssl/server.crt
   PORT=443
   GEMINI_API_KEY=your-gemini-api-key
   ENCRYPTION_KEY=your-32-byte-hex-encryption-key
   ```

6. **Generate admin password hash**:
   ```bash
   npm run hash-password your-password
   ```

## Authentication Setup

### Initial Admin Setup
On first run, the system automatically migrates the admin user from environment variables:
- `ADMIN_USERNAME` (defaults to "admin")
- `ADMIN_PASSWORD_HASH` (bcrypt hash from `.env`)

### User Registration
New users can register at `/register.html` with:
- Username (3-30 characters, alphanumeric and underscores)
- Password (minimum 8 characters)

### Admin User Management
Admins can access the Admin Panel to:
- Create new users with specified roles
- Activate/deactivate user accounts
- Delete users (and their associated entries)
- View user statistics

## Network Setup (Local DNS)

To access via `https://asset-manager.local`:

1. **Add to hosts file** on each device:
   - **Linux/macOS**: `echo "192.168.86.80 asset-manager.local" | sudo tee -a /etc/hosts`
   - **Windows**: Add `192.168.86.80 asset-manager.local` to `C:\Windows\System32\drivers\etc\hosts`

2. **Or configure your router** to use the server as DNS

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
- **Input Validation**: Server-side validation for all inputs
- **Data Isolation**: Users can only access their own entries
- **Role-Based Access**: Admin-only endpoints protected

## Data Storage

- **Users**: `data/users.json` (encrypted)
- **Entries**: `data/entries.json` (encrypted)
- **Format**: JSON with AES-256-CBC encryption
- **User Model**: `{ id, username, passwordHash, role, createdAt, updatedAt, isActive, partnerId, partnerLinkedAt }`
- **Entry Model**: `{ id, userId, month, type, amount, description, tags, isCoupleExpense }`

## Technical Details

### Architecture
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript with Chart.js
- **Database**: Encrypted JSON file storage
- **AI Integration**: Google Gemini API (gemini-3-flash-preview)
- **Security**: Helmet.js, bcrypt, express-session, custom AES encryption

### API Endpoints

#### Authentication
- `POST /api/login` - User authentication
- `POST /api/register` - User registration
- `POST /api/logout` - End session
- `GET /api/user` - Get current user info

#### Entries (requires authentication)
- `GET /api/entries` - Retrieve user's entries
- `POST /api/entries` - Add new entry
- `PUT /api/entries/:id` - Update entry
- `DELETE /api/entries/:id` - Delete entry
- `POST /api/process-pdf` - Process PDF with AI

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
│   ├── login.js         # Login page logic
│   └── register.js      # Registration page logic
├── server.js            # Main server application
├── index.html           # Main dashboard
├── login.html           # Login page
├── register.html        # Registration page
├── package.json         # Dependencies
└── .env                 # Configuration (not in repo)
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
- **Backup**: Copy `data/` directory for backups

## Troubleshooting

### Common Issues
1. **Certificate Errors**: Regenerate SSL certificates or accept self-signed
2. **Gemini API Errors**: Verify `GEMINI_API_KEY` is valid
3. **DNS Issues**: Verify hosts file or router DNS configuration
4. **Permission Errors**: Run server with `sudo` for port 443
5. **Login Issues**: Ensure user account is active

### Debug Mode
- Check browser developer console for client-side errors
- Server logs show detailed processing information including AI responses

---

**Note**: This system is designed for personal/family financial management. For production use with many users, consider implementing rate limiting, a proper database system, and additional security measures.
