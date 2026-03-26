'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { MessageCircle, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiGet, apiPost, getApiBaseUrl } from '@/lib/api';
import { getValidatedClientToken } from '@/lib/client-auth';
import { formatDate } from '@/lib/utils';

type SupportThread = {
  id: string;
  memberUserId: string;
  memberName: string;
  status: string;
  latestMessage: string;
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

export default function MemberSupportPage() {
  const locale = useLocale();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

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
    const url = `${getApiBaseUrl()}/v1/dashboard/support/stream?threadId=${encodeURIComponent(
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
    if (!trimmed) return;
    setIsSending(true);
    try {
      const data = await apiPost<{ threadId: string; message: string }>(
        '/v1/dashboard/support/messages',
        { threadId: activeThreadId, message: trimmed }
      );
      setMessage('');
      const createdThreadId = data?.threadId as string | undefined;
      if (createdThreadId && !activeThreadId) {
        setActiveThreadId(createdThreadId);
      }
      void loadThreads();
      if (createdThreadId || activeThreadId) {
        void loadMessages(createdThreadId || activeThreadId!);
      }
    } finally {
      setIsSending(false);
    }
  };

  const deleteInText = activeThread?.deleteAt
    ? (() => {
        const ms = new Date(activeThread.deleteAt).getTime() - Date.now();
        const hours = Math.max(0, Math.floor(ms / (1000 * 60 * 60)));
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return locale === 'bn'
          ? `${days} দিন ${remHours} ঘণ্টা পর এই কথোপকথন মুছে যাবে`
          : `This conversation will be deleted in ${days}d ${remHours}h`;
      })()
    : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {locale === 'bn' ? 'সাপোর্ট চ্যাট' : 'Support Chat'}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-600" />
            {locale === 'bn' ? 'কথোপকথন' : 'Conversation'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {deleteInText ? <p className="text-xs text-muted-foreground">{deleteInText}</p> : null}
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {messages.map((m) => (
              <div key={m.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>{m.senderName}</span>
                  <span>{formatDate(m.createdAt, locale)}</span>
                </div>
                <p className="text-sm">{m.message}</p>
              </div>
            ))}
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {locale === 'bn' ? 'এখনও কোনো বার্তা নেই' : 'No messages yet'}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={locale === 'bn' ? 'আপনার বার্তা লিখুন...' : 'Write your message...'}
            />
            <Button onClick={sendMessage} disabled={isSending || !message.trim()}>
              <Send className="h-4 w-4 mr-2" />
              {locale === 'bn' ? 'পাঠান' : 'Send'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
