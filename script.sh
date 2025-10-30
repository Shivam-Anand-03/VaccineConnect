#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "==> Checking Docker availability..."
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed or not in PATH. Please install Docker." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon is not running. Please start Docker." >&2
  exit 1
fi

echo "==> Ensuring Docker Compose is available..."
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Error: docker compose or docker-compose is not available. Install Docker Compose." >&2
  exit 1
fi

COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: docker-compose.yml not found at $COMPOSE_FILE" >&2
  exit 1
fi

POSTGRES_SERVICE="postgres"
POSTGRES_CONTAINER_NAME="vaccine_postgres"

echo "==> Pulling PostgreSQL image if needed..."
$COMPOSE_CMD pull "$POSTGRES_SERVICE" || true

echo "==> Starting PostgreSQL with Docker Compose..."
$COMPOSE_CMD up -d "$POSTGRES_SERVICE"

echo "==> Waiting for PostgreSQL to become ready..."
RETRIES=60
SLEEP_SECS=2
READY=0
for i in $(seq 1 $RETRIES); do
  if docker exec "$POSTGRES_CONTAINER_NAME" pg_isready -U madhav -d vaccine -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep "$SLEEP_SECS"
done

if [ "$READY" -ne 1 ]; then
  echo "Error: PostgreSQL did not become ready in time." >&2
  $COMPOSE_CMD logs "$POSTGRES_SERVICE" | tail -n 200 || true
  exit 1
fi
echo "==> PostgreSQL is ready."

echo "==> Installing Node.js dependencies if needed..."
if [ ! -d "${PROJECT_DIR}/node_modules" ]; then
  if command -v npm >/dev/null 2>&1; then
    npm ci || npm install
  else
    echo "Error: npm is not installed or not in PATH." >&2
    exit 1
  fi
fi

echo "==> Starting the application..."
if [ -f "${PROJECT_DIR}/app.js" ]; then
  npm run start
else
  if [ -f "${PROJECT_DIR}/server.js" ]; then
    node server.js
  else
    echo "Error: Could not find app entry (app.js or server.js)." >&2
    exit 1
  fi
fi


