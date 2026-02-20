#!/bin/bash
# Rotate ENCRYPTION_KEY for asset-management
# Usage: sudo bash rotate-key.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Must run as root (needs systemctl access)
if [ "$EUID" -ne 0 ]; then
    echo "Run as root: sudo bash rotate-key.sh"
    exit 1
fi

# Extract current ENCRYPTION_KEY from systemd override
ENV_LINE=$(systemctl show asset-management -p Environment --value 2>/dev/null || true)
ENCRYPTION_KEY=$(echo "$ENV_LINE" | grep -oP 'ENCRYPTION_KEY=\K[0-9a-fA-F]{64}' || true)

if [ -z "$ENCRYPTION_KEY" ]; then
    echo "Could not read ENCRYPTION_KEY from systemd."
    echo "Make sure the asset-management service is configured."
    exit 1
fi

echo "Stopping asset-management service..."
systemctl stop asset-management

echo ""
export ENCRYPTION_KEY
node "$SCRIPT_DIR/rotate-encryption-key.js"
STATUS=$?

if [ $STATUS -ne 0 ]; then
    echo ""
    echo "Rotation failed. Restarting service with old key..."
    systemctl start asset-management
    exit 1
fi

echo ""
read -p "Open 'sudo systemctl edit asset-management' now to update the key? [Y/n] " ANSWER
if [ "$ANSWER" != "n" ] && [ "$ANSWER" != "N" ]; then
    systemctl edit asset-management
    systemctl daemon-reload
fi

echo "Restarting asset-management service..."
systemctl restart asset-management
echo "Done."
