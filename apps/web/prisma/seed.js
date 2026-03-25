const {
  PrismaClient,
  UserRole,
  UserStatus,
  Gender,
  MaritalStatus,
  TransactionType,
  TransactionStatus,
  LoanStatus,
  NotificationType,
} = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Helper functions
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const daysAfter = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// ============================================================
// SEED FUNCTIONS
// ============================================================

async function seedSystemConfig() {
  console.log('Seeding SystemConfig...');

  const configs = [
    // Currency & Financial
    { key: 'currency', value: 'BDT', description: 'Default currency code' },
    { key: 'loan_multiplier', value: '5', description: 'Maximum loan multiplier based on savings' },
    { key: 'min_savings_for_loan', value: '5000', description: 'Minimum savings required for loan eligibility (in BDT)' },
    { key: 'loan_application_fee', value: '100', description: 'Loan application fee (in BDT)' },
    { key: 'max_loan_term_months', value: '24', description: 'Maximum loan term in months' },

    // Organization Info
    { key: 'org.name', value: 'হাসনাহেনা ফাউন্ডেশন', description: 'Organization name (Bengali)' },
    { key: 'org.nameEn', value: 'Hasnahena Foundation', description: 'Organization name (English)' },
    { key: 'org.email', value: 'info@hasnahenafoundation.com', description: 'Organization email' },
    { key: 'org.phone', value: '+880 1700-000000', description: 'Organization phone' },
    { key: 'org.address', value: 'ঢাকা, বাংলাদেশ', description: 'Organization address' },
    { key: 'org.website', value: 'https://hasnahenafoundation.com', description: 'Organization website' },
    { key: 'org.description', value: 'একটি অলাভজনক সামাজিক কল্যাণ সংগঠন যা আর্থিক সেবা প্রদান করে।', description: 'Organization description' },

    // Landing Page - Hero Section
    { key: 'hero.titleBn', value: 'স্বপ্ন পূরণে আপনার পাশে', description: 'Hero title (Bengali)' },
    { key: 'hero.titleEn', value: 'Together Towards Your Dreams', description: 'Hero title (English)' },
    { key: 'hero.subtitleBn', value: 'আমাদের সাথে যুক্ত হয়ে আপনার আর্থিক ভবিষ্যৎ গড়ুন', description: 'Hero subtitle (Bengali)' },
    { key: 'hero.subtitleEn', value: 'Join us to build your financial future', description: 'Hero subtitle (English)' },

    // Landing Page - Stats
    { key: 'stats.totalMembers', value: '500+', description: 'Total members stat' },
    { key: 'stats.totalSavings', value: '৫০ লক্ষ+', description: 'Total savings stat' },
    { key: 'stats.loansDistributed', value: '২০০+', description: 'Loans distributed stat' },
    { key: 'stats.yearsOfService', value: '১০+', description: 'Years of service stat' },

    // Landing Page - Features
    { key: 'features.savingsTitle', value: 'সঞ্চয় হিসাব', description: 'Savings feature title' },
    { key: 'features.savingsDesc', value: 'নিরাপদ ও লাভজনক সঞ্চয়ের সুযোগ', description: 'Savings feature description' },
    { key: 'features.loansTitle', value: 'সহজ ঋণ', description: 'Loans feature title' },
    { key: 'features.loansDesc', value: 'সুদমুক্ত ঋণ সুবিধা', description: 'Loans feature description' },
    { key: 'features.supportTitle', value: 'সদস্য সেবা', description: 'Support feature title' },
    { key: 'features.supportDesc', value: '২৪/৭ গ্রাহক সেবা', description: 'Support feature description' },

    // Social Links
    { key: 'social.facebook', value: 'https://facebook.com/hasnahenafoundation', description: 'Facebook page URL' },
    { key: 'social.youtube', value: 'https://youtube.com/@hasnahenafoundation', description: 'YouTube channel URL' },
    { key: 'social.whatsapp', value: '+8801700000000', description: 'WhatsApp number' },

    // Contact Info
    { key: 'contact.phone1', value: '+880 1700-000001', description: 'Primary contact phone' },
    { key: 'contact.phone2', value: '+880 1700-000002', description: 'Secondary contact phone' },
    { key: 'contact.email', value: 'contact@hasnahenafoundation.com', description: 'Contact email' },
    { key: 'contact.address', value: 'বাড়ি ১২৩, রোড ৪৫, গুলশান, ঢাকা ১২১২', description: 'Contact address' },

    // App Settings
    { key: 'app.maintenanceMode', value: 'false', description: 'Maintenance mode toggle' },
    { key: 'app.registrationEnabled', value: 'true', description: 'Allow new registrations' },
    { key: 'app.defaultLocale', value: 'bn', description: 'Default locale' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value, description: config.description },
      create: config,
    });
  }

  console.log(`  Created ${configs.length} system configs`);
}

