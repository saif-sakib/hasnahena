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
  Image as ImageIcon,
  MessageCircle,
  Send,
  ArrowLeft,
} from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';
import { apiGet, apiPost } from '@/lib/api';
import { getInitials, getAvatarColor } from '@/lib/image-utils';
import { clearClientAuthState, getValidatedClientToken } from '@/lib/client-auth';
import Image from 'next/image';
import { Input } from '@/components/ui/input';

interface NotificationItem {
  id: string;
  title: string;
  message?: string;
  description?: string;
  time: string;
  read: boolean;
  type?: string;
  data?: Record<string, unknown>;
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

interface SupportThreadItem {
  id: string;
  memberUserId: string;
  memberName: string;
  status: string;
  latestMessage: string;
  latestSenderRole: string;
  latestAt: string;
  deleteAt: string;
}

interface SupportMessageItem {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: 'member' | 'worker' | 'admin';
}

// Cache keys for sessionStorage
const USER_INFO_CACHE_KEY = 'hn_user_info_cache';
const USER_INFO_CACHE_TIMESTAMP_KEY = 'hn_user_info_timestamp';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache

// Member navigation - view-only access to account information
const memberNav = [
  { name: 'overview', href: '', icon: LayoutDashboard, en: 'Overview', bn: 'সারসংক্ষেপ' },
  { name: 'deposits', href: '/deposits', icon: Wallet, en: 'Deposit History', bn: 'আমানতের ইতিহাস' },
  { name: 'loans', href: '/loans', icon: HandCoins, en: 'Loan Status', bn: 'ঋণের স্থিতি' },
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
  { name: 'gallery', href: '/gallery', icon: ImageIcon, en: 'Gallery', bn: 'গ্যালারি' },
  { name: 'reports', href: '/reports', icon: FileText, en: 'Reports', bn: 'রিপোর্ট' },
  { name: 'settings', href: '/settings', icon: Settings, en: 'Settings', bn: 'সেটিংস' },
];

// Helper functions for caching
function getCachedUserInfo(): UserInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = sessionStorage.getItem(USER_INFO_CACHE_KEY);
    const timestamp = sessionStorage.getItem(USER_INFO_CACHE_TIMESTAMP_KEY);
    if (cached && timestamp) {
      const age = Date.now() - parseInt(timestamp, 10);
      if (age < CACHE_DURATION_MS) {
        return JSON.parse(cached);
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function setCachedUserInfo(userInfo: UserInfo) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(USER_INFO_CACHE_KEY, JSON.stringify(userInfo));
    sessionStorage.setItem(USER_INFO_CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch {
    // Ignore errors
  }
}

function clearCachedUserInfo() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(USER_INFO_CACHE_KEY);
    sessionStorage.removeItem(USER_INFO_CACHE_TIMESTAMP_KEY);
  } catch {
    // Ignore errors
  }
}

function clearAuthState() {
  if (typeof window === 'undefined') return;
  clearClientAuthState({ dispatchEvent: false });
  clearCachedUserInfo();
  window.dispatchEvent(new Event('auth-change'));
}

export function DashboardLayout({ children, role }: DashboardLayoutProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [supportAlertCount, setSupportAlertCount] = useState(0);
  const [memberHasSupportReply, setMemberHasSupportReply] = useState(false);
  const [showSupportPopup, setShowSupportPopup] = useState(false);
  const [supportThreads, setSupportThreads] = useState<SupportThreadItem[]>([]);
  const [activeSupportThreadId, setActiveSupportThreadId] = useState<string | null>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessageItem[]>([]);
  const [supportInput, setSupportInput] = useState('');
  const [supportLoading, setSupportLoading] = useState(false);
  const [isSupportSending, setIsSupportSending] = useState(false);
  const [seenSupportThreadIds, setSeenSupportThreadIds] = useState<Record<string, string>>({});
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const supportRef = useRef<HTMLDivElement | null>(null);
  const supportMessagesRef = useRef<HTMLDivElement | null>(null);
  const supportListInitializedRef = useRef(false);
  const hasFetchedRef = useRef(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const navItems = role === 'admin' ? adminNav : role === 'worker' ? workerNav : memberNav;
  const basePath = `/${locale}/dashboard/${role}`;

  const roleLabels = {
    member: locale === 'bn' ? 'সদস্য' : 'Member',
    worker: locale === 'bn' ? 'কর্মী' : 'Worker',
    admin: locale === 'bn' ? 'অ্যাডমিন' : 'Admin',
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const showSupportBadge = role === 'member' ? memberHasSupportReply : supportAlertCount > 0;
  const activeSupportThread =
    supportThreads.find((thread) => thread.id === activeSupportThreadId) ?? null;
  const supportPopupHeader =
    role === 'member'
      ? locale === 'bn'
        ? 'সাপোর্ট'
        : 'Support'
      : locale === 'bn'
        ? 'সাপোর্ট ইনবক্স'
        : 'Support Inbox';

  const scrollSupportToBottom = useCallback(() => {
    const el = supportMessagesRef.current;
    if (!el) return;
    // Use multiple approaches to ensure scroll works
    const doScroll = () => {
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    };
    // Immediate scroll
    doScroll();
    // RAF scroll for layout completion
    requestAnimationFrame(() => {
      doScroll();
      // Double RAF for complex layouts
      requestAnimationFrame(doScroll);
    });
    // Delayed scroll as fallback
    setTimeout(doScroll, 100);
    setTimeout(doScroll, 300);
  }, []);

  const loadUserInfo = useCallback(async (forceRefresh = false) => {
    try {
      const token = getValidatedClientToken();
      if (!token) {
        clearCachedUserInfo();
        setUserInfo(null);
        router.replace(`/${locale}/login`);
        return;
      }

      // Use cached data if available and not forcing refresh
      if (!forceRefresh) {
        const cached = getCachedUserInfo();
        if (cached) {
          setUserInfo(cached);
          return;
        }
      }

      const profile = await apiGet<UserInfo>('/v1/dashboard/user');
      const newUserInfo: UserInfo = {
        id: profile.id || '',
        nameEn: profile.nameEn || '',
        nameBn: profile.nameBn || '',
        email: profile.email || '',
        phone: profile.phone || '',
        role: profile.role || role,
        status: profile.status || '',
        avatarUrl: profile.avatarUrl || '',
        memberId: profile.memberId || '',
      };
      setUserInfo(newUserInfo);
      setCachedUserInfo(newUserInfo);
    } catch (error) {
      console.error('Failed to load user info:', error);
      clearAuthState();
      router.replace(`/${locale}/login`);
    }
  }, [role, locale, router]);

  const handleUnauthorizedError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('unauthorized')) {
      clearAuthState();
      router.replace(`/${locale}/login`);
      return true;
    }
    return false;
  }, [locale, router]);

