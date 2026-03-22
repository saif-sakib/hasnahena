'use client';

import { DashboardLayout } from '@/components/layout/dashboard-layout';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout role="admin">{children}</DashboardLayout>;
}
