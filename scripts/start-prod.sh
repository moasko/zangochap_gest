#!/bin/sh

# Exit on error
set -e

echo "Starting production environment..."

# Database migrations are deliberately excluded from application startup.
# Production schema changes must be reviewed, backed up and run as a separate,
# explicitly approved operation. Never add `prisma db push` here.
if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is required."
  exit 1
fi

# Start the application
echo "Starting Next.js application on port ${PORT:-3000}..."
PORT=${PORT:-3000} exec node server.js