async function seedBranches() {
  console.log('Seeding Branches...');

  const branches = [
    { code: 'DHK-01', name: 'Dhaka Central Branch', address: 'গুলশান, ঢাকা', phone: '880200000001' },
    { code: 'DHK-02', name: 'Mirpur Branch', address: 'মিরপুর, ঢাকা', phone: '880200000002' },
    { code: 'CTG-01', name: 'Chittagong Branch', address: 'চট্টগ্রাম সদর', phone: '880200000003' },
    { code: 'JSR-01', name: 'Jessore Branch', address: 'যশোর সদর', phone: '880200000004' },
  ];

  for (const branch of branches) {
    await prisma.branch.upsert({
      where: { code: branch.code },
      update: { name: branch.name, address: branch.address, phone: branch.phone, isActive: true },
      create: { ...branch, isActive: true },
    });
  }

  console.log(`  Created ${branches.length} branches`);
}

async function seedUsers() {
  console.log('Seeding Users...');

  const users = [
    // Super Admin
    {
      id: 'seed-superadmin-001',
      email: 'superadmin@hasnahena.local',
      phone: '8801700000000',
      plainPassword: 'SuperAdmin@12345',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      memberId: 'HN-SA-001',
      nameEn: 'Super Administrator',
      nameBn: 'সুপার অ্যাডমিন',
      fatherName: 'N/A',
      motherName: 'N/A',
      dateOfBirth: new Date('1980-01-01'),
      nidNumber: '0000000000001',
      approvedAt: daysAgo(730),
    },
    // Admin
    {
      id: 'seed-admin-001',
      email: 'admin@hasnahena.local',
      phone: '8801700000001',
      plainPassword: 'Admin@12345',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      memberId: 'HN-A-001',
      nameEn: 'Demo Admin',
      nameBn: 'ডেমো অ্যাডমিন',
      fatherName: 'Abdul Karim',
      motherName: 'Amena Begum',
      dateOfBirth: new Date('1985-05-20'),
      nidNumber: '9876543210987',
      approvedAt: daysAgo(365),
      approvedBy: 'seed-superadmin-001',
    },
    // Workers
    {
      id: 'seed-staff-001',
      email: 'staff@hasnahena.local',
      phone: '8801700000002',
      plainPassword: 'Staff@12345',
      role: UserRole.WORKER,
      status: UserStatus.ACTIVE,
      memberId: 'HN-W-001',
      nameEn: 'Demo Staff',
      nameBn: 'ডেমো কর্মী',
      fatherName: 'Jalal Uddin',
      motherName: 'Rokeya Begum',
      gender: Gender.FEMALE,
      maritalStatus: MaritalStatus.UNMARRIED,
      dateOfBirth: new Date('1992-08-10'),
      nidNumber: '5678901234567',
      assignedBranch: 'DHK-01',
      approvedAt: daysAgo(300),
      approvedBy: 'seed-admin-001',
    },
    {
      id: 'seed-staff-002',
      email: 'worker2@hasnahena.local',
      phone: '8801700000008',
      plainPassword: 'Worker@12345',
      role: UserRole.WORKER,
      status: UserStatus.ACTIVE,
      memberId: 'HN-W-002',
      nameEn: 'Rahim Uddin',
      nameBn: 'রহিম উদ্দিন',
      fatherName: 'Karim Mia',
      motherName: 'Hasina Begum',
      dateOfBirth: new Date('1988-03-15'),
      nidNumber: '6678901234567',
      assignedBranch: 'DHK-02',
      approvedAt: daysAgo(250),
      approvedBy: 'seed-admin-001',
    },
    // Active Members
    {
      id: 'seed-member-001',
      email: 'member@hasnahena.local',
      phone: '8801700000003',
      plainPassword: 'Member@12345',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      memberId: 'HN-M-001',
      nameEn: 'Demo Member',
      nameBn: 'ডেমো সদস্য',
      fatherName: 'Habib Rahman',
      motherName: 'Salma Khatun',
      dateOfBirth: new Date('1990-01-15'),
      nidNumber: '1234567890123',
      approvedBy: 'seed-admin-001',
      approvedAt: daysAgo(280),
    },
    {
      id: 'seed-member-002',
      email: 'karim@example.com',
      phone: '8801700000004',
      plainPassword: 'Member@12345',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      memberId: 'HN-M-002',
      nameEn: 'Abdul Karim',
      nameBn: 'আব্দুল করিম',
      fatherName: 'Rahim Uddin',
      motherName: 'Momena Begum',
      dateOfBirth: new Date('1991-03-10'),
      nidNumber: '2234567890123',
      approvedBy: 'seed-admin-001',
      approvedAt: daysAgo(240),
    },
    {
      id: 'seed-member-003',
      email: 'rahim@example.com',
      phone: '8801700000005',
      plainPassword: 'Member@12345',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      memberId: 'HN-M-003',
      nameEn: 'Abdul Rahim',
      nameBn: 'আব্দুল রহিম',
      fatherName: 'Karim Uddin',
      motherName: 'Rokeya Begum',
      dateOfBirth: new Date('1989-06-14'),
      nidNumber: '3234567890123',
      approvedBy: 'seed-admin-001',
      approvedAt: daysAgo(220),
    },
    {
      id: 'seed-member-005',
      email: 'salma@example.com',
      phone: '8801700000007',
      plainPassword: 'Member@12345',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      memberId: 'HN-M-005',
      nameEn: 'Salma Khatun',
      nameBn: 'সালমা খাতুন',
      fatherName: 'Mofiz Uddin',
      motherName: 'Nurjahan Begum',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('1988-02-01'),
      nidNumber: '5234567890123',
      approvedBy: 'seed-admin-001',
      approvedAt: daysAgo(200),
    },
    // Pending Member (for approval workflow demo)
    {
      id: 'seed-member-004',
      email: 'fatima@example.com',
      phone: '8801700000006',
      plainPassword: 'Member@12345',
      role: UserRole.MEMBER,
      status: UserStatus.PENDING,
      memberId: 'HN-M-004',
      nameEn: 'Fatima Begum',
      nameBn: 'ফাতিমা বেগম',
      fatherName: 'Jamal Uddin',
      motherName: 'Salma Akter',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('1993-09-05'),
      nidNumber: '4234567890123',
    },
    // Suspended Member (for status management demo)
    {
      id: 'seed-member-006',
      email: 'suspended@example.com',
      phone: '8801700000009',
      plainPassword: 'Member@12345',
      role: UserRole.MEMBER,
      status: UserStatus.SUSPENDED,
      memberId: 'HN-M-006',
      nameEn: 'Suspended User',
      nameBn: 'স্থগিত সদস্য',
      fatherName: 'Test Father',
      motherName: 'Test Mother',
      dateOfBirth: new Date('1995-01-01'),
      nidNumber: '6234567890123',
      approvedBy: 'seed-admin-001',
      approvedAt: daysAgo(150),
    },
  ];

  const seededUsers = [];
  for (const user of users) {
    const passwordHash = await hashPassword(user.plainPassword);
    const { plainPassword, ...userData } = user;

    const created = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        ...userData,
        passwordHash,
      },
      create: {
        ...userData,
        passwordHash,
        formNumber: `FORM-${user.memberId}`,
      },
    });
    seededUsers.push(created);
  }

  console.log(`  Created ${seededUsers.length} users`);
  return seededUsers;
}

