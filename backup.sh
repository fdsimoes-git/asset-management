#!/bin/bash
# Asset Management Backup Script
# Backs up data folder and .env to Google Drive via rclone

# Configuration
SOURCE_DIR="/home/ubuntu/projects/asset-management"
REMOTE="gdrive:asset_management_backup_files_internet"
DATETIME=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_DIR="$REMOTE/$DATETIME"

# Copy data folder
if [ -d "$SOURCE_DIR/data" ]; then
    rclone copy "$SOURCE_DIR/data" "$BACKUP_DIR/data"
    echo "Backed up: data folder"
else
    echo "Warning: data folder not found"
fi

# Copy .env file
if [ -f "$SOURCE_DIR/.env" ]; then
    rclone copy "$SOURCE_DIR/.env" "$BACKUP_DIR/"
    echo "Backed up: .env file"
else
    echo "Warning: .env file not found"
fi

echo "Backup completed: $BACKUP_DIR at $(date)"

# Optional: Remove backups older than 30 days
rclone delete "$REMOTE" --min-age 30d
rclone rmdirs "$REMOTE" --leave-root

echo "Cleanup: Removed backups older than 30 days"
