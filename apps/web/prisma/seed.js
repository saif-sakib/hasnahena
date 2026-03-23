const {
  PrismaClient,
  UserRole,
  UserStatus,
  Gender,
  MaritalStatus,
  TransactionType,
  TransactionStatus,
  LoanStatus,
} = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function upsertUser({
  id,
  email,
  phone,
  plainPassword,
  role,
  status,
  memberId,
  nameEn,
  nameBn,
  fatherName,
  motherName,
  gender = Gender.MALE,
  maritalStatus = MaritalStatus.MARRIED,
  dateOfBirth,
  nidNumber,
  assignedBranch,
  approvedBy,
  approvedAt,
}) {
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  return prisma.user.upsert({
    where: { email },
    update: {
      phone,
      passwordHash,
      role,
      status,
      memberId,
      nameEn,
      nameBn,
      fatherName,
      motherName,
      gender,
      maritalStatus,
      dateOfBirth,
      nidNumber,
      assignedBranch,
      approvedBy,
      approvedAt,
    },
    create: {
      id,
      email,
      phone,
      passwordHash,
      role,
      status,
      memberId,
      nameEn,
      nameBn,
      fatherName,
      motherName,
      gender,
      maritalStatus,
      dateOfBirth,
      nidNumber,
      assignedBranch,
      approvedBy,
      approvedAt,
      formNumber: `FORM-${memberId}`,
    },
  });
}

async function upsertAccount({
  id,
  accountNumber,
  userId,
  savingsBalance,
  loanBalance = 0n,
  isLoanEligible = true,
  maxLoanAmount,
}) {
  return prisma.account.upsert({
    where: { accountNumber },
    update: {
      userId,
      savingsBalance,
      loanBalance,
      isLoanEligible,
      maxLoanAmount,
    },
    create: {
      id,
      accountNumber,
      userId,
      savingsBalance,
      loanBalance,
      isLoanEligible,
      maxLoanAmount,
    },
  });
}