async function seedAccounts(users) {
  console.log('Seeding Accounts...');

  const accountData = {
    'seed-superadmin-001': { accountNumber: 'HN-ACC-SA001', savingsBalance: 0n, maxLoanAmount: 0n, isLoanEligible: false },
    'seed-admin-001': { accountNumber: 'HN-ACC-A001', savingsBalance: 500000n, maxLoanAmount: 2500000n },
    'seed-staff-001': { accountNumber: 'HN-ACC-W001', savingsBalance: 150000n, maxLoanAmount: 750000n },
    'seed-staff-002': { accountNumber: 'HN-ACC-W002', savingsBalance: 200000n, maxLoanAmount: 1000000n },
    'seed-member-001': { accountNumber: 'HN-ACC-M001', savingsBalance: 2500000n, maxLoanAmount: 12500000n },
    'seed-member-002': { accountNumber: 'HN-ACC-M002', savingsBalance: 1800000n, maxLoanAmount: 9000000n },
    'seed-member-003': { accountNumber: 'HN-ACC-M003', savingsBalance: 1400000n, maxLoanAmount: 7000000n },
    'seed-member-004': { accountNumber: 'HN-ACC-M004', savingsBalance: 0n, maxLoanAmount: 0n, isLoanEligible: false },
    'seed-member-005': { accountNumber: 'HN-ACC-M005', savingsBalance: 900000n, maxLoanAmount: 4500000n },
    'seed-member-006': { accountNumber: 'HN-ACC-M006', savingsBalance: 300000n, maxLoanAmount: 0n, isLoanEligible: false },
  };

  const accounts = [];
  for (const user of users) {
    const data = accountData[user.id];
    if (data) {
      const account = await prisma.account.upsert({
        where: { accountNumber: data.accountNumber },
        update: {
          userId: user.id,
          savingsBalance: data.savingsBalance,
          loanBalance: 0n,
          isLoanEligible: data.isLoanEligible ?? true,
          maxLoanAmount: data.maxLoanAmount,
        },
        create: {
          id: `acc-${user.id}`,
          accountNumber: data.accountNumber,
          userId: user.id,
          savingsBalance: data.savingsBalance,
          loanBalance: 0n,
          isLoanEligible: data.isLoanEligible ?? true,
          maxLoanAmount: data.maxLoanAmount,
        },
      });
      accounts.push(account);
    }
  }

  // Donation account
  const donationAccount = await prisma.account.upsert({
    where: { accountNumber: 'HN-ACC-DONATION' },
    update: { savingsBalance: 2650000n },
    create: {
      id: 'acc-donation-001',
      accountNumber: 'HN-ACC-DONATION',
      userId: 'seed-admin-001',
      savingsBalance: 2650000n,
      loanBalance: 0n,
      isLoanEligible: false,
      maxLoanAmount: 0n,
    },
  });
  accounts.push(donationAccount);

  console.log(`  Created ${accounts.length} accounts`);
  return accounts;
}

