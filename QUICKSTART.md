# 🚀 Hasnahena Quick Start Guide

## Backend is 100% Complete! ✅

All backend endpoints are now connected to the **real PostgreSQL database** with:
- ✅ 25+ repository methods
- ✅ 25+ API endpoints
- ✅ Dynamic recovery rate calculation
- ✅ Comprehensive seed data with your exact login credentials

## Step 1: Setup Database

Make sure you have PostgreSQL running. Create the database:

```bash
# Using psql
createdb hasnahena_dev

# Or using SQL
psql -U postgres -c "CREATE DATABASE hasnahena_dev;"
```

## Step 2: Run Prisma Migrations

```bash
cd apps/web
npx prisma migrate dev
```

## Step 3: Create API Environment File

```bash
cd apps/api
cat > .env << 'EOF'
PORT=8080
DATABASE_URL=postgresql://postgres:password@localhost:5432/hasnahena_dev
JWT_SECRET=your-super-secret-jwt-key-min-32-characters-long-change-this
JWT_EXPIRY=86400
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
EOF
```

**⚠️ Change the DATABASE_URL password to match your PostgreSQL setup!**

## Step 4: Run Seed Data

This creates your 3 login users and comprehensive test data:

```bash
cd ../..
pnpm db:seed
```

See detailed seed usage notes in `docs/SEED_DATA.md`.

If you want a clean reset first:

```bash
pnpm db:seed:reset
```

Expected output:
```
Created seed data:
  - Member: member@hasnahena.local / Member@12345
  - Admin: admin@hasnahena.local / Admin@12345
  - Staff: staff@hasnahena.local / Staff@12345
  - 14 total members: 10 ACTIVE, 3 PENDING, 1 SUSPENDED
  - 6 loans: 1 ACTIVE, 1 COMPLETED, 1 DEFAULTED, 3 PENDING
  - 6 donation transactions (charity fund)
  - Multiple deposit and repayment transactions
```

## Step 5: Start API Server

```bash
cd apps/api
go run cmd/server/main.go
```

Expected output:
```
API server running on :8080
```

## Step 6: Test API (In New Terminal)

```bash
# Test health check
curl http://localhost:8080/v1/health

# Test login with admin
curl -X POST http://localhost:8080/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@hasnahena.local","password":"Admin@12345"}'

# You should get a JWT token back!
```

## Step 7: Start Frontend

```bash
cd apps/web

# Make sure you have .env.local with:
# NEXT_PUBLIC_API_URL=http://localhost:8080

npm run dev
# or
pnpm dev
```

## Step 8: Login and Test!

1. Open http://localhost:3000
2. Login with:
   - **Admin**: `admin@hasnahena.local` / `Admin@12345`
   - **Member**: `member@hasnahena.local` / `Member@12345`
   - **Staff**: `staff@hasnahena.local` / `Staff@12345`

3. Test these features:
   - ✅ Member dashboard (shows real balance, transactions, loans)
   - ✅ Admin dashboard (shows dynamic recovery rate, not 98.5%)
   - ✅ Admin approvals (3 pending registrations, 3 pending loans)
   - ✅ Worker dashboard

---

## 📋 Available API Endpoints

### Auth
- `POST /v1/auth/login` - Login

### Member
- `GET /v1/dashboard/member` - Member dashboard
- `GET /v1/dashboard/member/deposits` - Deposit history
- `GET /v1/dashboard/member/transactions` - All transactions
- `GET /v1/dashboard/member/loans` - Loan history
- `GET /v1/dashboard/member/profile` - Full profile

### Admin
- `GET /v1/dashboard/admin` - Admin dashboard (**recovery rate is now dynamic!**)
- `GET /v1/dashboard/admin/members` - All members
- `GET /v1/dashboard/admin/workers` - All workers
- `GET /v1/dashboard/admin/approvals` - **NEW** Pending approvals
- `POST /v1/dashboard/admin/approvals/registration` - **NEW** Approve registration
- `POST /v1/dashboard/admin/approvals/loan` - **NEW** Approve loan
- `GET /v1/dashboard/admin/deposits` - **NEW** All deposits
- `GET /v1/dashboard/admin/loans` - **NEW** All loans
- `GET /v1/dashboard/admin/loans/detail?id=X` - **NEW** Loan details
- `POST /v1/dashboard/admin/loans/default` - **NEW** Mark loan defaulted
- `GET /v1/dashboard/admin/donations` - **NEW** All donations
- `POST /v1/dashboard/admin/donations` - **NEW** Record donation
- `GET /v1/dashboard/admin/reports/monthly?year=2024&month=1` - **NEW** Monthly report
- `GET /v1/dashboard/admin/reports/yearly?year=2024` - **NEW** Yearly report
- `GET /v1/dashboard/admin/reports/loans` - **NEW** Loan performance
- `GET /v1/dashboard/admin/profile` - **NEW** Admin profile
- `PUT /v1/dashboard/admin/profile` - **NEW** Update profile

