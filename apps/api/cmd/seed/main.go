package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	reset := flag.Bool("reset", false, "truncate application tables before seeding")
	checkEnv := flag.Bool("check-env", false, "validate environment loading and exit")
	flag.Parse()

	if err := loadSeedEnvironment(); err != nil {
		log.Fatalf("Failed to load environment: %v", err)
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	if *checkEnv {
		log.Println("Environment check successful: DATABASE_URL is set")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	log.Println("Connected to database, starting seed...")

	if *reset || strings.EqualFold(os.Getenv("SEED_RESET"), "true") {
		log.Println("Reset flag enabled, truncating existing application data...")
		if err := resetData(ctx, pool); err != nil {
			log.Fatalf("Reset failed: %v", err)
		}
	}

	if err := seedData(ctx, pool); err != nil {
		log.Fatalf("Seed failed: %v", err)
	}

	log.Println("Seed completed successfully!")
}

func hashPassword(password string) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("Failed to hash password: %v", err)
	}
	return string(hash)
}

func loadSeedEnvironment() error {
	// Keep already-exported environment variables as highest priority.
	if os.Getenv("DATABASE_URL") != "" {
		return nil
	}

	wd, err := os.Getwd()
	if err != nil {
		return err
	}

	paths := []string{
		filepath.Join(wd, ".env"),
		filepath.Join(wd, ".env.local"),
		filepath.Join(wd, "..", ".env"),
		filepath.Join(wd, "..", ".env.local"),
		filepath.Join(wd, "..", "..", ".env"),
		filepath.Join(wd, "..", "..", ".env.local"),
	}

	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			if err := loadEnvFile(p); err != nil {
				return fmt.Errorf("failed parsing %s: %w", p, err)
			}
		}
	}

	return nil
}

func loadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		// Do not overwrite values that were already set by the shell/process.
		if os.Getenv(key) != "" {
			continue
		}

		raw := strings.TrimSpace(parts[1])
		val := normalizeEnvValue(raw)
		if err := os.Setenv(key, val); err != nil {
			return err
		}
	}

	return scanner.Err()
}

func normalizeEnvValue(raw string) string {
	if raw == "" {
		return raw
	}

	if (strings.HasPrefix(raw, `"`) && strings.HasSuffix(raw, `"`)) ||
		(strings.HasPrefix(raw, `'`) && strings.HasSuffix(raw, `'`)) {
		return raw[1 : len(raw)-1]
	}

	// Support unquoted values with trailing inline comments.
	if idx := strings.Index(raw, " #"); idx >= 0 {
		return strings.TrimSpace(raw[:idx])
	}

	return raw
}