async function seedAddresses(users) {
  console.log('Seeding Addresses...');

  const addressData = [
    ['seed-member-001', '১২৩', 'গুলশান', 'গুলশান ইউনিয়ন', 'গুলশান', 'ঢাকা'],
    ['seed-admin-001', '৪৫৬', 'বনানী', 'বনানী ইউনিয়ন', 'গুলশান', 'ঢাকা'],
    ['seed-staff-001', '৭৮৯', 'উত্তরা', 'উত্তরা ইউনিয়ন', 'উত্তরা', 'ঢাকা'],
    ['seed-member-002', '১০০', 'মিরপুর', 'মিরপুর ইউনিয়ন', 'মিরপুর', 'ঢাকা'],
    ['seed-member-003', '২০০', 'সাভার', 'সাভার ইউনিয়ন', 'সাভার', 'ঢাকা'],
    ['seed-member-004', '৩০০', 'যশোর সদর', 'চাঁচড়া ইউনিয়ন', 'যশোর সদর', 'যশোর'],
    ['seed-member-005', '৪০০', 'কেশবপুর', 'কেশবপুর ইউনিয়ন', 'কেশবপুর', 'যশোর'],
  ];

  for (const [userId, houseNo, village, union, policeStation, district] of addressData) {
    await prisma.address.upsert({
      where: { userPermanentId: userId },
      update: { houseNo, village, union, policeStation, district, country: 'বাংলাদেশ' },
      create: {
        id: `addr-${userId}`,
        houseNo,
        village,
        union,
        policeStation,
        district,
        country: 'বাংলাদেশ',
        userPermanentId: userId,
      },
    });
  }

  console.log(`  Created ${addressData.length} addresses`);
}

async function seedNominees() {
  console.log('Seeding Nominees...');

  const nominees = [
    { userId: 'seed-member-001', name: 'করিম সাহেব', relationship: 'স্বামী', nidNumber: '1111222233334444', phone: '8801611111111' },
    { userId: 'seed-member-002', name: 'রহিমা বেগম', relationship: 'স্ত্রী', nidNumber: '2222333344445555', phone: '8801622222222' },
    { userId: 'seed-member-003', name: 'আব্দুল হক', relationship: 'পিতা', nidNumber: '3333444455556666', phone: '8801633333333' },
    { userId: 'seed-member-005', name: 'জামাল উদ্দিন', relationship: 'ভাই', nidNumber: '5555666677778888', phone: '8801655555555' },
  ];

  for (const nominee of nominees) {
    await prisma.nominee.upsert({
      where: { userId: nominee.userId },
      update: nominee,
      create: {
        id: `nominee-${nominee.userId}`,
        ...nominee,
      },
    });
  }

  console.log(`  Created ${nominees.length} nominees`);
}

