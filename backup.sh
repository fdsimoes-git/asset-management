#!/bin/bash

# Asset Management Backup Script
# Backs up data folder and .env to Google Drive

# Configuration
SOURCE_DIR="/Volumes/Untitled/projects/asset-management"
BACKUP_BASE="$HOME/Google Drive/My Drive/asset_management_backup_files"
DATETIME=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_DIR="$BACKUP_BASE/$DATETIME"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Copy data folder
if [ -d "$SOURCE_DIR/data" ]; then
    cp -r "$SOURCE_DIR/data" "$BACKUP_DIR/"
    echo "Backed up: data folder"
else
    echo "Warning: data folder not found"
fi

# Copy .env file
if [ -f "$SOURCE_DIR/.env" ]; then
    cp "$SOURCE_DIR/.env" "$BACKUP_DIR/"
    echo "Backed up: .env file"
else
    echo "Warning: .env file not found"
fi

echo "Backup completed: $BACKUP_DIR"

# Optional: Remove backups older than 30 days
find "$BACKUP_BASE" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \; 2>/dev/null

echo "Cleanup: Removed backups older than 30 days"
