'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Wallet,
  HandCoins,
  Receipt,
  User,
  Settings,
  Menu,
  X,
  Bell,
  Globe,
  LogOut,
  Home,
  ChevronRight,
  Users,
  UserPlus,
  ClipboardList,
  PieChart,
  FileText,
  Shield,
  CheckCircle2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Logo, LogoIcon } from '@/components/ui/logo';
import Image from 'next/image';
import { toast } from '@/hooks/use-toast';
import { apiGet } from '@/lib/api';

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
}

interface UserInfo {
  id: string;
  nameEn: string;
  nameBn: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  avatarUrl: string;
  memberId: string;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: 'member' | 'worker' | 'admin';
}

// Member navigation - based on requirements: deposits, loans, transactions
const memberNav = [
  { name: 'overview', href: '', icon: LayoutDashboard, en: 'Overview', bn: 'সারসংক্ষেপ' },
  { name: 'deposits', href: '/deposits', icon: Wallet, en: 'My Deposits', bn: 'আমার আমানত' },
  { name: 'loans', href: '/loans', icon: HandCoins, en: 'My Loans', bn: 'আমার ঋণ' },
  { name: 'transactions', href: '/transactions', icon: Receipt, en: 'Transactions', bn: 'লেনদেন' },
];

// Worker navigation - based on requirements: process requests, manage members, record transactions
const workerNav = [
  { name: 'overview', href: '', icon: LayoutDashboard, en: 'Overview', bn: 'সারসংক্ষেপ' },
  { name: 'requests', href: '/requests', icon: ClipboardList, en: 'Pending Requests', bn: 'অপেক্ষমান অনুরোধ' },
  { name: 'members', href: '/members', icon: Users, en: 'Members', bn: 'সদস্যগণ' },
  { name: 'deposits', href: '/deposits', icon: Wallet, en: 'Deposits', bn: 'আমানত' },
  { name: 'loans', href: '/loans', icon: HandCoins, en: 'Loans', bn: 'ঋণ' },
  { name: 'transactions', href: '/transactions', icon: Receipt, en: 'Transactions', bn: 'লেনদেন' },
];

// Admin navigation - full access: members, workers, approvals, reports, settings
const adminNav = [
  { name: 'overview', href: '', icon: LayoutDashboard, en: 'Overview', bn: 'সারসংক্ষেপ' },
  { name: 'members', href: '/members', icon: Users, en: 'Members', bn: 'সদস্যগণ' },
  { name: 'workers', href: '/workers', icon: UserPlus, en: 'Workers', bn: 'কর্মীগণ' },
  { name: 'approvals', href: '/approvals', icon: ClipboardList, en: 'Approvals', bn: 'অনুমোদন' },
  { name: 'deposits', href: '/deposits', icon: Wallet, en: 'All Deposits', bn: 'সকল আমানত' },
  { name: 'loans', href: '/loans', icon: HandCoins, en: 'All Loans', bn: 'সকল ঋণ' },
  { name: 'donations', href: '/donations', icon: PieChart, en: 'Donations', bn: 'দান তহবিল' },
  { name: 'reports', href: '/reports', icon: FileText, en: 'Reports', bn: 'রিপোর্ট' },
  { name: 'settings', href: '/settings', icon: Settings, en: 'Settings', bn: 'সেটিংস' },
];