async function seedLoans() {
  console.log('Seeding Loans...');

  const loans = [
    // Active loan
    {
      id: 'loan-001',
      loanNumber: 'LN-2024-001',
      principalAmount: 5000000n,
      remainingAmount: 4000000n,
      totalInstallments: 12,
      installmentAmount: 416667n,
      paidInstallments: 2,
      purpose: 'ব্যবসা সম্প্রসারণ',
      status: LoanStatus.ACTIVE,
      accountId: 'acc-seed-member-001',
      borrowerId: 'seed-member-001',
      guarantorId: 'seed-admin-001',
      disbursementDate: daysAgo(60),
      installmentStartDate: daysAgo(30),
      expectedEndDate: daysAfter(300),
      approvedAt: daysAgo(62),
      approvedBy: 'seed-admin-001',
      createdAt: daysAgo(65),
    },
    // Completed loan
    {
      id: 'loan-002',
      loanNumber: 'LN-2023-001',
      principalAmount: 2000000n,
      remainingAmount: 0n,
      totalInstallments: 10,
      installmentAmount: 200000n,
      paidInstallments: 10,
      purpose: 'শিক্ষা',
      status: LoanStatus.COMPLETED,
      accountId: 'acc-seed-member-001',
      borrowerId: 'seed-member-001',
      guarantorId: 'seed-member-002',
      disbursementDate: daysAgo(365),
      installmentStartDate: daysAgo(335),
      expectedEndDate: daysAgo(65),
      approvedAt: daysAgo(370),
      approvedBy: 'seed-admin-001',
      completedAt: daysAgo(65),
      createdAt: daysAgo(370),
    },
    // Pending guarantor approval
    {
      id: 'loan-003',
      loanNumber: 'LN-2024-002',
      principalAmount: 3000000n,
      remainingAmount: 3000000n,
      totalInstallments: 12,
      installmentAmount: 250000n,
      paidInstallments: 0,
      purpose: 'কৃষি উন্নয়ন',
      status: LoanStatus.PENDING_GUARANTOR,
      accountId: 'acc-seed-member-002',
      borrowerId: 'seed-member-002',
      guarantorId: 'seed-member-001',
      createdAt: daysAgo(3),
    },
    // Pending admin approval
    {
      id: 'loan-004',
      loanNumber: 'LN-2024-003',
      principalAmount: 2500000n,
      remainingAmount: 2500000n,
      totalInstallments: 12,
      installmentAmount: 208333n,
      paidInstallments: 0,
      purpose: 'ব্যবসা শুরু',
      status: LoanStatus.PENDING_APPROVAL,
      accountId: 'acc-seed-member-003',
      borrowerId: 'seed-member-003',
      guarantorId: 'seed-member-001',
      createdAt: daysAgo(2),
    },
    // Another active loan
    {
      id: 'loan-005',
      loanNumber: 'LN-2024-004',
      principalAmount: 1500000n,
      remainingAmount: 1000000n,
      totalInstallments: 6,
      installmentAmount: 250000n,
      paidInstallments: 2,
      purpose: 'গৃহ মেরামত',
      status: LoanStatus.ACTIVE,
      accountId: 'acc-seed-member-005',
      borrowerId: 'seed-member-005',
      guarantorId: 'seed-member-002',
      disbursementDate: daysAgo(45),
      installmentStartDate: daysAgo(30),
      expectedEndDate: daysAfter(120),
      approvedAt: daysAgo(47),
      approvedBy: 'seed-admin-001',
      createdAt: daysAgo(50),
    },
  ];

  for (const loan of loans) {
    await prisma.loan.upsert({
      where: { loanNumber: loan.loanNumber },
      update: loan,
      create: loan,
    });
  }

  console.log(`  Created ${loans.length} loans`);
}

