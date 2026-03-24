#!/bin/bash

# Database Reset and Seed Script for Hasnahena
# Usage: ./scripts/db-reset-seed.sh

set -e

echo "========================================="
echo "  Hasnahena Database Reset & Seed"
echo "========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${YELLOW}Working from: $PROJECT_ROOT${NC}"

# Load environment variables
if [ -f "$PROJECT_ROOT/.env.local" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env.local" | grep -v '^$' | xargs)
    echo -e "${GREEN}✓ Loaded environment from .env.local${NC}"
else
    echo -e "${RED}✗ .env.local not found!${NC}"
    exit 1
fi

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}✗ DATABASE_URL is not set!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ DATABASE_URL is configured${NC}"

# Step 1: Reset Prisma schema
echo ""
echo -e "${YELLOW}Step 1: Pushing Prisma schema (force reset)...${NC}"
cd "$PROJECT_ROOT/apps/web"
npx prisma db push --force-reset --accept-data-loss

echo -e "${GREEN}✓ Database schema pushed${NC}"

# Step 2: Generate Prisma client
echo ""
echo -e "${YELLOW}Step 2: Generating Prisma client...${NC}"
npx prisma generate

echo -e "${GREEN}✓ Prisma client generated${NC}"

# Step 3: Run Go seed script
echo ""
echo -e "${YELLOW}Step 3: Running seed script...${NC}"
cd "$PROJECT_ROOT/apps/api"
go run ./cmd/seed/main.go

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  Database Reset & Seed Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "Test credentials:"
echo "  Member: member@hasnahena.local / Member@12345"
echo "  Admin:  admin@hasnahena.local / Admin@12345"
echo "  Staff:  staff@hasnahena.local / Staff@12345"
echo ""
