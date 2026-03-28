'use client';

import { useEffect, useMemo, useState, useRef, useCallback, FormEvent } from 'react';
import { useLocale } from 'next-intl';
import {
  CheckCircle2,
  MessageCircle,
  Send,
  ArrowLeft,
  User as UserIcon,
  Search,
  Inbox,
  Hash,
  Phone,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiPost, getApiBaseUrl } from '@/lib/api';
import { getValidatedClientToken } from '@/lib/client-auth';

type SupportThread = {
  id: string;
  memberUserId: string;
  memberName: string;
  memberUid: string;
  memberPhone: string;
  status: string;
  latestMessage: string;
  latestSenderRole: string;
  latestAt: string;
  updatedAt: string;
  deleteAt: string;
  processedBy: string;
  processedAt: string;
  isProcessed: boolean;
};

type SupportMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderUid: string;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
};

function formatTime(iso: string, locale: string) {
  return new Date(iso).toLocaleTimeString(locale === 'bn' ? 'bn-BD' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(iso: string, locale: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return locale === 'bn' ? 'এইমাত্র' : 'Just now';
  } else if (diffMins < 60) {
    return locale === 'bn' ? `${diffMins} মি.` : `${diffMins}m`;
  } else if (diffHours < 24) {
    return locale === 'bn' ? `${diffHours} ঘ.` : `${diffHours}h`;
  } else if (diffDays < 7) {
    return locale === 'bn' ? `${diffDays} দিন` : `${diffDays}d`;
  }
  return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateLabel(iso: string, locale: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return locale === 'bn' ? 'আজ' : 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return locale === 'bn' ? 'গতকাল' : 'Yesterday';
  }
  return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function WorkerSupportPage() {
  const locale = useLocale();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter(
      (t) =>
        t.memberName.toLowerCase().includes(q) ||
        t.latestMessage.toLowerCase().includes(q) ||
        t.memberPhone.includes(q) ||
        t.memberUid.toLowerCase().includes(q)
    );
  }, [threads, searchQuery]);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      const doScroll = () => {
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      };
      // Immediate scroll
      doScroll();
      // RAF scroll for layout completion
      requestAnimationFrame(() => {
        doScroll();
        requestAnimationFrame(doScroll);
      });
      // Delayed fallback for complex layouts
      setTimeout(doScroll, 100);
      setTimeout(doScroll, 300);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const result = await apiGet<SupportThread[]>('/v1/dashboard/support/threads');
      setThreads(result);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const result = await apiGet<SupportMessage[]>(
        `/v1/dashboard/support/messages?threadId=${encodeURIComponent(threadId)}`
      );
      setMessages(result);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await loadThreads();
      setIsLoading(false);
    };
    void init();

    const timer = setInterval(() => {
      void loadThreads();
    }, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select first thread on desktop
  useEffect(() => {
    if (!activeThreadId && threads.length > 0 && window.innerWidth >= 768) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  // Load messages and setup SSE when thread changes
  useEffect(() => {
    if (!activeThreadId) return;

    const init = async () => {
      await loadMessages(activeThreadId);
      setTimeout(() => scrollToBottom(), 100);
    };
    void init();

    const token = getValidatedClientToken();
    if (!token) return;

    const proxyBase = typeof window !== 'undefined' ? '' : getApiBaseUrl();
    const url = `${proxyBase}/api/v1/dashboard/support/stream?threadId=${encodeURIComponent(
      activeThreadId
    )}&access_token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('update', () => {
      void loadMessages(activeThreadId);
      void loadThreads();
    });

    return () => es.close();
  }, [activeThreadId, loadMessages, loadThreads, scrollToBottom]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const selectThread = (thread: SupportThread) => {
    setActiveThreadId(thread.id);
    setMobileView('chat');
  };

  const goBackToList = () => {
    setMobileView('list');
    setActiveThreadId(null);
    setMessages([]);
  };

  const sendMessage = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || !activeThreadId) return;

    setIsSending(true);
    try {
      await apiPost('/v1/dashboard/support/messages', {
        threadId: activeThreadId,
        message: trimmed,
      });
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      void loadMessages(activeThreadId);
      void loadThreads();
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  const markProcessed = async () => {
    if (!activeThreadId) return;
    await apiPost('/v1/dashboard/support/threads/processed', {
      threadId: activeThreadId,
    });
    void loadThreads();
  };

  const groupedMessages = useMemo(() => {
    const groups: { dateLabel: string; messages: SupportMessage[] }[] = [];
    messages.forEach((msg) => {
      const label = formatDateLabel(msg.createdAt, locale);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.dateLabel === label) {
        lastGroup.messages.push(msg);
      } else {
        groups.push({ dateLabel: label, messages: [msg] });
      }
    });
    return groups;
  }, [messages, locale]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-12rem)] min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">
            {locale === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] md:h-[calc(100vh-10rem)] min-h-[400px] max-h-[900px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      {/* Thread List Sidebar */}
      <div
        className={`${
          mobileView === 'list' ? 'flex' : 'hidden'
        } md:flex flex-col w-full md:w-80 lg:w-96 border-r border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900`}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Inbox className="w-5 h-5 text-emerald-600" />
            {locale === 'bn' ? 'সাপোর্ট ইনবক্স' : 'Support Inbox'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {threads.length}{' '}
            {locale === 'bn' ? 'টি কথোপকথন' : 'conversations'}
          </p>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={locale === 'bn' ? 'UID, ফোন বা নাম দিয়ে খুঁজুন...' : 'Search by UID, phone or name...'}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 rounded-xl border-0 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <MessageCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {locale === 'bn' ? 'কোনো কথোপকথন নেই' : 'No conversations yet'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 dark:divide-slate-800">
              {filteredThreads.map((thread) => {
                const isActive = activeThreadId === thread.id;
                const isUnprocessed = thread.status !== 'PROCESSED';

                return (
                  <button
                    key={thread.id}
                    onClick={() => selectThread(thread)}
                    className={`w-full text-left px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      isActive ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white font-medium text-sm">
                          {getInitials(thread.memberName)}
                        </div>
                        {isUnprocessed && (
                          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 border-2 border-white dark:border-slate-900 rounded-full" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-medium text-sm truncate ${
                              isUnprocessed
                                ? 'text-slate-900 dark:text-white'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {thread.memberName}
                          </span>
                          <span className="text-[11px] text-slate-400 flex-shrink-0">
                            {formatRelativeTime(thread.latestAt, locale)}
                          </span>
                        </div>
                        {/* Member UID & Phone */}
                        <div className="flex items-center gap-2 mt-0.5">
                          {thread.memberUid && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5 font-mono">
                              <Hash className="w-2.5 h-2.5" />
                              {thread.memberUid}
                            </span>
                          )}
                          {thread.memberPhone && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                              <Phone className="w-2.5 h-2.5" />
                              {thread.memberPhone}
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-xs truncate mt-0.5 ${
                            isUnprocessed
                              ? 'text-slate-600 dark:text-slate-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {thread.latestMessage}
                        </p>
                        {isUnprocessed && (
                          <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
                            {locale === 'bn' ? 'অপেক্ষমান' : 'Pending'}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div
        className={`${
          mobileView === 'chat' ? 'flex' : 'hidden'
        } md:flex flex-col flex-1 bg-slate-50 dark:bg-slate-950/50`}
      >
        {activeThread ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8"
                onClick={goBackToList}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>

              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white font-medium text-sm flex-shrink-0">
                {getInitials(activeThread.memberName)}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                  {activeThread.memberName}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {activeThread.memberUid && (
                    <span className="text-[10px] text-slate-500 flex items-center gap-0.5 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      <Hash className="w-2.5 h-2.5" />
                      {activeThread.memberUid}
                    </span>
                  )}
                  {activeThread.memberPhone && (
                    <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                      <Phone className="w-2.5 h-2.5" />
                      {activeThread.memberPhone}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    activeThread.status === 'PROCESSED'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  }`}>
                    {activeThread.status === 'PROCESSED'
                      ? locale === 'bn'
                        ? 'সমাধান হয়েছে'
                        : 'Resolved'
                      : locale === 'bn'
                      ? 'অপেক্ষমান'
                      : 'Open'}
                  </span>
                </div>
              </div>

              {activeThread.status !== 'PROCESSED' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={markProcessed}
                  className="hidden sm:flex gap-1.5 text-xs h-8"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {locale === 'bn' ? 'সমাধান' : 'Resolve'}
                </Button>
              )}
            </div>

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
            >
              {groupedMessages.map((group, groupIdx) => (
                <div key={groupIdx} className="space-y-3">
                  {/* Date Separator */}
                  <div className="flex justify-center py-2">
                    <span className="px-3 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-full shadow-sm border border-slate-100 dark:border-slate-700">
                      {group.dateLabel}
                    </span>
                  </div>

                  {/* Messages */}
                  {group.messages.map((m, idx) => {
                    const isSelf = m.senderRole === 'WORKER' || m.senderRole === 'ADMIN';
                    const prevMsg = group.messages[idx - 1];
                    const nextMsg = group.messages[idx + 1];
                    const isFirstInGroup = !prevMsg || prevMsg.senderRole !== m.senderRole;
                    const isLastInGroup = !nextMsg || nextMsg.senderRole !== m.senderRole;

                    return (
                      <div
                        key={m.id}
                        className={`flex ${isSelf ? 'justify-end' : 'justify-start'} ${
                          isFirstInGroup ? 'mt-3' : 'mt-0.5'
                        }`}
                      >
                        {/* Member Avatar */}
                        {!isSelf && isLastInGroup && (
                          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center mr-2 flex-shrink-0 self-end">
                            <UserIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          </div>
                        )}
                        {!isSelf && !isLastInGroup && <div className="w-7 mr-2" />}

                        <div
                          className={`relative max-w-[85%] sm:max-w-[70%] px-3 py-2 ${
                            isSelf
                              ? `bg-emerald-500 text-white ${
                                  isLastInGroup ? 'rounded-2xl rounded-br-md' : 'rounded-2xl'
                                }`
                              : `bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-100 dark:border-slate-700 ${
                                  isLastInGroup ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl'
                                }`
                          } shadow-sm`}
                        >
                          {/* Staff identifier for staff messages */}
                          {isSelf && isFirstInGroup && m.senderUid && (
                            <div className="flex items-center gap-1 mb-1 -mt-0.5">
                              <Shield className="w-2.5 h-2.5 text-emerald-200" />
                              <span className="text-[9px] font-mono text-emerald-200">
                                {m.senderRole === 'ADMIN' ? 'Admin' : 'Staff'} #{m.senderUid}
                              </span>
                            </div>
                          )}
                          <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                            {m.message}
                          </p>
                          <p
                            className={`text-[10px] mt-1 text-right ${
                              isSelf ? 'text-emerald-100' : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {formatTime(m.createdAt, locale)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Input Area */}
            <div className="px-3 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 md:hidden mb-2">
                {activeThread.status !== 'PROCESSED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={markProcessed}
                    className="flex-1 gap-1.5 text-xs h-8"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {locale === 'bn' ? 'সমাধান হিসেবে চিহ্নিত করুন' : 'Mark as Resolved'}
                  </Button>
                )}
              </div>

              <form onSubmit={sendMessage} className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    className="w-full resize-none rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-shadow"
                    placeholder={locale === 'bn' ? 'উত্তর লিখুন...' : 'Type your reply...'}
                    disabled={isSending}
                    style={{ maxHeight: '120px' }}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isSending || !message.trim()}
                  size="icon"
                  className="h-10 w-10 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex-shrink-0 transition-colors"
                >
                  <Send className={`h-4 w-4 ${isSending ? 'animate-pulse' : ''}`} />
                </Button>
              </form>
            </div>
          </>
        ) : (
          // Empty State
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {locale === 'bn' ? 'কথোপকথন নির্বাচন করুন' : 'Select a Conversation'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              {locale === 'bn'
                ? 'বাম দিকের তালিকা থেকে একটি কথোপকথন নির্বাচন করুন'
                : 'Choose a conversation from the list to start responding'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