async function seedTransactions() {
  console.log('Seeding Transactions...');

  const transactions = [
    // Member 001 deposits
    { id: 'txn-001', type: TransactionType.DEPOSIT, amount: 1000000n, receiptNumber: 'RCP-001', description: 'প্রথম জমা', savingsAfter: 1000000n, accountId: 'acc-seed-member-001', userId: 'seed-member-001', processedBy: 'seed-staff-001', createdAt: daysAgo(30) },
    { id: 'txn-002', type: TransactionType.DEPOSIT, amount: 500000n, receiptNumber: 'RCP-002', description: 'দ্বিতীয় জমা', savingsAfter: 1500000n, accountId: 'acc-seed-member-001', userId: 'seed-member-001', processedBy: 'seed-staff-001', createdAt: daysAgo(20) },
    { id: 'txn-003', type: TransactionType.DEPOSIT, amount: 500000n, receiptNumber: 'RCP-003', description: 'তৃতীয় জমা', savingsAfter: 2000000n, accountId: 'acc-seed-member-001', userId: 'seed-member-001', processedBy: 'seed-staff-001', createdAt: daysAgo(10) },
    { id: 'txn-004', type: TransactionType.DEPOSIT, amount: 300000n, receiptNumber: 'RCP-004', description: 'চতুর্থ জমা', savingsAfter: 2300000n, accountId: 'acc-seed-member-001', userId: 'seed-member-001', processedBy: 'seed-staff-001', createdAt: daysAgo(5) },
    { id: 'txn-005', type: TransactionType.DEPOSIT, amount: 200000n, receiptNumber: 'RCP-005', description: 'পঞ্চম জমা', savingsAfter: 2500000n, accountId: 'acc-seed-member-001', userId: 'seed-member-001', processedBy: 'seed-staff-001', createdAt: daysAgo(1) },

    // Loan repayments
    { id: 'txn-006', type: TransactionType.LOAN_REPAYMENT, amount: 500000n, receiptNumber: 'LR-001', description: 'প্রথম কিস্তি', loanAfter: 4500000n, accountId: 'acc-seed-member-001', userId: 'seed-member-001', loanId: 'loan-001', processedBy: 'seed-staff-001', createdAt: daysAgo(25) },
    { id: 'txn-007', type: TransactionType.LOAN_REPAYMENT, amount: 500000n, receiptNumber: 'LR-002', description: 'দ্বিতীয় কিস্তি', loanAfter: 4000000n, accountId: 'acc-seed-member-001', userId: 'seed-member-001', loanId: 'loan-001', processedBy: 'seed-staff-001', createdAt: daysAgo(10) },

    // Member 002 deposits
    { id: 'txn-008', type: TransactionType.DEPOSIT, amount: 800000n, receiptNumber: 'RCP-006', description: 'প্রথম জমা', savingsAfter: 800000n, accountId: 'acc-seed-member-002', userId: 'seed-member-002', processedBy: 'seed-staff-001', createdAt: daysAgo(60) },
    { id: 'txn-009', type: TransactionType.DEPOSIT, amount: 500000n, receiptNumber: 'RCP-007', description: 'দ্বিতীয় জমা', savingsAfter: 1300000n, accountId: 'acc-seed-member-002', userId: 'seed-member-002', processedBy: 'seed-staff-001', createdAt: daysAgo(40) },
    { id: 'txn-010', type: TransactionType.DEPOSIT, amount: 500000n, receiptNumber: 'RCP-008', description: 'তৃতীয় জমা', savingsAfter: 1800000n, accountId: 'acc-seed-member-002', userId: 'seed-member-002', processedBy: 'seed-staff-001', createdAt: daysAgo(15) },

    // Donations
    { id: 'txn-011', type: TransactionType.DONATION, amount: 500000n, receiptNumber: 'DON-001', description: 'দাতব্য তহবিলে দান', savingsAfter: 500000n, accountId: 'acc-donation-001', userId: 'seed-member-001', processedBy: 'seed-staff-001', createdAt: daysAgo(90) },
    { id: 'txn-012', type: TransactionType.DONATION, amount: 300000n, receiptNumber: 'DON-002', description: 'দাতব্য তহবিলে দান', savingsAfter: 800000n, accountId: 'acc-donation-001', userId: 'seed-staff-001', processedBy: 'seed-staff-001', createdAt: daysAgo(70) },
    { id: 'txn-013', type: TransactionType.DONATION, amount: 1000000n, receiptNumber: 'DON-003', description: 'দাতব্য তহবিলে দান', savingsAfter: 1800000n, accountId: 'acc-donation-001', userId: 'seed-admin-001', processedBy: 'seed-staff-001', createdAt: daysAgo(50) },
    { id: 'txn-014', type: TransactionType.DONATION, amount: 200000n, receiptNumber: 'DON-004', description: 'দাতব্য তহবিলে দান', savingsAfter: 2000000n, accountId: 'acc-donation-001', userId: 'seed-member-002', processedBy: 'seed-staff-001', createdAt: daysAgo(30) },
    { id: 'txn-015', type: TransactionType.DONATION, amount: 400000n, receiptNumber: 'DON-005', description: 'দাতব্য তহবিলে দান', savingsAfter: 2400000n, accountId: 'acc-donation-001', userId: 'seed-member-001', processedBy: 'seed-staff-001', createdAt: daysAgo(15) },
    { id: 'txn-016', type: TransactionType.DONATION, amount: 250000n, receiptNumber: 'DON-006', description: 'দাতব্য তহবিলে দান', savingsAfter: 2650000n, accountId: 'acc-donation-001', userId: 'seed-staff-001', processedBy: 'seed-staff-001', createdAt: daysAgo(5) },

    // Withdrawal request (pending)
    { id: 'txn-017', type: TransactionType.WITHDRAWAL, amount: 100000n, receiptNumber: null, description: 'জরুরী প্রয়োজন', savingsAfter: null, accountId: 'acc-seed-member-003', userId: 'seed-member-003', processedBy: null, createdAt: daysAgo(1), status: TransactionStatus.PENDING },
  ];

  for (const txn of transactions) {
    const status = txn.status || TransactionStatus.CONFIRMED;
    const { status: _, ...txnData } = txn;

    await prisma.transaction.upsert({
      where: { id: txn.id },
      update: {
        ...txnData,
        status,
        processedAt: status === TransactionStatus.CONFIRMED ? txn.createdAt : null,
        confirmedAt: status === TransactionStatus.CONFIRMED ? txn.createdAt : null,
      },
      create: {
        ...txnData,
        status,
        processedAt: status === TransactionStatus.CONFIRMED ? txn.createdAt : null,
        confirmedAt: status === TransactionStatus.CONFIRMED ? txn.createdAt : null,
      },
    });
  }

  console.log(`  Created ${transactions.length} transactions`);
}

