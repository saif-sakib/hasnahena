'use client';

import { DashboardLayout } from '@/components/layout/dashboard-layout';

export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout role="member">{children}</DashboardLayout>;
}