### Worker
- `GET /v1/dashboard/worker` - Worker dashboard
- `GET /v1/dashboard/worker/members` - Members list
- `GET /v1/dashboard/worker/requests` - **NEW** Pending requests
- `GET /v1/dashboard/worker/loans` - **NEW** Loans to process
- `GET /v1/dashboard/worker/transactions` - **NEW** Transaction history
- `GET /v1/dashboard/worker/profile` - **NEW** Worker profile
- `POST /v1/dashboard/worker/deposit` - **NEW** Process deposit

---

## 🔧 Troubleshooting

### "Failed to fetch" Error

**Cause**: Backend not running or CORS issue

**Fix**:
1. Make sure API is running on port 8080
2. Check `apps/api/.env` has correct `CORS_ORIGINS=http://localhost:3000`
3. Check frontend `.env.local` has `NEXT_PUBLIC_API_URL=http://localhost:8080`

### "Connection refused" to Database

**Cause**: PostgreSQL not running or wrong credentials

**Fix**:
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Start it if needed
sudo systemctl start postgresql

# Update DATABASE_URL in apps/api/.env with correct password
```

### Seed Script Fails

**Cause**: Prisma migrations not run or database doesn't exist

**Fix**:
```bash
cd apps/web
npx prisma migrate dev
```

---

## 📊 Test Data Overview

After seeding, you'll have:

### Users (17 total)
- 3 **system users** (admin, member, staff) - your login accounts
- 10 **ACTIVE members** with balances
- 3 **PENDING members** waiting for approval
- 1 **SUSPENDED member**

### Loans (6 total)
- 1 **ACTIVE** loan (LN-001) - ৳50,000 principal, ৳40,000 remaining
- 1 **COMPLETED** loan (LN-002) - fully paid
- 1 **DEFAULTED** loan (LN-006) - for testing recovery
- 3 **PENDING** loans (LN-003, LN-004, LN-005) - waiting for admin approval

### Transactions
- **Deposits**: Multiple deposit transactions for each member
- **Repayments**: 2 repayment transactions for the active loan
- **Donations**: 6 donation transactions totaling ৳26,50,000 (charity fund)

### Financial Summary
- **Total Deposits**: ~৳2.5 crore
- **Active Loans**: ৳40,000 remaining
- **Charity Fund**: ৳26,50,000
- **Recovery Rate**: Calculated dynamically (not hardcoded!)

---

## ✨ What's Working Now

### Backend (100% Complete)
- ✅ Real PostgreSQL database everywhere
- ✅ No mock/dummy data in production code
- ✅ 25+ repository methods
- ✅ 25+ API endpoints
- ✅ Dynamic recovery rate calculation
- ✅ Waterfall default recovery system
- ✅ Bengali language support
- ✅ Comprehensive seed data

### Frontend (Needs Integration)
- ✅ 10 pages already using real API
- ❌ 11 pages still have mock data (need to replace with API calls)

---

## 🎯 Next Steps

The backend is **complete**! The remaining work is frontend integration:

1. Update admin approval pages to use `/v1/dashboard/admin/approvals`
2. Update admin loans page to fetch from `/v1/dashboard/admin/loans`
3. Update admin deposits page to use `/v1/dashboard/admin/deposits`
4. Update admin donations page
5. Update admin reports pages
6. Update worker pages to use worker endpoints
7. Remove hardcoded 98.5% recovery rate from frontend

Each page follows the same pattern:
```typescript
// Replace mock data with:
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const loadData = async () => {
    try {
      const response = await apiGet('/v1/dashboard/endpoint');
      setData(response);
    } catch (error) {
      console.error('Failed:', error);
    } finally {
      setLoading(false);
    }
  };
  loadData();
}, []);
```

---

## 🐛 Known Issues & Solutions

### Issue: Recovery rate shows 98.5% hardcoded
**Status**: ✅ **FIXED** in backend `GetAdminDashboard`
**Action**: Remove hardcoded value from frontend admin dashboard

### Issue: Frontend shows mock approval data
**Status**: Backend ready, frontend needs update
**Action**: Replace mock arrays with `apiGet('/v1/dashboard/admin/approvals')`

---

## 📝 Environment Variables Checklist

### apps/api/.env
```bash
✅ PORT=8080
✅ DATABASE_URL=postgresql://... (correct password!)
✅ JWT_SECRET=your-secret-key-32-chars
✅ JWT_EXPIRY=86400
✅ CORS_ORIGINS=http://localhost:3000
```

### apps/web/.env.local
```bash
✅ NEXT_PUBLIC_API_URL=http://localhost:8080
✅ DATABASE_URL=postgresql://... (for Prisma)
```

---

## 🎉 Success Indicators

You'll know everything is working when:

1. ✅ API starts without errors on port 8080
2. ✅ You can login with all 3 test accounts
3. ✅ Member dashboard shows real balance (৳25,000)
4. ✅ Admin dashboard shows dynamic recovery rate (not 98.5%)
5. ✅ Admin approvals page shows 3 pending registrations and 3 pending loans
6. ✅ All balances are in BDT (divided by 100 from paisa)
7. ✅ Bengali descriptions display correctly

---

**Need help?** Check the logs:
- API logs show in terminal where you ran `go run cmd/server/main.go`
- Browser console shows frontend errors
- Check Network tab in browser DevTools to see API calls
