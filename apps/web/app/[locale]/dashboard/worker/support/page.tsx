'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { CheckCircle2, MessageCircle, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiGet, apiPost, getApiBaseUrl } from '@/lib/api';
import { getValidatedClientToken } from '@/lib/client-auth';
import { formatDate } from '@/lib/utils';

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

export default function WorkerSupportPage() {
  const locale = useLocale();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [message, setMessage] = useState('');

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const loadThreads = async () => {
    const result = await apiGet<SupportThread[]>('/v1/dashboard/support/threads');
    setThreads(result);
    if (!activeThreadId && result.length > 0) {
      setActiveThreadId(result[0].id);
    }
  };

  const loadMessages = async (threadId: string) => {
    const result = await apiGet<SupportMessage[]>(
      `/v1/dashboard/support/messages?threadId=${encodeURIComponent(threadId)}`
    );
    setMessages(result);
  };

  useEffect(() => {
    void loadThreads();
    const timer = setInterval(() => {
      void loadThreads();
      if (activeThreadId) {
        void loadMessages(activeThreadId);
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;
    void loadMessages(activeThreadId);
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
  }, [activeThreadId]);

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || !activeThreadId) return;
    await apiPost('/v1/dashboard/support/messages', { threadId: activeThreadId, message: trimmed });
    setMessage('');
    void loadMessages(activeThreadId);
    void loadThreads();
  };

  const markProcessed = async () => {
    if (!activeThreadId) return;
    await apiPost('/v1/dashboard/support/threads/processed', { threadId: activeThreadId });
    void loadThreads();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[360px,1fr]">
      <Card className="h-[calc(100vh-220px)] overflow-hidden">
        <CardHeader>
          <CardTitle>{locale === 'bn' ? 'সাপোর্ট ইনবক্স' : 'Support Inbox'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 overflow-y-auto h-[calc(100%-76px)]">
          {threads.map((t) => (
            <button
              key={t.id}
              className={`w-full text-left rounded-lg border px-3 py-2 ${
                activeThreadId === t.id ? 'border-emerald-500 bg-emerald-50' : ''
              }`}
              onClick={() => setActiveThreadId(t.id)}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{t.memberName}</p>
                <span className="text-xs text-muted-foreground">{formatDate(t.latestAt, locale)}</span>
              </div>
              <p className="text-sm text-muted-foreground truncate">{t.latestMessage}</p>
              <p className="text-xs mt-1">
                {t.status === 'PROCESSED'
                  ? locale === 'bn'
                    ? 'সমাধান করা হয়েছে'
                    : 'Processed'
                  : locale === 'bn'
                    ? 'অমীমাংসিত'
                    : 'Open'}
              </p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="h-[calc(100vh-220px)] overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-emerald-600" />
              {activeThread ? activeThread.memberName : locale === 'bn' ? 'বার্তা' : 'Messages'}
            </span>
            {activeThread && activeThread.status !== 'PROCESSED' ? (
              <Button size="sm" variant="outline" onClick={markProcessed}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {locale === 'bn' ? 'প্রসেসড' : 'Mark processed'}
              </Button>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[calc(100%-76px)] flex flex-col">
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {messages.map((m) => (
              <div key={m.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>{m.senderName}</span>
                  <span>{formatDate(m.createdAt, locale)}</span>
                </div>
                <p className="text-sm">{m.message}</p>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t mt-3 flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={locale === 'bn' ? 'রিপ্লাই লিখুন...' : 'Write reply...'}
              disabled={!activeThreadId}
            />
            <Button onClick={sendMessage} disabled={!activeThreadId || !message.trim()}>
              <Send className="h-4 w-4 mr-2" />
              {locale === 'bn' ? 'পাঠান' : 'Send'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
