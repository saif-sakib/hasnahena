const { PrismaClient, UserRole, UserStatus } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seedUser({
  email,
  phone,
  plainPassword,
  role,
  status,
  memberId,
  nameEn,
  fatherName,
  motherName,
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
      fatherName,
      motherName,
    },
    create: {
      email,
      phone,
      passwordHash,
      role,
      status,
      memberId,
      nameEn,
      fatherName,
      motherName,
      formNumber: `FORM-${memberId}`,
    },
  });
}

async function main() {
  const users = [
    {
      email: 'admin@hasnahena.local',
      phone: '8801700000001',
      plainPassword: 'Admin@12345',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      memberId: 'ADM-0001',
      nameEn: 'Demo Admin',
      fatherName: 'Abdul Karim',
      motherName: 'Amena Begum',
    },
    {
      email: 'staff@hasnahena.local',
      phone: '8801700000002',
      plainPassword: 'Staff@12345',
      role: UserRole.WORKER,
      status: UserStatus.ACTIVE,
      memberId: 'STF-0001',
      nameEn: 'Demo Staff',
      fatherName: 'Jalal Uddin',
      motherName: 'Rokeya Begum',
    },
    {
      email: 'member@hasnahena.local',
      phone: '8801700000003',
      plainPassword: 'Member@12345',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      memberId: 'MBR-0001',
      nameEn: 'Demo Member',
      fatherName: 'Habib Rahman',
      motherName: 'Salma Khatun',
    },
  ];

  for (const user of users) {
    await seedUser(user);
  }

  console.log('Seeded users: admin, staff (worker), member');
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
