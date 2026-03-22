'use client';

import { DashboardLayout } from '@/components/layout/dashboard-layout';

export default function WorkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout role="worker">{children}</DashboardLayout>;
}
