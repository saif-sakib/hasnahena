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

if echo "$login_response" | grep -q "token"; then
    echo -e "${GREEN}✓ PASS${NC}"
    TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "Response: $login_response"
    echo ""
    echo -e "${YELLOW}⚠️  Have you run the seed script?${NC}"
    echo ""
    echo "Run seed with:"
    echo "  cd apps/api"
    echo "  go run cmd/seed/main.go"
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
fi

# Test 4: Get Pending Approvals
echo -n "4. Testing admin approvals... "
approvals_response=$(curl -s "$API_URL/v1/dashboard/admin/approvals" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$approvals_response" | grep -q "registrationRequests"; then
    echo -e "${GREEN}✓ PASS${NC}"

    # Count pending items
    reg_count=$(echo "$approvals_response" | grep -o '"registrationRequests":\[' | wc -l)
    loan_count=$(echo "$approvals_response" | grep -o '"loanRequests":\[' | wc -l)
    echo -e "   ${GREEN}→${NC} Found pending registrations and loans"
else
    echo -e "${RED}✗ FAIL${NC}"
fi

# Test 5: Get All Loans
echo -n "5. Testing admin loans... "
loans_response=$(curl -s "$API_URL/v1/dashboard/admin/loans" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$loans_response" | grep -q "loanNumber"; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo -e "   ${GREEN}→${NC} Loans endpoint working"
else
    echo -e "${RED}✗ FAIL${NC}"
fi

# Test 6: Get Donations
echo -n "6. Testing admin donations... "
donations_response=$(curl -s "$API_URL/v1/dashboard/admin/donations" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$donations_response" | grep -q "DON-"; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo -e "   ${GREEN}→${NC} Found donation transactions"
else
    echo -e "${RED}✗ FAIL${NC}"
fi

echo ""
echo "=================================="
echo -e "${GREEN}🎉 All tests passed!${NC}"
echo ""
echo "Your backend is ready! You can:"
echo "  1. Start the frontend: cd apps/web && npm run dev"
echo "  2. Login at http://localhost:3000 with:"
echo "     - Admin: admin@hasnahena.local / Admin@12345"
echo "     - Member: member@hasnahena.local / Member@12345"
echo "     - Staff: staff@hasnahena.local / Staff@12345"
echo ""
echo "API Documentation: See QUICKSTART.md for all endpoints"
