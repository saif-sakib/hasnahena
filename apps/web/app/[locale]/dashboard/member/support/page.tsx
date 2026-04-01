'use client';

import { useEffect, useMemo, useState, useRef, useCallback, FormEvent } from 'react';
import { useLocale } from 'next-intl';
import { MessageCircle, Send, AlertCircle, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiGet, apiPost, getApiBaseUrl } from '@/lib/api';
import { getValidatedClientToken } from '@/lib/client-auth';

type SupportThread = {
  id: string;
  memberUserId: string;
  memberName: string;
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

export default function MemberSupportPage() {
  const locale = useLocale();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
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
      if (!activeThreadId && result.length > 0) {
        setActiveThreadId(result[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  }, [activeThreadId]);

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

  // Load messages and setup SSE when thread changes
  useEffect(() => {
    if (!activeThreadId) return;

    const init = async () => {
      await loadMessages(activeThreadId);
      // Use instant scroll on initial load
      setTimeout(() => scrollToBottom('instant'), 100);
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
      scrollToBottom('smooth');
    }
  }, [messages, scrollToBottom]);

  const sendMessage = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;

    setIsSending(true);
    try {
      // Build request body - omit threadId if null to let backend create new thread
      const body: Record<string, unknown> = { message: trimmed };
      if (activeThreadId) {
        body.threadId = activeThreadId;
      }
      
      const data = await apiPost<{ threadId: string; message: string }>(
        '/v1/dashboard/support/messages',
        body
      );
      setMessage('');

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      const createdThreadId = data?.threadId as string | undefined;
      if (createdThreadId && !activeThreadId) {
        setActiveThreadId(createdThreadId);
      }
      void loadThreads();
      if (createdThreadId || activeThreadId) {
        void loadMessages(createdThreadId || activeThreadId!);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      // Show error to user (message stays in input for retry)
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
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  const deleteInText = activeThread?.deleteAt
    ? (() => {
        const ms = new Date(activeThread.deleteAt).getTime() - Date.now();
        const hours = Math.max(0, Math.floor(ms / (1000 * 60 * 60)));
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return locale === 'bn'
          ? `${days} দিন ${remHours} ঘণ্টা পর এই কথোপকথন মুছে যাবে`
          : `Conversation deletes in ${days}d ${remHours}h`;
      })()
    : '';

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
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-10rem)] min-h-[400px] max-h-[800px] mx-auto max-w-3xl">
      {/* Chat Container */}
      <div className="flex flex-col flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-sm">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">
              {locale === 'bn' ? 'হাসনাহেনা সাপোর্ট' : 'Hasnahena Support'}
            </h3>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {locale === 'bn' ? 'সাধারণত কয়েক মিনিটে উত্তর দেয়' : 'Usually replies within minutes'}
            </p>
          </div>
        </div>

        {/* Warning Banner */}
        {deleteInText && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300">{deleteInText}</span>
          </div>
        )}

        {/* Messages Container */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-slate-50 dark:bg-slate-950/50"
          style={{ scrollBehavior: 'smooth' }}
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
              <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                <Smile className="w-8 h-8 text-slate-400" />
              </div>
              <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-1">
                {locale === 'bn' ? 'আমরা সাহায্য করতে এখানে আছি!' : 'We\'re here to help!'}
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                {locale === 'bn'
                  ? 'আপনার প্রশ্ন বা সমস্যা নিচে লিখে পাঠান। আমাদের একজন প্রতিনিধি শীঘ্রই উত্তর দেবেন।'
                  : 'Send us your question or concern below. Our support team will respond shortly.'}
              </p>
            </div>
          ) : (
            <>
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
                    const isSelf = m.senderRole === 'MEMBER';
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
                        <div
                          className={`relative max-w-[85%] sm:max-w-[75%] px-3 py-2 ${
                            isSelf
                              ? `bg-emerald-500 text-white ${
                                  isLastInGroup ? 'rounded-2xl rounded-br-md' : 'rounded-2xl'
                                }`
                              : `bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-100 dark:border-slate-700 ${
                                  isLastInGroup ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl'
                                }`
                          } shadow-sm`}
                        >
                          {!isSelf && isFirstInGroup && (
                            <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mb-0.5">
                              {m.senderName}
                            </p>
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
            </>
          )}
        </div>

        {/* Input Area */}
        <div className="px-3 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <form onSubmit={sendMessage} className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                rows={1}
                className="w-full resize-none rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-shadow"
                placeholder={locale === 'bn' ? 'আপনার বার্তা লিখুন...' : 'Type your message...'}
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
      </div>
    </div>
  );
}
