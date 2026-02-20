#!/bin/bash
# Rotate ENCRYPTION_KEY for asset-management
# Usage: sudo bash rotate-key.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROTATE_SCRIPT="$SCRIPT_DIR/rotate-encryption-key.js"

# Must run as root (needs systemctl access)
if [ "$EUID" -ne 0 ]; then
    echo "Run as root: sudo bash rotate-key.sh"
    exit 1
fi

# Check Node script exists before doing anything
if [ ! -r "$ROTATE_SCRIPT" ]; then
    echo "Rotation script not found: $ROTATE_SCRIPT"
    exit 1
fi

# Load environment variables from the systemd service configuration
# Uses `systemctl cat` which works regardless of where the config lives
# Handles indented lines and quoted values: Environment="KEY=value"
ENV_LINES=$(systemctl cat asset-management 2>/dev/null | sed -n 's/^[[:space:]]*Environment=//p' || true)

if [ -z "$ENV_LINES" ]; then
    echo "No Environment= lines found in asset-management service."
    echo "Make sure the service has environment variables configured."
    exit 1
fi

while IFS= read -r line; do
    # Strip surrounding quotes if present
    line="${line#\"}"
    line="${line%\"}"
    export "$line"
done <<< "$ENV_LINES"

if [ -z "$ENCRYPTION_KEY" ]; then
    echo "ENCRYPTION_KEY not found in systemd override."
    exit 1
fi

if ! [[ "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "Invalid ENCRYPTION_KEY format in systemd (expected 64 hex characters)."
    echo "Fix the asset-management service configuration before rotating the key."
    exit 1
fi

# Run backup before stopping the service — if it fails, nothing is disrupted
REAL_USER="${SUDO_USER:-$(logname)}"
echo "Running backup.sh as $REAL_USER..."
sudo -u "$REAL_USER" bash "$SCRIPT_DIR/backup.sh"

echo ""
echo "Stopping asset-management service..."
systemctl stop asset-management

echo ""
node "$ROTATE_SCRIPT"
STATUS=$?

if [ $STATUS -ne 0 ]; then
    echo ""
    echo "Rotation failed. Restarting service with old key..."
    systemctl start asset-management
    exit 1
fi

echo ""
read -p "Open 'sudo systemctl edit --full asset-management' now to update the key? [Y/n] " ANSWER

if [ "$ANSWER" = "n" ] || [ "$ANSWER" = "N" ]; then
    echo ""
    echo "Data files are now encrypted with the NEW key, but systemd still has the old key."
    echo "The service will NOT be restarted. Update the key manually:"
    echo "  sudo systemctl edit --full asset-management"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl restart asset-management"
    exit 1
fi

systemctl edit --full asset-management
systemctl daemon-reload

# Verify the key was actually changed
NEW_ENV_LINE=$(systemctl show asset-management -p Environment --value 2>/dev/null || true)
NEW_ENCRYPTION_KEY=$(echo "$NEW_ENV_LINE" | grep -oP 'ENCRYPTION_KEY=\K[0-9a-fA-F]{64}' || true)

if [ "$NEW_ENCRYPTION_KEY" = "$ENCRYPTION_KEY" ]; then
    echo ""
    echo "WARNING: ENCRYPTION_KEY in systemd was not updated (still the old value)."
    echo "The service will NOT be restarted. Data files use the new key — update systemd:"
    echo "  sudo systemctl edit --full asset-management"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl restart asset-management"
    exit 1
fi

echo "Restarting asset-management service..."
systemctl restart asset-management
echo "Done."
