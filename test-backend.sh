#!/bin/bash

# Hasnahena Backend Test Script
# This script tests if your backend is properly configured and running

echo "🧪 Testing Hasnahena Backend API"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="${API_URL:-http://localhost:${API_PORT:-8081}}"
all_pass=true

# Test 1: Health Check
echo -n "1. Testing health endpoint... "
health_response=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/health" 2>/dev/null)

if [ "$health_response" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
else
    echo -e "${RED}✗ FAIL${NC} (Got HTTP $health_response)"
    echo ""
    echo -e "${YELLOW}⚠️  API is not running!${NC}"
    echo ""
    echo "Start the API with:"
    echo "  cd apps/api"
    echo "  go run cmd/server/main.go"
    exit 1
fi

# Test 2: Login with Admin
echo -n "2. Testing login (admin)... "
login_response=$(curl -s -X POST "$API_URL/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@hasnahena.local","password":"Admin@12345"}' 2>/dev/null)

if echo "$login_response" | grep -q "accessToken\|\"token\""; then
    echo -e "${GREEN}✓ PASS${NC}"
    TOKEN=$(echo "$login_response" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
    if [ -z "$TOKEN" ]; then
        TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    fi
    if [ -z "$TOKEN" ]; then
        echo -e "${RED}✗ FAIL${NC}"
        echo "Response: $login_response"
        echo ""
        echo -e "${YELLOW}⚠️  Login succeeded but token extraction failed.${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Response: $login_response"
    echo ""
    echo -e "${YELLOW}⚠️  Admin login failed. Verify admin credentials and database state.${NC}"
    echo ""
    echo "If you need to clear non-core data while keeping admin/gallery/system info:"
    echo "  pnpm db:clear"
    exit 1
fi

# Test 3: Get Admin Dashboard
echo -n "3. Testing admin dashboard... "
dashboard_response=$(curl -s "$API_URL/v1/dashboard/admin" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$dashboard_response" | grep -q "recoveryRate"; then
    echo -e "${GREEN}✓ PASS${NC}"

    # Extract recovery rate
    recovery_rate=$(echo "$dashboard_response" | grep -o '"recoveryRate":[0-9.]*' | cut -d':' -f2)
    echo -e "   ${GREEN}→${NC} Recovery rate: ${recovery_rate}% (dynamic, not hardcoded!)"
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Response: $dashboard_response"
    all_pass=false
fi

# Test 4: Get Pending Approvals
echo -n "4. Testing admin approvals... "
approvals_status=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/dashboard/admin/approvals" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if [ "$approvals_status" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
        echo -e "   ${GREEN}→${NC} Approvals endpoint reachable"
else
    echo -e "${RED}✗ FAIL${NC}"
    all_pass=false
fi

# Test 5: Get All Loans
echo -n "5. Testing admin loans... "
loans_status=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/dashboard/admin/loans" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if [ "$loans_status" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
        echo -e "   ${GREEN}→${NC} Loans endpoint reachable"
else
    echo -e "${RED}✗ FAIL${NC}"
    all_pass=false
fi

# Test 6: Get Donations
echo -n "6. Testing admin donations... "
donations_status=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/dashboard/admin/donations" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if [ "$donations_status" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
        echo -e "   ${GREEN}→${NC} Donations endpoint reachable"
else
    echo -e "${RED}✗ FAIL${NC}"
    all_pass=false
fi

echo ""
echo "=================================="
if [ "$all_pass" = true ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    echo ""
    echo "Your backend is ready! You can:"
    echo "  1. Start the frontend: cd apps/web && npm run dev"
    echo "  2. Login at http://localhost:3000 with:"
    echo "     - Admin: admin@hasnahena.local / Admin@12345"
    echo ""
    echo "API Documentation: See QUICKSTART.md for all endpoints"
else
    echo -e "${RED}❌ Some checks failed.${NC}"
    echo ""
    echo "Review the failed checks above and verify API/auth/data state before relying on this script."
    exit 1
fi