export function DashboardLayout({ children, role }: DashboardLayoutProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const navItems = role === 'admin' ? adminNav : role === 'worker' ? workerNav : memberNav;
  const basePath = `/${locale}/dashboard/${role}`;

  const roleLabels = {
    member: locale === 'bn' ? 'সদস্য' : 'Member',
    worker: locale === 'bn' ? 'কর্মী' : 'Worker',
    admin: locale === 'bn' ? 'অ্যাডমিন' : 'Admin',
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const data = await apiGet<NotificationItem[]>('/v1/dashboard/notifications');
        setNotifications(data);
      } catch {
        setNotifications([]);
      }
    };

    loadNotifications();
  }, []);

  const markNotificationAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  };

  const markAllNotificationsAsRead = () => {
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
    toast({
      title: locale === 'bn' ? 'সব বিজ্ঞপ্তি পঠিত হিসেবে চিহ্নিত হয়েছে' : 'All notifications marked as read',
      variant: 'success',
    });
  };

  const handleViewAllNotifications = () => {
    setShowNotifications(false);
    router.push(basePath);
  };

  const formatNotificationTime = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('hn_access_token');
    window.dispatchEvent(new Event('auth-change'));
    toast({
      title: locale === 'bn' ? 'সফলভাবে লগআউট হয়েছে' : 'Logged out successfully',
      variant: 'success',
    });
    router.push(`/${locale}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/30 to-slate-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-gradient-to-b from-emerald-800 to-emerald-900 text-white transform transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className="flex items-center justify-between h-20 px-5 border-b border-white/10">
            <Link href={`/${locale}`} className="flex items-center gap-3 group">
              <Image
                src="/images/dashboard-logo.png"
                alt="Hasnahena"
                width={48}
                height={48}
                className="rounded-lg"
              />
              <span className="font-bold text-xl text-white">
                {locale === 'bn' ? 'হাসনাহেনা' : 'Hasnahena'}
              </span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-white hover:bg-white/10"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Role Badge & Home Link */}
          <div className="px-5 py-4 space-y-3">
            <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-emerald-100 border border-white/10">
              {roleLabels[role]} {locale === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'}
            </span>
            <Link 
              href={`/${locale}`}
              className="flex items-center gap-2 text-sm text-emerald-200 hover:text-white transition-colors"
            >
              <Home className="h-4 w-4" />
              {locale === 'bn' ? 'হোম পেজে যান' : 'Go to Home'}
              <ChevronRight className="h-3 w-3 ml-auto" />
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 pb-4 overflow-y-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <p className="px-4 mb-3 text-xs uppercase tracking-wider text-emerald-300/70 font-medium">
              {locale === 'bn' ? 'মেনু' : 'Menu'}
            </p>
            <div className="space-y-1">
              {navItems.map((item) => {
                const href = `${basePath}${item.href}`;
                const isActive = pathname === href || (item.href === '' && pathname === basePath);

                return (
                  <Link
                    key={item.name}
                    href={href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-all ${
                      isActive
                        ? 'bg-white text-emerald-800 shadow-lg'
                        : 'text-emerald-100 hover:bg-white/10 hover:text-white'
                    }`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <item.icon className={`h-5 w-5 ${isActive ? 'text-emerald-600' : ''}`} />
                    {locale === 'bn' ? item.bn : item.en}
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Logout & Version */}
          <div className="p-4 border-t border-white/10">
            <Button 
              variant="outline" 
              className="w-full gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white hover:border-white/30"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              {locale === 'bn' ? 'লগআউট' : 'Logout'}
            </Button>
            <p className="mt-4 text-center text-xs text-emerald-300/50">
              {locale === 'bn' ? 'হাসনাহেনা' : 'Hasnahena'} v1.0
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-72">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 sm:px-6 bg-white/80 border-b border-slate-200/50 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
                {locale === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'}
              </h1>
              <p className="text-sm text-slate-500 hidden sm:block">
                {new Date().toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Language Switcher */}
            <Link href={pathname.replace(`/${locale}`, locale === 'en' ? '/bn' : '/en')}>
              <Button variant="ghost" size="sm" className="gap-2 text-slate-600">
                <Globe className="h-4 w-4" />
                <span className="hidden sm:inline text-sm">
                  {locale === 'en' ? 'বাংলা' : 'EN'}
                </span>
              </Button>
            </Link>

            {/* Notifications */}
            <div className="relative">
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative"
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell className="h-5 w-5 text-slate-600" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-medium text-white flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </Button>

              {/* Notifications Dropdown */}
              {showNotifications && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowNotifications(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                      <h3 className="font-semibold text-slate-900">
                        {locale === 'bn' ? 'বিজ্ঞপ্তি' : 'Notifications'}
                      </h3>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {unreadCount} {locale === 'bn' ? 'নতুন' : 'new'}
                        </span>
                        {unreadCount > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={markAllNotificationsAsRead}
                          >
                            {locale === 'bn' ? 'সব পঠিত' : 'Mark all read'}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length > 0 ? (
                        notifications.map((notification) => (
                          <div 
                            key={notification.id}
                            className={`p-4 border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${
                              !notification.read ? 'bg-emerald-50/50' : ''
                            }`}
                            onClick={() => {
                              markNotificationAsRead(notification.id);
                              setShowNotifications(false);
                            }}
                          >
                            <div className="flex gap-3">
                              <div className="flex-shrink-0">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-900">
                                  {notification.title}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {notification.description}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                  {formatNotificationTime(notification.time)}
                                </p>
                              </div>
                              {!notification.read && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    markNotificationAsRead(notification.id);
                                  }}
                                >
                                  {locale === 'bn' ? 'পঠিত' : 'Mark read'}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">
                            {locale === 'bn' ? 'কোন বিজ্ঞপ্তি নেই' : 'No notifications'}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="p-3 border-t border-slate-100 bg-slate-50">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-sm"
                        onClick={handleViewAllNotifications}
                      >
                        {locale === 'bn' ? 'সব দেখুন' : 'View all'}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* User Avatar - Clickable to Profile */}
            <Link 
              href={`${basePath}/profile`}
              className="flex items-center gap-2 pl-2 border-l border-slate-200 hover:bg-slate-100 rounded-lg py-1.5 px-2 -mr-2 transition-colors"
            >
              <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold text-sm">
                S
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-slate-700">Saif</p>
                <p className="text-xs text-slate-500">{roleLabels[role]}</p>
              </div>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