  useEffect(() => {
    // Hydrate from cache on mount
    setIsHydrated(true);
    const cached = getCachedUserInfo();
    if (cached) {
      setUserInfo(cached);
    }

    // Only fetch once on mount, use cache for subsequent renders
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      loadUserInfo();
    }

    const onAuthChange = () => {
      clearCachedUserInfo();
      loadUserInfo(true); // Force refresh on auth change
    };
    window.addEventListener('auth-change', onAuthChange);
    return () => window.removeEventListener('auth-change', onAuthChange);
  }, [loadUserInfo]);

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const data = await apiGet<NotificationItem[]>('/v1/dashboard/notifications');
        // Exclude any notifications that mention support or messages (both EN and BN)
        setNotifications(data.filter((item) => {
          const ltitle = item.title.toLowerCase();
          return !ltitle.includes('support') && 
                 !ltitle.includes('সাপোর্ট') && 
                 !ltitle.includes('message') && 
                 !ltitle.includes('বার্তা');
        }));
      } catch (error) {
        if (handleUnauthorizedError(error)) return;
        setNotifications([]);
      }
    };

    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadSupportSignals = async () => {
      if (showSupportPopup) return;
      try {
        const threads = await apiGet<SupportThreadItem[]>('/v1/dashboard/support/threads');
        setSupportThreads(threads);
        if (role === 'member') {
          const hasReply = threads.some((thread) => {
            const seenAt = seenSupportThreadIds[thread.id];
            if (!thread.latestMessage || !thread.latestSenderRole || thread.latestSenderRole === 'MEMBER') {
              return false;
            }
            if (!seenAt) {
              return true;
            }
            return new Date(thread.latestAt).getTime() > new Date(seenAt).getTime();
          });
          setMemberHasSupportReply(hasReply);
          return;
        }

        const unprocessed = threads.filter((thread) => thread.status !== 'PROCESSED').length;
        setSupportAlertCount(unprocessed);
      } catch (error) {
        if (handleUnauthorizedError(error)) return;
        setSupportAlertCount(0);
        setMemberHasSupportReply(false);
        setSupportThreads([]);
      }
    };

    void loadSupportSignals();
    const timer = setInterval(() => {
      void loadSupportSignals();
    }, 10000);
    return () => clearInterval(timer);
  }, [role, handleUnauthorizedError, seenSupportThreadIds, showSupportPopup]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (showNotifications && notificationRef.current && !notificationRef.current.contains(target)) {
        setShowNotifications(false);
      }
      if (showSupportPopup && supportRef.current && !supportRef.current.contains(target)) {
        setShowSupportPopup(false);
        setActiveSupportThreadId(null);
        setSupportMessages([]);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showNotifications, showSupportPopup]);

  useEffect(() => {
    if (pendingHref && pathname === pendingHref) {
      setPendingHref(null);
    }
  }, [pathname, pendingHref]);

  // Timeout for pending navigation - clear if it takes too long
  useEffect(() => {
    if (!pendingHref) return;
    const timeout = setTimeout(() => {
      setPendingHref(null);
    }, 5000); // Clear after 5 seconds max
    return () => clearTimeout(timeout);
  }, [pendingHref]);

  const markNotificationAsRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );

    // Persist to backend
    try {
      const token = getValidatedClientToken();
      if (token) {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/v1/dashboard/notifications`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId: id }),
        });
      }
    } catch (error) {
      handleUnauthorizedError(error);
      // Silently fail, UI already updated
    }
  };

  const markAllNotificationsAsRead = async () => {
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
    toast({
      title: locale === 'bn' ? 'সব বিজ্ঞপ্তি পঠিত হিসেবে চিহ্নিত হয়েছে' : 'All notifications marked as read',
      variant: 'success',
    });

    // Persist to backend
    try {
      const token = getValidatedClientToken();
      if (token) {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/v1/dashboard/notifications`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ markAll: true }),
        });
      }
    } catch (error) {
      handleUnauthorizedError(error);
      // Silently fail, UI already updated
    }
  };

  const handleViewAllNotifications = () => {
    setShowNotifications(false);
    router.push(basePath);
  };

  const loadSupportMessages = useCallback(async (threadId: string) => {
    try {
      const messages = await apiGet<SupportMessageItem[]>(
        `/v1/dashboard/support/messages?threadId=${encodeURIComponent(threadId)}`
      );
      setSupportMessages(messages);
      // Delay scroll to ensure DOM is updated
      setTimeout(scrollSupportToBottom, 50);
    } catch (error) {
      if (!handleUnauthorizedError(error)) {
        setSupportMessages([]);
      }
    }
  }, [handleUnauthorizedError, scrollSupportToBottom]);

  useEffect(() => {
    if (!showSupportPopup) return;
    setSupportLoading(true);
    const refreshThreads = async () => {
      try {
        const threads = await apiGet<SupportThreadItem[]>('/v1/dashboard/support/threads');
        setSupportThreads(threads);
        if (role === 'member' && !activeSupportThreadId && threads.length > 0) {
          const first = threads[0];
          setActiveSupportThreadId(first.id);
          setSeenSupportThreadIds((prev) => ({ ...prev, [first.id]: first.latestAt }));
          await loadSupportMessages(first.id);
        }
      } catch (error) {
        handleUnauthorizedError(error);
      } finally {
        setSupportLoading(false);
      }
    };
    void refreshThreads();
    const timer = setInterval(() => {
      void refreshThreads();
      if (activeSupportThreadId) {
        void loadSupportMessages(activeSupportThreadId);
      }
    }, 7000);
    return () => clearInterval(timer);
  }, [showSupportPopup, activeSupportThreadId, handleUnauthorizedError, role, loadSupportMessages]);

  const markSupportSeen = useCallback((threadId: string, latestAt: string) => {
    setSeenSupportThreadIds((prev) => ({
      ...prev,
      [threadId]: latestAt,
    }));
  }, []);

  const openSupportPopup = () => {
    setShowSupportPopup(true);
    const seenNow = supportThreads.reduce<Record<string, string>>((acc, thread) => {
      acc[thread.id] = thread.latestAt;
      return acc;
    }, {});
    setSeenSupportThreadIds((prev) => ({ ...prev, ...seenNow }));
    setMemberHasSupportReply(false);
    if (
      role === 'member' &&
      supportThreads.length > 0 &&
      (!supportListInitializedRef.current || !activeSupportThreadId)
    ) {
      supportListInitializedRef.current = true;
      const firstThread = supportThreads[0];
      setActiveSupportThreadId(firstThread.id);
      markSupportSeen(firstThread.id, firstThread.latestAt);
      void loadSupportMessages(firstThread.id);
    }
  };

  const closeSupportPopup = () => {
    setShowSupportPopup(false);
    setActiveSupportThreadId(null);
    setSupportMessages([]);
    setSupportInput('');
  };

  useEffect(() => {
    if (!showSupportPopup || !activeSupportThreadId) return;
    scrollSupportToBottom();
  }, [showSupportPopup, activeSupportThreadId, supportMessages, scrollSupportToBottom]);

  // Handle iOS visual viewport changes (keyboard open/close)
  useEffect(() => {
    if (!showSupportPopup) return;
    
    const handleViewportResize = () => {
      // On iOS, when keyboard opens, visualViewport height decreases
      // Scroll to bottom to keep messages visible
      if (activeSupportThreadId) {
        scrollSupportToBottom();
      }
    };

    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
      return () => {
        window.visualViewport?.removeEventListener('resize', handleViewportResize);
      };
    }
  }, [showSupportPopup, activeSupportThreadId, scrollSupportToBottom]);

  const openThread = (thread: SupportThreadItem) => {
    setActiveSupportThreadId(thread.id);
    markSupportSeen(thread.id, thread.latestAt);
    void loadSupportMessages(thread.id);
  };

  const sendSupportMessage = async () => {
    const trimmed = supportInput.trim();
    if (!trimmed) return;
    setIsSupportSending(true);
    try {
      const payload = await apiPost<{ threadId?: string }>('/v1/dashboard/support/messages', {
        threadId: activeSupportThreadId,
        message: trimmed,
      });
      setSupportInput('');
      const threadId = payload?.threadId || activeSupportThreadId;
      if (threadId) {
        await loadSupportMessages(threadId);
        const latestThreads = await apiGet<SupportThreadItem[]>('/v1/dashboard/support/threads');
        setSupportThreads(latestThreads);
        const active = latestThreads.find((thread) => thread.id === threadId);
        if (active) {
          markSupportSeen(active.id, active.latestAt);
          setActiveSupportThreadId(active.id);
        }
      }
    } catch (error) {
      handleUnauthorizedError(error);
    } finally {
      setIsSupportSending(false);
    }
  };

  const markSupportThreadProcessed = async () => {
    if (!activeSupportThreadId) return;
    try {
      await apiPost('/v1/dashboard/support/threads/processed', { threadId: activeSupportThreadId });
      const latestThreads = await apiGet<SupportThreadItem[]>('/v1/dashboard/support/threads');
      setSupportThreads(latestThreads);
    } catch (error) {
      handleUnauthorizedError(error);
    }
  };

  const formatSupportTime = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      hour: '2-digit',
      minute: '2-digit',
    });
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
    clearClientAuthState({ dispatchEvent: false });
    clearCachedUserInfo(); // Clear user cache on logout
    window.dispatchEvent(new Event('auth-change'));
    toast({
      title: locale === 'bn' ? 'সফলভাবে লগআউট হয়েছে' : 'Logged out successfully',
      variant: 'success',
    });
    // Use replace for faster navigation and prevent going back to dashboard
    router.replace(`/${locale}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Clean simple design */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-200 transform lg:transform-none lg:transition-none transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo Section - Compact */}
          <div className="flex items-center justify-between h-14 px-4 border-b border-gray-200">
            <Link href={`/${locale}`} className="flex items-center gap-2">
              <Logo size="sm" showTagline={false} />
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-8 w-8"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Role Badge - Simple */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {roleLabels[role]}
              </span>
              <Link 
                href={`/${locale}`}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <Home className="h-3 w-3" />
                {locale === 'bn' ? 'হোম' : 'Home'}
              </Link>
            </div>
          </div>

          {/* Navigation - Clean list */}
          <nav className="flex-1 py-2 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            <div className="space-y-0.5 px-2">
              {navItems.map((item) => {
                const href = `${basePath}${item.href}`;
                const isActive = pathname === href || (item.href === '' && pathname === basePath);

                return (
                  <Link
                    key={item.name}
                    href={href}
                    prefetch={true}
                    className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors rounded ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                    onClick={() => {
                      if (pathname !== href) {
                        setPendingHref(href);
                      }
                      setSidebarOpen(false);
                    }}
                  >
                    <item.icon className={`h-4 w-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                    {locale === 'bn' ? item.bn : item.en}
                    {pendingHref === href && pathname !== href ? <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Logout - Compact */}
          <div className="p-3 border-t border-gray-200">
            <Button 
              variant="ghost" 
              size="sm"
              className="w-full justify-start gap-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              {locale === 'bn' ? 'লগআউট' : 'Logout'}
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-56">
        {/* Top Header - Compact */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-12 px-4 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-8 w-8"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-500">
              {new Date().toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Language Switcher */}
            <Link href={pathname.replace(`/${locale}`, locale === 'en' ? '/bn' : '/en')}>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-gray-600">
                <Globe className="h-3.5 w-3.5 mr-1" />
                {locale === 'en' ? 'BN' : 'EN'}
              </Button>
            </Link>

            {/* Notifications */}
            <div className="relative" ref={notificationRef}>
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative h-8 w-8"
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell className="h-4 w-4 text-gray-600" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-medium text-white flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </Button>

              {/* Notifications Dropdown */}
              {showNotifications && (
                  <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 shadow-lg z-50">
                    <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {locale === 'bn' ? 'বিজ্ঞপ্তি' : 'Notifications'}
                      </span>
                      {unreadCount > 0 && (
                        <button
                          className="text-xs text-blue-600 hover:text-blue-800"
                          onClick={markAllNotificationsAsRead}
                        >
                          {locale === 'bn' ? 'সব পঠিত' : 'Mark all read'}
                        </button>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {notifications.length > 0 ? (
                        notifications.map((notification) => (
                          <div 
                            key={notification.id}
                            className={`px-3 py-2 border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${
                              !notification.read ? 'bg-blue-50/50' : ''
                            }`}
                            onClick={() => {
                              markNotificationAsRead(notification.id);
                              setShowNotifications(false);
                            }}
                          >
                            <p className="text-sm text-gray-900 truncate">{notification.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{formatNotificationTime(notification.time)}</p>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-6 text-center text-sm text-gray-500">
                          {locale === 'bn' ? 'কোন বিজ্ঞপ্তি নেই' : 'No notifications'}
                        </div>
                      )}
                    </div>
                  </div>
              )}
            </div>

            <div className="relative" ref={supportRef}>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-8 w-8"
                aria-label="Support inbox"
                onClick={() => {
                  if (showSupportPopup) {
                    closeSupportPopup();
                  } else {
                    openSupportPopup();
                  }
                }}
              >
                <MessageCircle className="h-4 w-4 text-gray-600" />
                {showSupportBadge && (
                  role === 'member' ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
                  ) : (
                    <span className="absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-[10px] font-medium text-white flex items-center justify-center">
                      {supportAlertCount}
                    </span>
                  )
                )}
              </Button>
              {showSupportPopup && (
                <>
                  {/* Mobile Backdrop */}
                  <div
                    className="fixed inset-0 bg-black/30 z-[60] sm:hidden"
                    onClick={closeSupportPopup}
                  />

                  {/* Support Popup */}
                  <div
                    className="fixed inset-0 z-[70] flex flex-col bg-white sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-1 sm:w-80 sm:h-auto sm:max-h-96 sm:border sm:border-gray-200 sm:shadow-lg"
                    style={{ height: '100dvh' }}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between h-12 px-3 border-b border-gray-200 bg-white flex-shrink-0">
                      {/* Back button */}
                      {activeSupportThreadId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setActiveSupportThreadId(null);
                            setSupportMessages([]);
                          }}
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <MessageCircle className="w-4 h-4 text-gray-600" />
                          <span className="text-sm font-medium text-gray-800">{supportPopupHeader}</span>
                        </div>
                      )}
                      {activeSupportThreadId && (
                        <span className="text-xs text-gray-500 truncate max-w-[100px] flex-1 text-center">
                          {activeSupportThread?.memberName || ''}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={closeSupportPopup}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {supportLoading ? (
                      <div className="flex-1 flex items-center justify-center min-h-[200px]">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs text-gray-500">
                            {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
                          </span>
                        </div>
                      </div>
                    ) : activeSupportThreadId ? (
                      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        {/* Messages Container */}
                        <div
                          ref={supportMessagesRef}
                          className="flex-1 overflow-y-auto px-3 py-2 bg-gray-50"
                        >
                          {supportMessages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full min-h-[150px] text-center py-4">
                              <MessageCircle className="w-6 h-6 text-gray-300 mb-2" />
                              <p className="text-xs text-gray-500">
                                {locale === 'bn' ? 'কোনো বার্তা নেই' : 'No messages yet'}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {supportMessages.map((msg, idx) => {
                                const isMe = userInfo?.id === msg.senderId;
                                const prevMsg = supportMessages[idx - 1];
                                const isFirstInGroup = !prevMsg || prevMsg.senderId !== msg.senderId;

                                return (
                                  <div
                                    key={msg.id}
                                    className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${isFirstInGroup ? 'mt-2' : 'mt-0.5'}`}
                                  >
                                    <div
                                      className={`max-w-[80%] px-3 py-1.5 text-xs rounded ${
                                        isMe
                                          ? 'bg-blue-500 text-white'
                                          : 'bg-white border border-gray-200 text-gray-700'
                                      }`}
                                    >
                                      <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                                      <p className={`mt-0.5 text-[10px] text-right ${isMe ? 'text-blue-100' : 'text-gray-400'}`}>
                                        {formatSupportTime(msg.createdAt)}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Mark Processed Button (for workers/admins) */}
                        {role !== 'member' && activeSupportThread?.status !== 'PROCESSED' && (
                          <div className="px-3 py-2 border-t border-gray-200 bg-white flex-shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={markSupportThreadProcessed}
                              className="w-full h-8 text-xs gap-1"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {locale === 'bn' ? 'সমাধান' : 'Resolved'}
                            </Button>
                          </div>
                        )}

                        {/* Input Area */}
                        <div className="p-2 border-t border-gray-200 bg-white flex-shrink-0">
                          <div className="flex gap-2 items-center">
                            <Input
                              value={supportInput}
                              onChange={(e) => setSupportInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  void sendSupportMessage();
                                }
                              }}
                              onFocus={() => {
                                setTimeout(() => scrollSupportToBottom(), 300);
                              }}
                              placeholder={locale === 'bn' ? 'বার্তা...' : 'Message...'}
                              disabled={!activeSupportThreadId && role !== 'member'}
                              className="flex-1 h-8 text-xs"
                            />
                            <Button
                              onClick={sendSupportMessage}
                              disabled={isSupportSending || !supportInput.trim() || (!activeSupportThreadId && role !== 'member')}
                              size="icon"
                              className="shrink-0 h-8 w-8 bg-blue-500 hover:bg-blue-600"
                            >
                              <Send className={`h-3.5 w-3.5 ${isSupportSending ? 'animate-pulse' : ''}`} />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Thread List
                      <div className="flex-1 overflow-y-auto bg-white">
                        {supportThreads.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full min-h-[150px] text-center px-4 py-6">
                            <MessageCircle className="w-8 h-8 text-gray-300 mb-2" />
                            <p className="text-sm text-gray-600 mb-1">
                              {role === 'member'
                                ? (locale === 'bn' ? 'সাপোর্টের প্রয়োজন?' : 'Need Support?')
                                : (locale === 'bn' ? 'কোনো কথোপকথন নেই' : 'No Conversations')
                              }
                            </p>
                          </div>
                        ) : (
                          <div className="divide-y divide-gray-100">
                            {supportThreads.map((thread) => {
                              const seenAt = seenSupportThreadIds[thread.id];
                              const isUnread = !seenAt || new Date(thread.latestAt).getTime() > new Date(seenAt).getTime();
                              const showBadge = role === 'member'
                                ? (isUnread && thread.latestSenderRole !== 'MEMBER')
                                : (thread.status !== 'PROCESSED');

                              return (
                                <button
                                  key={thread.id}
                                  type="button"
                                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50"
                                  onClick={() => openThread(thread)}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="relative flex-shrink-0">
                                      <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center text-white font-medium text-xs">
                                        {thread.memberName ? thread.memberName.charAt(0).toUpperCase() : '?'}
                                      </div>
                                      {showBadge && (
                                        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 border border-white rounded-full" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-1 mb-0.5">
                                        <span className="text-xs font-medium text-gray-800 truncate">
                                          {thread.memberName || (locale === 'bn' ? 'সদস্য' : 'Member')}
                                        </span>
                                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                                          {formatSupportTime(thread.latestAt)}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-gray-500 truncate">
                                        {thread.latestMessage}
                                      </p>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* User Avatar - Clickable to Profile */}
            <Link
              href={`${basePath}/profile`}
              className="flex items-center gap-2 ml-1 pl-2 border-l border-gray-200 hover:bg-gray-100 py-1 px-2 -mr-2"
            >
              <div className="relative h-7 w-7 rounded-full overflow-hidden flex-shrink-0">
                {userInfo?.avatarUrl ? (
                  <Image
                    src={userInfo.avatarUrl}
                    alt={userInfo.nameEn || 'User'}
                    fill
                    sizes="28px"
                    className="object-cover"
                  />
                ) : (
                  <div className={`h-full w-full ${isHydrated && userInfo ? getAvatarColor(userInfo.nameEn || 'User') : 'bg-gray-400'} flex items-center justify-center font-medium text-xs text-white`}>
                    {isHydrated && userInfo ? getInitials(locale === 'bn' ? (userInfo.nameBn || userInfo.nameEn) : (userInfo.nameEn || userInfo.nameBn) || 'U') : ''}
                  </div>
                )}
              </div>
              <span className="hidden sm:inline text-xs font-medium text-gray-700 max-w-[80px] truncate">
                {locale === 'bn' ? (userInfo?.nameBn || userInfo?.nameEn) : (userInfo?.nameEn || userInfo?.nameBn) || 'User'}
              </span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4">{children}</main>
      </div>
    </div>
  );
}