async function seedNotifications() {
  console.log('Seeding Notifications...');

  const notifications = [
    // Admin notifications
    { type: NotificationType.NEW_REGISTRATION, title: 'নতুন সদস্য নিবন্ধন', message: 'ফাতিমা বেগম নিবন্ধন করেছেন। অনুমোদন প্রয়োজন।', targetRole: UserRole.ADMIN, createdAt: daysAgo(1) },
    { type: NotificationType.LOAN_REQUEST, title: 'নতুন ঋণ আবেদন', message: 'আব্দুল রহিম ২৫,০০০ টাকা ঋণের জন্য আবেদন করেছেন।', targetRole: UserRole.ADMIN, createdAt: daysAgo(2) },
    { type: NotificationType.WITHDRAWAL_REQUEST, title: 'উত্তোলন অনুরোধ', message: 'আব্দুল রহিম ১,০০০ টাকা উত্তোলন করতে চান।', targetRole: UserRole.ADMIN, createdAt: daysAgo(1) },
    { type: NotificationType.SYSTEM_ALERT, title: 'সিস্টেম আপডেট', message: 'নতুন সংস্করণ রিলিজ হয়েছে।', targetRole: UserRole.ADMIN, isRead: true, readAt: daysAgo(3), createdAt: daysAgo(5) },

    // Member notifications
    { type: NotificationType.DEPOSIT_CONFIRMED, title: 'জমা নিশ্চিত', message: 'আপনার ২,০০০ টাকা জমা সফলভাবে সম্পন্ন হয়েছে।', targetUserId: 'seed-member-001', createdAt: daysAgo(1) },
    { type: NotificationType.LOAN_APPROVED, title: 'ঋণ অনুমোদিত', message: 'আপনার ৫০,০০০ টাকার ঋণ অনুমোদিত হয়েছে।', targetUserId: 'seed-member-001', isRead: true, readAt: daysAgo(60), createdAt: daysAgo(62) },
    { type: NotificationType.ACCOUNT_ACTIVATED, title: 'অ্যাকাউন্ট সক্রিয়', message: 'আপনার অ্যাকাউন্ট সক্রিয় করা হয়েছে।', targetUserId: 'seed-member-002', isRead: true, readAt: daysAgo(200), createdAt: daysAgo(240) },

    // Worker notifications
    { type: NotificationType.NEW_REGISTRATION, title: 'নতুন সদস্য যাচাই', message: 'নতুন সদস্যের তথ্য যাচাই করুন।', targetRole: UserRole.WORKER, createdAt: daysAgo(1) },
  ];

  for (let i = 0; i < notifications.length; i++) {
    const notif = notifications[i];
    await prisma.notification.create({
      data: {
        id: `notif-${String(i + 1).padStart(3, '0')}`,
        ...notif,
      },
    });
  }

  console.log(`  Created ${notifications.length} notifications`);
}

