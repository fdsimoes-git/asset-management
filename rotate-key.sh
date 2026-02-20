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

# Export all environment variables from systemd service (config.js needs SESSION_SECRET too)
ENV_LINE=$(systemctl show asset-management -p Environment --value 2>/dev/null || true)

if [ -z "$ENV_LINE" ]; then
    echo "Could not read environment from systemd."
    echo "Make sure the asset-management service is configured."
    exit 1
fi

# Parse and export each KEY=VALUE pair
while IFS='=' read -r key value; do
    export "$key=$value"
done < <(echo "$ENV_LINE" | grep -oP '[A-Z_]+=\S+')

if [ -z "$ENCRYPTION_KEY" ]; then
    echo "ENCRYPTION_KEY not found in systemd environment."
    exit 1
fi

if ! [[ "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "Invalid ENCRYPTION_KEY format in systemd (expected 64 hex characters)."
    echo "Fix the asset-management service configuration before rotating the key."
    exit 1
fi

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
read -p "Open 'sudo systemctl edit asset-management' now to update the key? [Y/n] " ANSWER

if [ "$ANSWER" = "n" ] || [ "$ANSWER" = "N" ]; then
    echo ""
    echo "Data files are now encrypted with the NEW key, but systemd still has the old key."
    echo "The service will NOT be restarted. Update the key manually:"
    echo "  sudo systemctl edit asset-management"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl restart asset-management"
    exit 1
fi

systemctl edit asset-management
systemctl daemon-reload

# Verify the key was actually changed
NEW_ENV_LINE=$(systemctl show asset-management -p Environment --value 2>/dev/null || true)
NEW_ENCRYPTION_KEY=$(echo "$NEW_ENV_LINE" | grep -oP 'ENCRYPTION_KEY=\K[0-9a-fA-F]{64}' || true)

if [ "$NEW_ENCRYPTION_KEY" = "$ENCRYPTION_KEY" ]; then
    echo ""
    echo "WARNING: ENCRYPTION_KEY in systemd was not updated (still the old value)."
    echo "The service will NOT be restarted. Data files use the new key — update systemd:"
    echo "  sudo systemctl edit asset-management"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl restart asset-management"
    exit 1
fi

echo "Restarting asset-management service..."
systemctl restart asset-management
echo "Done."
