#!/bin/bash

# Asset Management System Deployment Script
# Run this script after cloning the repository

set -e

echo "Setting up Asset Management System..."

# Create necessary directories
echo "Creating directories..."
mkdir -p data ssl

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Check for required files
echo "Checking configuration..."

if [ ! -f ".env" ]; then
    echo ".env file not found. Please create it from .env.example:"
    echo "   cp .env.example .env"
    echo "   Then edit .env with your actual values."
fi

# Generate SSL certificates if they don't exist
if [ ! -f "ssl/server.key" ] || [ ! -f "ssl/server.crt" ]; then
    echo "Generating SSL certificates..."
    npm run ssl
fi

echo "Deployment setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your actual configuration values"
echo "2. Ensure Ollama is running: ollama serve"
echo "3. Pull the AI model: ollama pull llama3.2"
echo "4. Start the server: npm run start:prod"
echo ""
echo "Access your application at:"
echo "   https://asset-manager.local"
echo "   https://localhost:443"