async function seedGalleryItems() {
  console.log('Seeding Gallery Items...');

  const galleryItems = [
    {
      id: 'gallery-001',
      imageUrl: 'https://res.cloudinary.com/dfxxjgltc/image/upload/v1/hasnahena/gallery/meeting_2024',
      captionEn: 'Annual General Meeting 2024',
      captionBn: 'বার্ষিক সাধারণ সভা ২০২৪',
      date: daysAgo(30),
      likes: 25,
    },
    {
      id: 'gallery-002',
      imageUrl: 'https://res.cloudinary.com/dfxxjgltc/image/upload/v1/hasnahena/gallery/training_program',
      captionEn: 'Member Training Program',
      captionBn: 'সদস্য প্রশিক্ষণ কার্যক্রম',
      date: daysAgo(60),
      likes: 18,
    },
    {
      id: 'gallery-003',
      imageUrl: 'https://res.cloudinary.com/dfxxjgltc/image/upload/v1/hasnahena/gallery/loan_distribution',
      captionEn: 'Loan Distribution Ceremony',
      captionBn: 'ঋণ বিতরণ অনুষ্ঠান',
      date: daysAgo(90),
      likes: 32,
    },
    {
      id: 'gallery-004',
      imageUrl: 'https://res.cloudinary.com/dfxxjgltc/image/upload/v1/hasnahena/gallery/eid_celebration',
      captionEn: 'Eid Celebration with Members',
      captionBn: 'সদস্যদের সাথে ঈদ উদযাপন',
      date: daysAgo(120),
      likes: 45,
    },
    {
      id: 'gallery-005',
      imageUrl: 'https://res.cloudinary.com/dfxxjgltc/image/upload/v1/hasnahena/gallery/office_inauguration',
      captionEn: 'New Branch Office Inauguration',
      captionBn: 'নতুন শাখা অফিস উদ্বোধন',
      date: daysAgo(180),
      likes: 28,
    },
    {
      id: 'gallery-006',
      imageUrl: 'https://res.cloudinary.com/dfxxjgltc/image/upload/v1/hasnahena/gallery/charity_event',
      captionEn: 'Charity Distribution Event',
      captionBn: 'দাতব্য বিতরণ অনুষ্ঠান',
      date: daysAgo(15),
      likes: 56,
    },
  ];

  for (const item of galleryItems) {
    await prisma.galleryItem.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }

  console.log(`  Created ${galleryItems.length} gallery items`);
}

async function seedAuditLogs() {
  console.log('Seeding Audit Logs...');

  const auditLogs = [
    { action: 'USER_LOGIN', entityType: 'User', entityId: 'seed-admin-001', userId: 'seed-admin-001', createdAt: daysAgo(1) },
    { action: 'SETTINGS_UPDATE', entityType: 'SystemConfig', entityId: 'org.name', oldValue: { value: 'Old Name' }, newValue: { value: 'হাসনাহেনা ফাউন্ডেশন' }, userId: 'seed-admin-001', createdAt: daysAgo(5) },
    { action: 'USER_APPROVED', entityType: 'User', entityId: 'seed-member-001', oldValue: { status: 'PENDING' }, newValue: { status: 'ACTIVE' }, userId: 'seed-admin-001', createdAt: daysAgo(280) },
    { action: 'LOAN_APPROVED', entityType: 'Loan', entityId: 'loan-001', oldValue: { status: 'PENDING_APPROVAL' }, newValue: { status: 'ACTIVE' }, userId: 'seed-admin-001', createdAt: daysAgo(62) },
    { action: 'DEPOSIT_PROCESSED', entityType: 'Transaction', entityId: 'txn-001', newValue: { amount: 1000000, status: 'CONFIRMED' }, userId: 'seed-staff-001', createdAt: daysAgo(30) },
  ];

  for (let i = 0; i < auditLogs.length; i++) {
    const log = auditLogs[i];
    await prisma.auditLog.create({
      data: {
        id: `audit-${String(i + 1).padStart(3, '0')}`,
        ...log,
      },
    });
  }

  console.log(`  Created ${auditLogs.length} audit logs`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('');
  console.log('========================================');
  console.log('  Hasnahena Foundation - Database Seed');
  console.log('========================================');
  console.log('');

  // Clear existing data (optional - comment out if you want to preserve data)
  console.log('Clearing existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.galleryItem.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.account.deleteMany();
  await prisma.nominee.deleteMany();
  await prisma.address.deleteMany();
  await prisma.document.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.systemConfig.deleteMany();
  console.log('  Done!\n');

  // Seed data
  await seedSystemConfig();
  await seedBranches();
  const users = await seedUsers();
  await seedAccounts(users);
  await seedAddresses(users);
  await seedNominees();
  await seedLoans();
  await seedTransactions();
  await seedNotifications();
  await seedGalleryItems();
  await seedAuditLogs();

  console.log('');
  console.log('========================================');
  console.log('  Seeding Complete!');
  console.log('========================================');
  console.log('');
  console.log('Login Credentials:');
  console.log('');
  console.log('  Super Admin:');
  console.log('    Email: superadmin@hasnahena.local');
  console.log('    Password: SuperAdmin@12345');
  console.log('');
  console.log('  Admin:');
  console.log('    Email: admin@hasnahena.local');
  console.log('    Password: Admin@12345');
  console.log('');
  console.log('  Worker/Staff:');
  console.log('    Email: staff@hasnahena.local');
  console.log('    Password: Staff@12345');
  console.log('');
  console.log('  Member:');
  console.log('    Email: member@hasnahena.local');
  console.log('    Password: Member@12345');
  console.log('');
}

main()
  .catch((error) => {
    console.error('');
    console.error('========================================');
    console.error('  Seeding Failed!');
    console.error('========================================');
    console.error('');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