func resetData(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		TRUNCATE TABLE
			notifications,
			transactions,
			loans,
			accounts,
			documents,
			nominees,
			addresses,
			users,
			branches,
			system_config,
			audit_logs
		RESTART IDENTITY CASCADE;
	`)
	if err != nil {
		return fmt.Errorf("failed to truncate seed tables: %w", err)
	}

	log.Println("Database reset completed")
	return nil
}

func seedData(ctx context.Context, pool *pgxpool.Pool) error {
	// Generate password hashes
	memberPassword := hashPassword("Member@12345")
	adminPassword := hashPassword("Admin@12345")
	staffPassword := hashPassword("Staff@12345")

	// Generate unique IDs
	now := time.Now()
	memberID := fmt.Sprintf("seed_member_%d", now.UnixNano())
	adminID := fmt.Sprintf("seed_admin_%d", now.UnixNano()+1)
	staffID := fmt.Sprintf("seed_staff_%d", now.UnixNano()+2)

	memberAccountID := fmt.Sprintf("seed_acc_member_%d", now.UnixNano())
	adminAccountID := fmt.Sprintf("seed_acc_admin_%d", now.UnixNano()+1)
	staffAccountID := fmt.Sprintf("seed_acc_staff_%d", now.UnixNano()+2)

	memberAddrID := fmt.Sprintf("seed_addr_member_%d", now.UnixNano())
	adminAddrID := fmt.Sprintf("seed_addr_admin_%d", now.UnixNano()+1)
	staffAddrID := fmt.Sprintf("seed_addr_staff_%d", now.UnixNano()+2)

	// Begin transaction
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check if seed users already exist
	var existingCount int
	err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE email IN ($1, $2, $3)`,
		"member@hasnahena.local", "admin@hasnahena.local", "staff@hasnahena.local").Scan(&existingCount)
	if err != nil {
		return fmt.Errorf("failed to check existing users: %w", err)
	}

	if existingCount > 0 {
		log.Println("Seed users already exist, updating passwords...")
		// Update existing users' passwords
		_, err = tx.Exec(ctx, `UPDATE users SET "passwordHash" = $1 WHERE email = $2`, memberPassword, "member@hasnahena.local")
		if err != nil {
			return fmt.Errorf("failed to update member password: %w", err)
		}
		_, err = tx.Exec(ctx, `UPDATE users SET "passwordHash" = $1 WHERE email = $2`, adminPassword, "admin@hasnahena.local")
		if err != nil {
			return fmt.Errorf("failed to update admin password: %w", err)
		}
		_, err = tx.Exec(ctx, `UPDATE users SET "passwordHash" = $1 WHERE email = $2`, staffPassword, "staff@hasnahena.local")
		if err != nil {
			return fmt.Errorf("failed to update staff password: %w", err)
		}
		return tx.Commit(ctx)
	}

	log.Println("Creating seed users...")

	// Create addresses for users
	_, err = tx.Exec(ctx, `
		INSERT INTO addresses (id, "houseNo", village, "union", "policeStation", district, country)
		VALUES
			($1, '১২৩', 'গুলশান', 'গুলশান ইউনিয়ন', 'গুলশান', 'ঢাকা', 'বাংলাদেশ'),
			($2, '৪৫৬', 'বনানী', 'বনানী ইউনিয়ন', 'গুলশান', 'ঢাকা', 'বাংলাদেশ'),
			($3, '৭৮৯', 'উত্তরা', 'উত্তরা ইউনিয়ন', 'উত্তরা', 'ঢাকা', 'বাংলাদেশ')
	`, memberAddrID, adminAddrID, staffAddrID)
	if err != nil {
		return fmt.Errorf("failed to create addresses: %w", err)
	}

	// Create member user
	_, err = tx.Exec(ctx, `
		INSERT INTO users (
			id, email, phone, "passwordHash", role, status,
			"memberId", "nameEn", "nameBn", "fatherName", "motherName",
			gender, "dateOfBirth", "maritalStatus", "nidNumber",
			"createdAt", "updatedAt"
		) VALUES (
			$1, 'member@hasnahena.local', '01712345678', $2, 'MEMBER', 'ACTIVE',
			'HN-M-001', 'Demo Member', 'ডেমো সদস্য', 'John Doe', 'Jane Doe',
			'MALE', '1990-01-15', 'MARRIED', '1234567890123',
			NOW(), NOW()
		)
	`, memberID, memberPassword)
	if err != nil {
		return fmt.Errorf("failed to create member user: %w", err)
	}

	// Create admin user
	_, err = tx.Exec(ctx, `
		INSERT INTO users (
			id, email, phone, "passwordHash", role, status,
			"memberId", "nameEn", "nameBn", "fatherName", "motherName",
			gender, "dateOfBirth", "maritalStatus", "nidNumber",
			"createdAt", "updatedAt"
		) VALUES (
			$1, 'admin@hasnahena.local', '01812345678', $2, 'ADMIN', 'ACTIVE',
			'HN-A-001', 'Demo Admin', 'ডেমো অ্যাডমিন', 'Admin Father', 'Admin Mother',
			'MALE', '1985-05-20', 'MARRIED', '9876543210987',
			NOW(), NOW()
		)
	`, adminID, adminPassword)
	if err != nil {
		return fmt.Errorf("failed to create admin user: %w", err)
	}

	// Create staff/worker user
	_, err = tx.Exec(ctx, `
		INSERT INTO users (
			id, email, phone, "passwordHash", role, status,
			"memberId", "nameEn", "nameBn", "fatherName", "motherName",
			gender, "dateOfBirth", "maritalStatus", "nidNumber",
			"assignedBranch", "createdAt", "updatedAt"
		) VALUES (
			$1, 'staff@hasnahena.local', '01912345678', $2, 'WORKER', 'ACTIVE',
			'HN-W-001', 'Demo Staff', 'ডেমো কর্মী', 'Staff Father', 'Staff Mother',
			'FEMALE', '1992-08-10', 'UNMARRIED', '5678901234567',
			'Dhaka Branch', NOW(), NOW()
		)
	`, staffID, staffPassword)
	if err != nil {
		return fmt.Errorf("failed to create staff user: %w", err)
	}

	// Link addresses to users
	_, err = tx.Exec(ctx, `UPDATE addresses SET "userPermanentId" = $1 WHERE id = $2`, memberID, memberAddrID)
	if err != nil {
		return fmt.Errorf("failed to link member address: %w", err)
	}
	_, err = tx.Exec(ctx, `UPDATE addresses SET "userPermanentId" = $1 WHERE id = $2`, adminID, adminAddrID)
	if err != nil {
		return fmt.Errorf("failed to link admin address: %w", err)
	}
	_, err = tx.Exec(ctx, `UPDATE addresses SET "userPermanentId" = $1 WHERE id = $2`, staffID, staffAddrID)
	if err != nil {
		return fmt.Errorf("failed to link staff address: %w", err)
	}

	// Create accounts for users
	_, err = tx.Exec(ctx, `
		INSERT INTO accounts (id, "accountNumber", "savingsBalance", "loanBalance", "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
		VALUES
			($1, 'HN-ACC-001', 2500000, 0, true, 12500000, NOW(), NOW(), $4),
			($2, 'HN-ACC-002', 500000, 0, true, 2500000, NOW(), NOW(), $5),
			($3, 'HN-ACC-003', 150000, 0, false, 0, NOW(), NOW(), $6)
	`, memberAccountID, adminAccountID, staffAccountID, memberID, adminID, staffID)
	if err != nil {
		return fmt.Errorf("failed to create accounts: %w", err)
	}

	// Create nominees for member
	nomineeID := fmt.Sprintf("seed_nominee_%d", now.UnixNano())
	_, err = tx.Exec(ctx, `
		INSERT INTO nominees (id, name, relationship, "nidNumber", phone, "userId")
		VALUES ($1, 'নমিনী নাম', 'স্বামী', '1111222233334444', '01611111111', $2)
	`, nomineeID, memberID)
	if err != nil {
		return fmt.Errorf("failed to create nominee: %w", err)
	}

	// Create sample transactions for member
	txnIDs := []string{
		fmt.Sprintf("seed_txn_%d", now.UnixNano()),
		fmt.Sprintf("seed_txn_%d", now.UnixNano()+1),
		fmt.Sprintf("seed_txn_%d", now.UnixNano()+2),
		fmt.Sprintf("seed_txn_%d", now.UnixNano()+3),
		fmt.Sprintf("seed_txn_%d", now.UnixNano()+4),
	}

	// Deposits
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, type, amount, "receiptNumber", description, "savingsAfter", "createdAt", "accountId", "userId", "processedBy")
		VALUES
			($1, 'DEPOSIT', 1000000, 'RCP-001', 'প্রথম জমা', 1000000, NOW() - INTERVAL '30 days', $6, $7, $8),
			($2, 'DEPOSIT', 500000, 'RCP-002', 'দ্বিতীয় জমা', 1500000, NOW() - INTERVAL '20 days', $6, $7, $8),
			($3, 'DEPOSIT', 500000, 'RCP-003', 'তৃতীয় জমা', 2000000, NOW() - INTERVAL '10 days', $6, $7, $8),
			($4, 'DEPOSIT', 300000, 'RCP-004', 'চতুর্থ জমা', 2300000, NOW() - INTERVAL '5 days', $6, $7, $8),
			($5, 'DEPOSIT', 200000, 'RCP-005', 'পঞ্চম জমা', 2500000, NOW() - INTERVAL '1 day', $6, $7, $8)
	`, txnIDs[0], txnIDs[1], txnIDs[2], txnIDs[3], txnIDs[4], memberAccountID, memberID, staffID)
	if err != nil {
		return fmt.Errorf("failed to create transactions: %w", err)
	}

	// Create a sample active loan for member
	loanID := fmt.Sprintf("seed_loan_%d", now.UnixNano())
	_, err = tx.Exec(ctx, `
		INSERT INTO loans (
			id, "loanNumber", "principalAmount", "remainingAmount",
			"totalInstallments", "installmentAmount", "paidInstallments",
			"disbursementDate", "installmentStartDate", "expectedEndDate",
			purpose, status, "createdAt", "updatedAt", "accountId", "borrowerId", "guarantorId"
		) VALUES (
			$1, 'LN-001', 5000000, 4000000,
			12, 416667, 2,
			NOW() - INTERVAL '60 days', NOW() - INTERVAL '30 days', NOW() + INTERVAL '300 days',
			'ব্যবসা সম্প্রসারণ', 'ACTIVE', NOW() - INTERVAL '65 days', NOW(), $2, $3, $4
		)
	`, loanID, memberAccountID, memberID, adminID)
	if err != nil {
		return fmt.Errorf("failed to create loan: %w", err)
	}

	// Create loan repayment transactions
	repayTxnIDs := []string{
		fmt.Sprintf("seed_repay_%d", now.UnixNano()),
		fmt.Sprintf("seed_repay_%d", now.UnixNano()+1),
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, type, amount, "receiptNumber", description, "loanAfter", "createdAt", "accountId", "userId", "loanId", "processedBy")
		VALUES
			($1, 'LOAN_REPAYMENT', 500000, 'LR-001', 'প্রথম কিস্তি', 4500000, NOW() - INTERVAL '25 days', $3, $4, $5, $6),
			($2, 'LOAN_REPAYMENT', 500000, 'LR-002', 'দ্বিতীয় কিস্তি', 4000000, NOW() - INTERVAL '10 days', $3, $4, $5, $6)
	`, repayTxnIDs[0], repayTxnIDs[1], memberAccountID, memberID, loanID, staffID)
	if err != nil {
		return fmt.Errorf("failed to create loan repayment transactions: %w", err)
	}

	// Create additional sample members for testing
	sampleMembers := []struct {
		id       string
		email    string
		phone    string
		name     string
		nameBn   string
		memberId string
		status   string
	}{
		{fmt.Sprintf("seed_member2_%d", now.UnixNano()), "karim@example.com", "01711111111", "Abdul Karim", "আব্দুল করিম", "HN-M-002", "ACTIVE"},
		{fmt.Sprintf("seed_member3_%d", now.UnixNano()), "rahim@example.com", "01722222222", "Abdul Rahim", "আব্দুল রহিম", "HN-M-003", "ACTIVE"},
		{fmt.Sprintf("seed_member4_%d", now.UnixNano()), "fatima@example.com", "01733333333", "Fatima Begum", "ফাতিমা বেগম", "HN-M-004", "PENDING"},
		{fmt.Sprintf("seed_member5_%d", now.UnixNano()), "salma@example.com", "01744444444", "Salma Khatun", "সালমা খাতুন", "HN-M-005", "ACTIVE"},
		{fmt.Sprintf("seed_member6_%d", now.UnixNano()), "hasan@example.com", "01755555555", "Md. Hasan", "মোঃ হাসান", "HN-M-006", "SUSPENDED"},
	}

	for _, m := range sampleMembers {
		_, err = tx.Exec(ctx, `
			INSERT INTO users (
				id, email, phone, "passwordHash", role, status,
				"memberId", "nameEn", "nameBn", "fatherName", "motherName",
				gender, "dateOfBirth", "maritalStatus", "nidNumber",
				"createdAt", "updatedAt"
			) VALUES (
				$1, $2, $3, $4, 'MEMBER', $5,
				$6, $7, $8, 'পিতার নাম', 'মাতার নাম',
				'MALE', '1990-01-01', 'MARRIED', $9,
				NOW() - INTERVAL '90 days', NOW()
			)
		`, m.id, m.email, m.phone, memberPassword, m.status, m.memberId, m.name, m.nameBn, fmt.Sprintf("%d", now.UnixNano()))
		if err != nil {
			return fmt.Errorf("failed to create sample member %s: %w", m.name, err)
		}

		// Create account for each member
		accID := fmt.Sprintf("seed_acc_%s", m.id)
		balance := int64(500000 + (now.UnixNano() % 2000000))
		_, err = tx.Exec(ctx, `
			INSERT INTO accounts (id, "accountNumber", "savingsBalance", "loanBalance", "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
			VALUES ($1, $2, $3, 0, true, $4, NOW(), NOW(), $5)
		`, accID, fmt.Sprintf("HN-ACC-%s", m.memberId), balance, balance*5, m.id)
		if err != nil {
			return fmt.Errorf("failed to create account for %s: %w", m.name, err)
		}

		// Create address for each member
		addrID := fmt.Sprintf("seed_addr_%s", m.id)
		_, err = tx.Exec(ctx, `
			INSERT INTO addresses (id, "houseNo", village, "union", "policeStation", district, country, "userPermanentId")
			VALUES ($1, '১০০', 'গ্রাম', 'ইউনিয়ন', 'থানা', 'ঢাকা', 'বাংলাদেশ', $2)
		`, addrID, m.id)
		if err != nil {
			return fmt.Errorf("failed to create address for %s: %w", m.name, err)
		}

		// Create a deposit transaction for each member
		txID := fmt.Sprintf("seed_txn_%s", m.id)
		_, err = tx.Exec(ctx, `
			INSERT INTO transactions (id, type, amount, "receiptNumber", description, "savingsAfter", "createdAt", "accountId", "userId", "processedBy")
			VALUES ($1, 'DEPOSIT', $2, $3, 'জমা', $2, NOW() - INTERVAL '30 days', $4, $5, $6)
		`, txID, balance, fmt.Sprintf("RCP-%s", m.memberId), accID, m.id, staffID)
		if err != nil {
			return fmt.Errorf("failed to create transaction for %s: %w", m.name, err)
		}
	}

	// Create a completed loan for testing recovery rate
	completedLoanID := fmt.Sprintf("seed_completed_loan_%d", now.UnixNano())
	_, err = tx.Exec(ctx, `
		INSERT INTO loans (
			id, "loanNumber", "principalAmount", "remainingAmount",
			"totalInstallments", "installmentAmount", "paidInstallments",
			"disbursementDate", "expectedEndDate", "completedAt",
			purpose, status, "createdAt", "updatedAt", "accountId", "borrowerId"
		) VALUES (
			$1, 'LN-002', 2000000, 0,
			10, 200000, 10,
			NOW() - INTERVAL '365 days', NOW() - INTERVAL '65 days', NOW() - INTERVAL '65 days',
			'শিক্ষা', 'COMPLETED', NOW() - INTERVAL '370 days', NOW() - INTERVAL '65 days', $2, $3
		)
	`, completedLoanID, memberAccountID, memberID)
	if err != nil {
		return fmt.Errorf("failed to create completed loan: %w", err)
	}

	// Add more pending registrations for approval testing
	pendingUsers := []struct {
		id       string
		email    string
		phone    string
		name     string
		nameBn   string
		memberId string
	}{
		{fmt.Sprintf("seed_pending1_%d", now.UnixNano()), "nasir@example.com", "01766666666", "Nasir Ahmed", "নাসির আহমেদ", "HN-M-007"},
		{fmt.Sprintf("seed_pending2_%d", now.UnixNano()+1), "rupa@example.com", "01777777777", "Rupa Khatun", "রূপা খাতুন", "HN-M-008"},
		{fmt.Sprintf("seed_pending3_%d", now.UnixNano()+2), "kamal@example.com", "01788888888", "Kamal Hossain", "কামাল হোসেন", "HN-M-009"},
	}

	for _, u := range pendingUsers {
		_, err = tx.Exec(ctx, `
			INSERT INTO users (
				id, email, phone, "passwordHash", role, status,
				"memberId", "nameEn", "nameBn", "fatherName", "motherName",
				gender, "dateOfBirth", "maritalStatus", "nidNumber",
				"createdAt", "updatedAt"
			) VALUES (
				$1, $2, $3, $4, 'MEMBER', 'PENDING',
				$5, $6, $7, 'পিতার নাম', 'মাতার নাম',
				'MALE', '1988-03-15', 'MARRIED', $8,
				NOW() - INTERVAL '5 days', NOW()
			)
		`, u.id, u.email, u.phone, memberPassword, u.memberId, u.name, u.nameBn, fmt.Sprintf("%d", now.UnixNano()+1))
		if err != nil {
			return fmt.Errorf("failed to create pending user %s: %w", u.name, err)
		}

		// Create address for pending user
		addrID := fmt.Sprintf("seed_addr_%s", u.id)
		_, err = tx.Exec(ctx, `
			INSERT INTO addresses (id, "houseNo", village, "union", "policeStation", district, country, "userPermanentId")
			VALUES ($1, '২০০', 'মিরপুর', 'মিরপুর ইউনিয়ন', 'মিরপুর', 'ঢাকা', 'বাংলাদেশ', $2)
		`, addrID, u.id)
		if err != nil {
			return fmt.Errorf("failed to create address for pending user %s: %w", u.name, err)
		}
	}

	// Add more active members with variety
	moreMembers := []struct {
		id       string
		email    string
		phone    string
		name     string
		nameBn   string
		memberId string
		status   string
		balance  int64
	}{
		{fmt.Sprintf("seed_member7_%d", now.UnixNano()+3), "sultana@example.com", "01799999999", "Sultana Begum", "সুলতানা বেগম", "HN-M-010", "ACTIVE", 3000000},
		{fmt.Sprintf("seed_member8_%d", now.UnixNano()+4), "jahangir@example.com", "01811111111", "Jahangir Alam", "জাহাঙ্গীর আলম", "HN-M-011", "ACTIVE", 1500000},
		{fmt.Sprintf("seed_member9_%d", now.UnixNano()+5), "amina@example.com", "01822222222", "Amina Khatun", "আমিনা খাতুন", "HN-M-012", "ACTIVE", 2200000},
		{fmt.Sprintf("seed_member10_%d", now.UnixNano()+6), "rafiq@example.com", "01833333333", "Rafiqul Islam", "রফিকুল ইসলাম", "HN-M-013", "ACTIVE", 1800000},
		{fmt.Sprintf("seed_member11_%d", now.UnixNano()+7), "shirin@example.com", "01844444444", "Shirin Akter", "শিরিন আক্তার", "HN-M-014", "ACTIVE", 2500000},
	}

	for _, m := range moreMembers {
		_, err = tx.Exec(ctx, `
			INSERT INTO users (
				id, email, phone, "passwordHash", role, status,
				"memberId", "nameEn", "nameBn", "fatherName", "motherName",
				gender, "dateOfBirth", "maritalStatus", "nidNumber",
				"createdAt", "updatedAt", "approvedAt", "approvedBy"
			) VALUES (
				$1, $2, $3, $4, 'MEMBER', $5,
				$6, $7, $8, 'পিতার নাম', 'মাতার নাম',
				'MALE', '1985-06-20', 'MARRIED', $9,
				NOW() - INTERVAL '180 days', NOW(), NOW() - INTERVAL '175 days', $10
			)
		`, m.id, m.email, m.phone, memberPassword, m.status, m.memberId, m.name, m.nameBn, fmt.Sprintf("%d", now.UnixNano()+2), adminID)
		if err != nil {
			return fmt.Errorf("failed to create member %s: %w", m.name, err)
		}

		// Create account
		accID := fmt.Sprintf("seed_acc_%s", m.id)
		_, err = tx.Exec(ctx, `
			INSERT INTO accounts (id, "accountNumber", "savingsBalance", "loanBalance", "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
			VALUES ($1, $2, $3, 0, true, $4, NOW(), NOW(), $5)
		`, accID, fmt.Sprintf("HN-ACC-%s", m.memberId), m.balance, m.balance*5, m.id)
		if err != nil {
			return fmt.Errorf("failed to create account for %s: %w", m.name, err)
		}

		// Create address
		addrID := fmt.Sprintf("seed_addr_%s", m.id)
		_, err = tx.Exec(ctx, `
			INSERT INTO addresses (id, "houseNo", village, "union", "policeStation", district, country, "userPermanentId")
			VALUES ($1, '৩০০', 'ধানমন্ডি', 'ধানমন্ডি ইউনিয়ন', 'ধানমন্ডি', 'ঢাকা', 'বাংলাদেশ', $2)
		`, addrID, m.id)
		if err != nil {
			return fmt.Errorf("failed to create address for %s: %w", m.name, err)
		}

		// Create initial deposit
		txID := fmt.Sprintf("seed_txn_%s", m.id)
		_, err = tx.Exec(ctx, `
			INSERT INTO transactions (id, type, amount, "receiptNumber", description, "savingsAfter", "createdAt", "accountId", "userId", "processedBy")
			VALUES ($1, 'DEPOSIT', $2, $3, 'প্রাথমিক জমা', $2, NOW() - INTERVAL '150 days', $4, $5, $6)
		`, txID, m.balance, fmt.Sprintf("RCP-%s", m.memberId), accID, m.id, staffID)
		if err != nil {
			return fmt.Errorf("failed to create transaction for %s: %w", m.name, err)
		}
	}

	// Get IDs for pending loans (need existing active members)
	sample2ID := sampleMembers[0].id // Abdul Karim
	sample3ID := sampleMembers[1].id // Abdul Rahim
	sample4ID := sampleMembers[3].id // Salma (ACTIVE)

	// Get their account IDs
	sample2AccID := fmt.Sprintf("seed_acc_%s", sample2ID)
	sample3AccID := fmt.Sprintf("seed_acc_%s", sample3ID)
	sample4AccID := fmt.Sprintf("seed_acc_%s", sample4ID)

	// Create pending loan requests
	pendingLoans := []struct {
		id        string
		loanNo    string
		principal int64
		purpose   string
		accountID string
		borrowerID string
		guarantorID string
	}{
		{fmt.Sprintf("seed_loan_pending1_%d", now.UnixNano()+8), "LN-003", 3000000, "কৃষি উন্নয়ন", sample2AccID, sample2ID, memberID},
		{fmt.Sprintf("seed_loan_pending2_%d", now.UnixNano()+9), "LN-004", 2500000, "ব্যবসা শুরু", sample3AccID, sample3ID, memberID},
		{fmt.Sprintf("seed_loan_pending3_%d", now.UnixNano()+10), "LN-005", 4000000, "বাড়ি নির্মাণ", sample4AccID, sample4ID, adminID},
	}

	for _, loan := range pendingLoans {
		_, err = tx.Exec(ctx, `
			INSERT INTO loans (
				id, "loanNumber", "principalAmount", "remainingAmount",
				"totalInstallments", "installmentAmount", "paidInstallments",
				purpose, status, "createdAt", "updatedAt", "accountId", "borrowerId", "guarantorId"
			) VALUES (
				$1, $2, $3, $3,
				12, $4, 0,
				$5, 'PENDING', NOW() - INTERVAL '3 days', NOW(), $6, $7, $8
			)
		`, loan.id, loan.loanNo, loan.principal, loan.principal/12, loan.purpose, loan.accountID, loan.borrowerID, loan.guarantorID)
		if err != nil {
			return fmt.Errorf("failed to create pending loan %s: %w", loan.loanNo, err)
		}
	}

	// Create a defaulted loan for testing recovery
	defaultedLoanID := fmt.Sprintf("seed_defaulted_loan_%d", now.UnixNano()+11)
	member5ID := sampleMembers[4].id // Md. Hasan (SUSPENDED)
	member5AccID := fmt.Sprintf("seed_acc_%s", member5ID)
	_, err = tx.Exec(ctx, `
		INSERT INTO loans (
			id, "loanNumber", "principalAmount", "remainingAmount",
			"totalInstallments", "installmentAmount", "paidInstallments",
			"disbursementDate", "installmentStartDate", "expectedEndDate",
			purpose, status, "createdAt", "updatedAt", "accountId", "borrowerId", "guarantorId"
		) VALUES (
			$1, 'LN-006', 3000000, 2500000,
			12, 250000, 2,
			NOW() - INTERVAL '200 days', NOW() - INTERVAL '170 days', NOW() - INTERVAL '20 days',
			'ব্যবসা', 'DEFAULTED', NOW() - INTERVAL '205 days', NOW() - INTERVAL '15 days', $2, $3, $4
		)
	`, defaultedLoanID, member5AccID, member5ID, sample2ID)
	if err != nil {
		return fmt.Errorf("failed to create defaulted loan: %w", err)
	}

	// Create donation transactions
	donationTxnIDs := []string{
		fmt.Sprintf("seed_donation1_%d", now.UnixNano()+12),
		fmt.Sprintf("seed_donation2_%d", now.UnixNano()+13),
		fmt.Sprintf("seed_donation3_%d", now.UnixNano()+14),
		fmt.Sprintf("seed_donation4_%d", now.UnixNano()+15),
		fmt.Sprintf("seed_donation5_%d", now.UnixNano()+16),
		fmt.Sprintf("seed_donation6_%d", now.UnixNano()+17),
	}

	// Create a system account for donations
	donationAccID := fmt.Sprintf("seed_donation_acc_%d", now.UnixNano())
	_, err = tx.Exec(ctx, `
		INSERT INTO accounts (id, "accountNumber", "savingsBalance", "loanBalance", "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
		VALUES ($1, 'HN-ACC-DONATION', 0, 0, false, 0, NOW(), NOW(), $2)
	`, donationAccID, adminID)
	if err != nil {
		return fmt.Errorf("failed to create donation account: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, type, amount, "receiptNumber", description, "savingsAfter", "createdAt", "accountId", "userId", "processedBy")
		VALUES
			($1, 'DONATION', 500000, 'DON-001', 'দাতব্য তহবিলে দান', 500000, NOW() - INTERVAL '90 days', $7, $8, $9),
			($2, 'DONATION', 300000, 'DON-002', 'দাতব্য তহবিলে দান', 800000, NOW() - INTERVAL '70 days', $7, $10, $9),
			($3, 'DONATION', 1000000, 'DON-003', 'দাতব্য তহবিলে দান', 1800000, NOW() - INTERVAL '50 days', $7, $11, $9),
			($4, 'DONATION', 200000, 'DON-004', 'দাতব্য তহবিলে দান', 2000000, NOW() - INTERVAL '30 days', $7, $12, $9),
			($5, 'DONATION', 400000, 'DON-005', 'দাতব্য তহবিলে দান', 2400000, NOW() - INTERVAL '15 days', $7, $8, $9),
			($6, 'DONATION', 250000, 'DON-006', 'দাতব্য তহবিলে দান', 2650000, NOW() - INTERVAL '5 days', $7, $10, $9)
	`, donationTxnIDs[0], donationTxnIDs[1], donationTxnIDs[2], donationTxnIDs[3], donationTxnIDs[4], donationTxnIDs[5],
		donationAccID, memberID, staffID, adminID, sample2ID, sample3ID)
	if err != nil {
		return fmt.Errorf("failed to create donation transactions: %w", err)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("Created seed data:")
	log.Printf("  - Member: member@hasnahena.local / Member@12345")
	log.Printf("  - Admin: admin@hasnahena.local / Admin@12345")
	log.Printf("  - Staff: staff@hasnahena.local / Staff@12345")
	log.Printf("  - 14 total members: 10 ACTIVE, 3 PENDING, 1 SUSPENDED")
	log.Printf("  - 6 loans: 1 ACTIVE, 1 COMPLETED, 1 DEFAULTED, 3 PENDING")
	log.Printf("  - 6 donation transactions (charity fund)")
	log.Printf("  - Multiple deposit and repayment transactions")

	return nil
}