async function upsertAddress({
  id,
  userId,
  houseNo,
  village,
  union,
  policeStation,
  district,
}) {
  return prisma.address.upsert({
    where: { userPermanentId: userId },
    update: {
      houseNo,
      village,
      union,
      policeStation,
      district,
      country: 'বাংলাদেশ',
    },
    create: {
      id,
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

async function upsertTransaction({
  id,
  type,
  amount,
  receiptNumber,
  description,
  status = TransactionStatus.CONFIRMED,
  savingsAfter,
  loanAfter,
  accountId,
  userId,
  loanId,
  processedBy,
  createdAt,
}) {
  return prisma.transaction.upsert({
    where: { id },
    update: {
      type,
      amount,
      receiptNumber,
      description,
      status,
      savingsAfter,
      loanAfter,
      accountId,
      userId,
      loanId,
      processedBy,
      createdAt,
      processedAt: createdAt,
      confirmedAt: createdAt,
    },
    create: {
      id,
      type,
      amount,
      receiptNumber,
      description,
      status,
      savingsAfter,
      loanAfter,
      accountId,
      userId,
      loanId,
      processedBy,
      createdAt,
      processedAt: createdAt,
      confirmedAt: createdAt,
    },
  });
}

async function upsertLoan({
  id,
  loanNumber,
  principalAmount,
  remainingAmount,
  totalInstallments,
  installmentAmount,
  paidInstallments,
  purpose,
  status,
  accountId,
  borrowerId,
  guarantorId,
  disbursementDate,
  installmentStartDate,
  expectedEndDate,
  approvedAt,
  approvedBy,
  completedAt,
  createdAt,
}) {
  return prisma.loan.upsert({
    where: { loanNumber },
    update: {
      principalAmount,
      remainingAmount,
      totalInstallments,
      installmentAmount,
      paidInstallments,
      purpose,
      status,
      accountId,
      borrowerId,
      guarantorId,
      disbursementDate,
      installmentStartDate,
      expectedEndDate,
      approvedAt,
      approvedBy,
      completedAt,
      createdAt,
    },
    create: {
      id,
      loanNumber,
      principalAmount,
      remainingAmount,
      totalInstallments,
      installmentAmount,
      paidInstallments,
      purpose,
      status,
      accountId,
      borrowerId,
      guarantorId,
      disbursementDate,
      installmentStartDate,
      expectedEndDate,
      approvedAt,
      approvedBy,
      completedAt,
      createdAt,
    },
  });
}

async function main() {
  const now = new Date();
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysAfter = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  const users = [
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
    },
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
    },
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
  ];

  const seededUsers = [];
  for (const user of users) {
    seededUsers.push(await upsertUser(user));
  }

  await prisma.branch.upsert({
    where: { code: 'DHK-01' },
    update: { name: 'Dhaka Central Branch', address: 'Dhaka', phone: '880200000001', isActive: true },
    create: { code: 'DHK-01', name: 'Dhaka Central Branch', address: 'Dhaka', phone: '880200000001', isActive: true },
  });

  await prisma.systemConfig.upsert({
    where: { key: 'currency' },
    update: { value: 'BDT', description: 'Default currency code' },
    create: { key: 'currency', value: 'BDT', description: 'Default currency code' },
  });
  await prisma.systemConfig.upsert({
    where: { key: 'loan_multiplier' },
    update: { value: '5', description: 'Maximum loan multiplier based on savings balance' },
    create: { key: 'loan_multiplier', value: '5', description: 'Maximum loan multiplier based on savings balance' },
  });

  const accountMap = {
    'seed-member-001': { id: 'seed-acc-member-001', accountNumber: 'HN-ACC-001', savingsBalance: 2500000n, maxLoanAmount: 12500000n },
    'seed-admin-001': { id: 'seed-acc-admin-001', accountNumber: 'HN-ACC-002', savingsBalance: 500000n, maxLoanAmount: 2500000n },
    'seed-staff-001': { id: 'seed-acc-staff-001', accountNumber: 'HN-ACC-003', savingsBalance: 150000n, maxLoanAmount: 750000n },
    'seed-member-002': { id: 'seed-acc-member-002', accountNumber: 'HN-ACC-004', savingsBalance: 1800000n, maxLoanAmount: 9000000n },
    'seed-member-003': { id: 'seed-acc-member-003', accountNumber: 'HN-ACC-005', savingsBalance: 1400000n, maxLoanAmount: 7000000n },
    'seed-member-004': { id: 'seed-acc-member-004', accountNumber: 'HN-ACC-006', savingsBalance: 0n, maxLoanAmount: 0n, isLoanEligible: false },
    'seed-member-005': { id: 'seed-acc-member-005', accountNumber: 'HN-ACC-007', savingsBalance: 900000n, maxLoanAmount: 4500000n },
  };

  for (const user of seededUsers) {
    const acc = accountMap[user.id];
    if (acc) {
      await upsertAccount({
        id: acc.id,
        accountNumber: acc.accountNumber,
        userId: user.id,
        savingsBalance: acc.savingsBalance,
        loanBalance: 0n,
        isLoanEligible: acc.isLoanEligible ?? true,
        maxLoanAmount: acc.maxLoanAmount,
      });
    }
  }

  await upsertAccount({
    id: 'seed-acc-donation-001',
    accountNumber: 'HN-ACC-DONATION',
    userId: 'seed-admin-001',
    savingsBalance: 2650000n,
    loanBalance: 0n,
    isLoanEligible: false,
    maxLoanAmount: 0n,
  });

  const addresses = [
    ['seed-member-001', '১২৩', 'গুলশান', 'গুলশান ইউনিয়ন', 'গুলশান', 'ঢাকা'],
    ['seed-admin-001', '৪৫৬', 'বনানী', 'বনানী ইউনিয়ন', 'গুলশান', 'ঢাকা'],
    ['seed-staff-001', '৭৮৯', 'উত্তরা', 'উত্তরা ইউনিয়ন', 'উত্তরা', 'ঢাকা'],
    ['seed-member-002', '১০০', 'মিরপুর', 'মিরপুর ইউনিয়ন', 'মিরপুর', 'ঢাকা'],
    ['seed-member-003', '২০০', 'সাভার', 'সাভার ইউনিয়ন', 'সাভার', 'ঢাকা'],
    ['seed-member-004', '৩০০', 'যশোর সদর', 'চাঁচড়া ইউনিয়ন', 'যশোর সদর', 'যশোর'],
    ['seed-member-005', '৪০০', 'কেশবপুর', 'কেশবপুর ইউনিয়ন', 'কেশবপুর', 'যশোর'],
  ];

  for (const [userId, houseNo, village, union, policeStation, district] of addresses) {
    await upsertAddress({
      id: `seed-addr-${userId}`,
      userId,
      houseNo,
      village,
      union,
      policeStation,
      district,
    });
  }

  await prisma.nominee.upsert({
    where: { userId: 'seed-member-001' },
    update: {
      id: 'seed-nominee-001',
      name: 'নমিনী নাম',
      relationship: 'স্বামী',
      nidNumber: '1111222233334444',
      phone: '8801611111111',
    },
    create: {
      id: 'seed-nominee-001',
      name: 'নমিনী নাম',
      relationship: 'স্বামী',
      nidNumber: '1111222233334444',
      phone: '8801611111111',
      userId: 'seed-member-001',
    },
  });

  await upsertLoan({
    id: 'seed-loan-001',
    loanNumber: 'LN-001',
    principalAmount: 5000000n,
    remainingAmount: 4000000n,
    totalInstallments: 12,
    installmentAmount: 416667n,
    paidInstallments: 2,
    purpose: 'ব্যবসা সম্প্রসারণ',
    status: LoanStatus.ACTIVE,
    accountId: 'seed-acc-member-001',
    borrowerId: 'seed-member-001',
    guarantorId: 'seed-admin-001',
    disbursementDate: daysAgo(60),
    installmentStartDate: daysAgo(30),
    expectedEndDate: daysAfter(300),
    approvedAt: daysAgo(62),
    approvedBy: 'seed-admin-001',
    createdAt: daysAgo(65),
  });

  await upsertLoan({
    id: 'seed-loan-002',
    loanNumber: 'LN-002',
    principalAmount: 2000000n,
    remainingAmount: 0n,
    totalInstallments: 10,
    installmentAmount: 200000n,
    paidInstallments: 10,
    purpose: 'শিক্ষা',
    status: LoanStatus.COMPLETED,
    accountId: 'seed-acc-member-001',
    borrowerId: 'seed-member-001',
    guarantorId: 'seed-member-002',
    disbursementDate: daysAgo(365),
    installmentStartDate: daysAgo(335),
    expectedEndDate: daysAgo(65),
    approvedAt: daysAgo(370),
    approvedBy: 'seed-admin-001',
    completedAt: daysAgo(65),
    createdAt: daysAgo(370),
  });

  await upsertLoan({
    id: 'seed-loan-003',
    loanNumber: 'LN-003',
    principalAmount: 3000000n,
    remainingAmount: 3000000n,
    totalInstallments: 12,
    installmentAmount: 250000n,
    paidInstallments: 0,
    purpose: 'কৃষি উন্নয়ন',
    status: LoanStatus.PENDING_GUARANTOR,
    accountId: 'seed-acc-member-002',
    borrowerId: 'seed-member-002',
    guarantorId: 'seed-member-001',
    createdAt: daysAgo(3),
  });

  await upsertLoan({
    id: 'seed-loan-004',
    loanNumber: 'LN-004',
    principalAmount: 2500000n,
    remainingAmount: 2500000n,
    totalInstallments: 12,
    installmentAmount: 208333n,
    paidInstallments: 0,
    purpose: 'ব্যবসা শুরু',
    status: LoanStatus.PENDING_APPROVAL,
    accountId: 'seed-acc-member-003',
    borrowerId: 'seed-member-003',
    guarantorId: 'seed-member-001',
    createdAt: daysAgo(2),
  });

  const transactionSeeds = [
    ['seed-txn-001', TransactionType.DEPOSIT, 1000000n, 'RCP-001', 'প্রথম জমা', 1000000n, null, 'seed-acc-member-001', 'seed-member-001', null, 'seed-staff-001', daysAgo(30)],
    ['seed-txn-002', TransactionType.DEPOSIT, 500000n, 'RCP-002', 'দ্বিতীয় জমা', 1500000n, null, 'seed-acc-member-001', 'seed-member-001', null, 'seed-staff-001', daysAgo(20)],
    ['seed-txn-003', TransactionType.DEPOSIT, 500000n, 'RCP-003', 'তৃতীয় জমা', 2000000n, null, 'seed-acc-member-001', 'seed-member-001', null, 'seed-staff-001', daysAgo(10)],
    ['seed-txn-004', TransactionType.DEPOSIT, 300000n, 'RCP-004', 'চতুর্থ জমা', 2300000n, null, 'seed-acc-member-001', 'seed-member-001', null, 'seed-staff-001', daysAgo(5)],
    ['seed-txn-005', TransactionType.DEPOSIT, 200000n, 'RCP-005', 'পঞ্চম জমা', 2500000n, null, 'seed-acc-member-001', 'seed-member-001', null, 'seed-staff-001', daysAgo(1)],
    ['seed-txn-006', TransactionType.LOAN_REPAYMENT, 500000n, 'LR-001', 'প্রথম কিস্তি', null, 4500000n, 'seed-acc-member-001', 'seed-member-001', 'seed-loan-001', 'seed-staff-001', daysAgo(25)],
    ['seed-txn-007', TransactionType.LOAN_REPAYMENT, 500000n, 'LR-002', 'দ্বিতীয় কিস্তি', null, 4000000n, 'seed-acc-member-001', 'seed-member-001', 'seed-loan-001', 'seed-staff-001', daysAgo(10)],
    ['seed-txn-008', TransactionType.DONATION, 500000n, 'DON-001', 'দাতব্য তহবিলে দান', 500000n, null, 'seed-acc-donation-001', 'seed-member-001', null, 'seed-staff-001', daysAgo(90)],
    ['seed-txn-009', TransactionType.DONATION, 300000n, 'DON-002', 'দাতব্য তহবিলে দান', 800000n, null, 'seed-acc-donation-001', 'seed-staff-001', null, 'seed-staff-001', daysAgo(70)],
    ['seed-txn-010', TransactionType.DONATION, 1000000n, 'DON-003', 'দাতব্য তহবিলে দান', 1800000n, null, 'seed-acc-donation-001', 'seed-admin-001', null, 'seed-staff-001', daysAgo(50)],
    ['seed-txn-011', TransactionType.DONATION, 200000n, 'DON-004', 'দাতব্য তহবিলে দান', 2000000n, null, 'seed-acc-donation-001', 'seed-member-002', null, 'seed-staff-001', daysAgo(30)],
    ['seed-txn-012', TransactionType.DONATION, 400000n, 'DON-005', 'দাতব্য তহবিলে দান', 2400000n, null, 'seed-acc-donation-001', 'seed-member-001', null, 'seed-staff-001', daysAgo(15)],
    ['seed-txn-013', TransactionType.DONATION, 250000n, 'DON-006', 'দাতব্য তহবিলে দান', 2650000n, null, 'seed-acc-donation-001', 'seed-staff-001', null, 'seed-staff-001', daysAgo(5)],
  ];

  for (const [id, type, amount, receiptNumber, description, savingsAfter, loanAfter, accountId, userId, loanId, processedBy, createdAt] of transactionSeeds) {
    await upsertTransaction({
      id,
      type,
      amount,
      receiptNumber,
      description,
      status: TransactionStatus.CONFIRMED,
      savingsAfter,
      loanAfter,
      accountId,
      userId,
      loanId,
      processedBy,
      createdAt,
    });
  }

  console.log('Seeded Prisma data: users, accounts, addresses, nominee, loans, transactions, branches, system_config');
  console.log('Login users:');
  console.log('  - admin@hasnahena.local / Admin@12345');
  console.log('  - staff@hasnahena.local / Staff@12345');
  console.log('  - member@hasnahena.local / Member@12345');
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
