# Migration Runbook: Encrypted JSON → PostgreSQL

## Prerequisites

- SSH access to the GCP VM
- Current `data/users.json` and `data/entries.json` exist and are valid
- `ENCRYPTION_KEY` is set in the environment

---

## Phase 1: Pre-Migration Safety

```bash
# 1. Run full backup
bash backup.sh
# Verify the R2 upload succeeded

# 2. Create timestamped local snapshots
cd ~/projects/asset-management
cp data/users.json "data/users.json.pre-migration-$(date +%Y%m%d%H%M%S)"
cp data/entries.json "data/entries.json.pre-migration-$(date +%Y%m%d%H%M%S)"

# 3. Git tag
git tag pre-pg-migration
```

---

## Phase 2: Install & Harden PostgreSQL

```bash
# Install PostgreSQL
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql <<'SQL'
CREATE USER asset_app WITH PASSWORD '<STRONG_PASSWORD_HERE>';
CREATE DATABASE asset_management OWNER asset_app;
GRANT CONNECT ON DATABASE asset_management TO asset_app;
\c asset_management
GRANT USAGE ON SCHEMA public TO asset_app;
GRANT CREATE ON SCHEMA public TO asset_app;
SQL

# Harden pg_hba.conf (local connections only, scram-sha-256)
sudo nano /etc/postgresql/*/main/pg_hba.conf
# Ensure:
#   local   all   asset_app   scram-sha-256
#   host    all   asset_app   127.0.0.1/32   scram-sha-256

# Harden postgresql.conf
sudo nano /etc/postgresql/*/main/postgresql.conf
# Set:
#   listen_addresses = 'localhost'
#   log_statement = 'ddl'
#   shared_buffers = 128MB   (or 256MB if available)

# Restart PostgreSQL
sudo systemctl restart postgresql

# Block external access to port 5432
sudo ufw deny 5432/tcp
```

---

## Phase 3: Run Schema

```bash
cd ~/projects/asset-management
sudo -u postgres psql -d asset_management -f db/schema.sql
```

---

## Phase 4: Install Dependencies

```bash
npm install pg
```

---

## Phase 5: Set Environment Variables

Add to your systemd service file (`/etc/systemd/system/asset-management.service`):

```ini
Environment=NODE_ENV=production
Environment=PGHOST=localhost
Environment=PGDATABASE=asset_management
Environment=PGUSER=asset_app
Environment=PGPASSWORD=<STRONG_PASSWORD_HERE>
```

Then reload:
```bash
sudo systemctl daemon-reload
```

For the migration script, export them in the current shell:
```bash
export PGHOST=localhost
export PGDATABASE=asset_management
export PGUSER=asset_app
export PGPASSWORD=<STRONG_PASSWORD_HERE>
```

---

## Phase 6: Run Migration Script

```bash
cd ~/projects/asset-management
node db/migrate-json-to-pg.js
```

**Expected output:**
- Row counts for each table matching the source JSON arrays
- "Migration committed successfully."

If the script prints "ROW COUNT MISMATCH — ROLLING BACK", investigate before retrying.

---

## Phase 7: Deploy New Code

```bash
# Stop the running service
sudo systemctl stop asset-management

# Deploy new code (git pull or copy)
git pull origin main

# Start the service
sudo systemctl start asset-management
```

---

## Phase 8: Smoke Test

Test each of these manually:

- [ ] Login/logout
- [ ] Create a new entry
- [ ] Edit an entry
- [ ] Delete an entry
- [ ] View combined couple entries (if applicable)
- [ ] Admin panel: user list loads
- [ ] Admin panel: create invite code
- [ ] Admin panel: delete user (check cascade)
- [ ] 2FA setup/verify (tests encrypted field round-trip)
- [ ] API key save/delete
- [ ] AI chat (tests tool functions reading entries from DB)

---

## Phase 9: Monitor

```bash
sudo journalctl -u asset-management -f
```

Watch for 30 minutes. Zero errors expected.

---

## Rollback Procedure

If something goes wrong:

```bash
# Stop the new service
sudo systemctl stop asset-management

# Revert to pre-migration code
cd ~/projects/asset-management
git checkout pre-pg-migration

# Remove PG env vars from systemd (or they'll cause config.js to fail-fast)
# Edit /etc/systemd/system/asset-management.service and remove PG* lines
sudo systemctl daemon-reload

# Start the old service (JSON files were never modified)
sudo systemctl start asset-management
```

The JSON files (`data/users.json`, `data/entries.json`) are untouched by the migration.

---

## Post-Migration Cleanup (after 30 days)

- Remove `data/users.json.pre-migration-*` snapshots
- Remove `encryptData()` and `decryptData()` from server.js (no longer called)
- Optionally remove `data/` folder backup from `backup.sh`
- Remove the `pre-pg-migration` git tag if no longer needed
