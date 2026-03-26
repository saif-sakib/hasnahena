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
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-gradient-to-b from-emerald-800 to-emerald-900 text-white transform lg:transform-none lg:transition-none transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className="flex items-center justify-between h-20 px-5 border-b border-white/10">
            <Link href={`/${locale}`} className="flex items-center gap-3 group">
              <Logo size="md" showTagline={false} className="brightness-0 invert" />
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
                    prefetch={true}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-all ${
                      isActive
                        ? 'bg-white text-emerald-800 shadow-lg'
                        : 'text-emerald-100 hover:bg-white/10 hover:text-white'
                    }`}
                    onClick={() => {
                      if (pathname !== href) {
                        setPendingHref(href);
                      }
                      setSidebarOpen(false);
                    }}
                  >
                    <item.icon className={`h-5 w-5 ${isActive ? 'text-emerald-600' : ''}`} />
                    {locale === 'bn' ? item.bn : item.en}
                    {pendingHref === href && pathname !== href ? <span className="ml-auto h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
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
            <div className="relative" ref={notificationRef}>
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
                                  {notification.message || notification.description}
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
              )}
            </div>

            <div className="relative" ref={supportRef}>
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                aria-label="Support inbox"
                onClick={() => {
                  if (showSupportPopup) {
                    closeSupportPopup();
                  } else {
                    openSupportPopup();
                  }
                }}
              >
                <MessageCircle className="h-5 w-5 text-slate-600" />
                {showSupportBadge && (
                  role === 'member' ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500" />
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

                  {/* Support Popup - Full height on mobile, dropdown on desktop */}
                  <div
                    className="fixed inset-0 z-[70] flex flex-col bg-white dark:bg-slate-900 sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:h-auto sm:max-h-[min(520px,calc(100vh-8rem))] sm:rounded-2xl sm:shadow-2xl sm:border sm:border-slate-200 dark:sm:border-slate-700"
                    style={{ height: '100dvh' }}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between h-14 px-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0 safe-area-top">
                      {/* Back button - available for all users when viewing a thread */}
                      {activeSupportThreadId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => {
                            setActiveSupportThreadId(null);
                            setSupportMessages([]);
                          }}
                        >
                          <ArrowLeft className="h-5 w-5" />
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-sm">
                            <MessageCircle className="w-4.5 h-4.5 text-white" />
                          </div>
                          <div>
                            <span className="text-sm font-semibold text-slate-800 dark:text-white block">{supportPopupHeader}</span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                              {locale === 'bn' ? 'অনলাইন' : 'Online'}
                            </span>
                          </div>
                        </div>
                      )}
                      {activeSupportThreadId && (
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate max-w-[120px] flex-1 text-center">
                          {activeSupportThread?.memberName || ''}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={closeSupportPopup}
                      >
                        <X className="h-5 w-5" />
                      </Button>
                    </div>

                    {supportLoading ? (
                      <div className="flex-1 flex items-center justify-center min-h-[300px] sm:min-h-[400px]">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                          <span className="text-sm text-muted-foreground">
                            {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
                          </span>
                        </div>
                      </div>
                    ) : activeSupportThreadId ? (
                      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        {/* Messages Container */}
                        <div
                          ref={supportMessagesRef}
                          className="flex-1 overflow-y-auto px-3 py-3 bg-slate-50 dark:bg-slate-950/50 touch-pan-y scroll-touch overscroll-none"
                        >
                          {supportMessages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center py-8">
                              <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                                <MessageCircle className="w-7 h-7 text-slate-400" />
                              </div>
                              <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                {locale === 'bn' ? 'কোনো বার্তা নেই' : 'No messages yet'}
                              </p>
                              <p className="text-xs text-slate-400">
                                {locale === 'bn' ? 'আপনার প্রথম বার্তা পাঠান!' : 'Send your first message!'}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {supportMessages.map((msg, idx) => {
                                const isMe = userInfo?.id === msg.senderId;
                                const prevMsg = supportMessages[idx - 1];
                                const nextMsg = supportMessages[idx + 1];
                                const isFirstInGroup = !prevMsg || prevMsg.senderId !== msg.senderId;
                                const isLastInGroup = !nextMsg || nextMsg.senderId !== msg.senderId;

                                return (
                                  <div
                                    key={msg.id}
                                    className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${isFirstInGroup ? 'mt-3' : 'mt-0.5'}`}
                                  >
                                    <div
                                      className={`max-w-[82%] px-3.5 py-2 text-[13px] leading-relaxed shadow-sm ${
                                        isMe
                                          ? `bg-emerald-500 text-white ${isLastInGroup ? 'rounded-2xl rounded-br-md' : 'rounded-2xl'}`
                                          : `bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200 ${isLastInGroup ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl'}`
                                      }`}
                                    >
                                      <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                                      <p
                                        className={`mt-1 text-[10px] text-right ${
                                          isMe ? 'text-emerald-100' : 'text-slate-400 dark:text-slate-500'
                                        }`}
                                      >
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
                          <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={markSupportThreadProcessed}
                              className="w-full h-9 text-xs gap-2"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              {locale === 'bn' ? 'সমাধান হিসেবে চিহ্নিত করুন' : 'Mark as Resolved'}
                            </Button>
                          </div>
                        )}

                        {/* Input Area */}
                        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0 safe-area-bottom">
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
                                // Scroll to bottom when input is focused (keyboard opens)
                                setTimeout(() => scrollSupportToBottom(), 300);
                              }}
                              placeholder={locale === 'bn' ? 'বার্তা লিখুন...' : 'Type a message...'}
                              disabled={!activeSupportThreadId && role !== 'member'}
                              className="flex-1 rounded-full bg-slate-100 dark:bg-slate-800 border-0 px-4 h-11 text-sm focus-visible:ring-2 focus-visible:ring-emerald-500"
                            />
                            <Button
                              onClick={sendSupportMessage}
                              disabled={isSupportSending || !supportInput.trim() || (!activeSupportThreadId && role !== 'member')}
                              size="icon"
                              className="shrink-0 h-11 w-11 rounded-full bg-emerald-500 hover:bg-emerald-600 shadow-sm"
                            >
                              <Send className={`h-5 w-5 ${isSupportSending ? 'animate-pulse' : ''}`} />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Thread List
                      <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 touch-pan-y scroll-touch overscroll-none">
                        {supportThreads.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-6 py-8">
                            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                              <MessageCircle className="w-8 h-8 text-slate-400" />
                            </div>
                            <p className="text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
                              {role === 'member'
                                ? (locale === 'bn' ? 'সাপোর্টের প্রয়োজন?' : 'Need Support?')
                                : (locale === 'bn' ? 'কোনো কথোপকথন নেই' : 'No Conversations')
                              }
                            </p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[240px]">
                              {role === 'member'
                                ? (locale === 'bn' ? 'সাপোর্ট পেইজে যান এবং আপনার প্রশ্ন পাঠান' : 'Visit the support page to send your question')
                                : (locale === 'bn' ? 'সাপোর্ট অনুরোধ এখানে দেখা যাবে' : 'Support requests will appear here')
                              }
                            </p>
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
                                  className="w-full text-left px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors active:bg-slate-100 dark:active:bg-slate-800"
                                  onClick={() => openThread(thread)}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="relative flex-shrink-0">
                                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white font-semibold text-sm">
                                        {thread.memberName ? thread.memberName.charAt(0).toUpperCase() : '?'}
                                      </div>
                                      {showBadge && (
                                        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 border-2 border-white dark:border-slate-900 rounded-full" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-2 mb-0.5">
                                        <span className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                                          {thread.memberName || (locale === 'bn' ? 'সদস্য' : 'Member')}
                                        </span>
                                        <span className="text-[11px] text-slate-400 flex-shrink-0">
                                          {formatSupportTime(thread.latestAt)}
                                        </span>
                                      </div>
                                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
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
              className="flex items-center gap-2 pl-2 border-l border-slate-200 hover:bg-slate-100 rounded-lg py-1.5 px-2 -mr-2 transition-colors"
            >
              <div className="relative h-9 w-9 rounded-full overflow-hidden flex-shrink-0">
                {userInfo?.avatarUrl ? (
                  <Image
                    src={userInfo.avatarUrl}
                    alt={userInfo.nameEn || 'User'}
                    fill
                    sizes="36px"
                    className="object-cover"
                  />
                ) : (
                  <div className={`h-full w-full ${isHydrated && userInfo ? getAvatarColor(userInfo.nameEn || 'User') : 'bg-slate-400'} flex items-center justify-center font-semibold text-sm text-white`}>
                    {isHydrated && userInfo ? getInitials(locale === 'bn' ? (userInfo.nameBn || userInfo.nameEn) : (userInfo.nameEn || userInfo.nameBn) || 'U') : ''}
                  </div>
                )}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-slate-700">
                  {locale === 'bn' ? (userInfo?.nameBn || userInfo?.nameEn) : (userInfo?.nameEn || userInfo?.nameBn) || 'User'}
                </p>
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
