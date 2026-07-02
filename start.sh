#!/usr/bin/env bash
set -e

# Create uploads directory if it doesn't exist
mkdir -p uploads

# Run the server
exec node src/app.js
