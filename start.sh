#!/bin/sh
set -e

echo "Running database migrations..."
npx medusa db:migrate --execute-safe-links < /dev/null

echo "Starting Medusa server..."
npx medusa start
