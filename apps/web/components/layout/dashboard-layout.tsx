'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Wallet,
  HandCoins,
  Receipt,
  User,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Globe,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: 'member' | 'worker' | 'admin';
}

const memberNav = [
  { name: 'overview', href: '', icon: LayoutDashboard },
  { name: 'deposits', href: '/deposits', icon: Wallet },
  { name: 'loans', href: '/loans', icon: HandCoins },
  { name: 'transactions', href: '/transactions', icon: Receipt },
  { name: 'profile', href: '/profile', icon: User },
  { name: 'settings', href: '/settings', icon: Settings },
];

const workerNav = [
  { name: 'overview', href: '', icon: LayoutDashboard },
  { name: 'Members', href: '/members', icon: User },
  { name: 'Deposits', href: '/deposits', icon: Wallet },
  { name: 'Loans', href: '/loans', icon: HandCoins },
  { name: 'Transactions', href: '/transactions', icon: Receipt },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const adminNav = [
  { name: 'overview', href: '', icon: LayoutDashboard },
  { name: 'Members', href: '/members', icon: User },
  { name: 'Workers', href: '/workers', icon: User },
  { name: 'Deposits', href: '/deposits', icon: Wallet },
  { name: 'Loans', href: '/loans', icon: HandCoins },
  { name: 'Reports', href: '/reports', icon: Receipt },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function DashboardLayout({ children, role }: DashboardLayoutProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = role === 'admin' ? adminNav : role === 'worker' ? workerNav : memberNav;
  const basePath = `/${locale}/dashboard/${role}`;

  const roleLabels = {
    member: locale === 'bn' ? 'সদস্য' : 'Member',
    worker: locale === 'bn' ? 'কর্মী' : 'Worker',
    admin: locale === 'bn' ? 'অ্যাডমিন' : 'Admin',
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-card border-r transform transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-4 border-b">
            <Link href={`/${locale}`} className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                হ
              </div>
              <span className="font-bold">
                {locale === 'bn' ? 'হাসনাহেনা' : 'Hasnahena'}
              </span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Role Badge */}
          <div className="px-4 py-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
              {roleLabels[role]} {locale === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'}
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const href = `${basePath}${item.href}`;
              const isActive = pathname === href || (item.href === '' && pathname === basePath);

              return (
                <Link
                  key={item.name}
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="h-5 w-5" />
                  {t(item.name)}
                </Link>
              );
            })}
          </nav>

          {/* Logout */}
          <div className="p-4 border-t">
            <Link href={`/${locale}/login`}>
              <Button variant="outline" className="w-full gap-2">
                <LogOut className="h-4 w-4" />
                {locale === 'bn' ? 'লগআউট' : 'Logout'}
              </Button>
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 bg-card border-b">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-4 ml-auto">
            {/* Language Switcher */}
            <Link href={pathname.replace(`/${locale}`, locale === 'en' ? '/bn' : '/en')}>
              <Button variant="ghost" size="sm" className="gap-2">
                <Globe className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {locale === 'en' ? 'বাংলা' : 'English'}
                </span>
              </Button>
            </Link>

            {/* Notifications */}
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1 right-1 h-2 w-2 bg-destructive rounded-full" />
            </Button>

            {/* User Avatar */}
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">
                U
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
