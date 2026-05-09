'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type {
  AgentRun,
  ChangeRequest,
  ChangeRequestPlan,
  ChangeRequestPlanningMessage,
  FeaturePlanningStreamEvent,
} from '@/lib/types';
import { cn } from '@/lib/utils';

type PendingMessage = ChangeRequestPlanningMessage & { pending?: boolean };

function nowIso() {
  return new Date().toISOString();
}

function makePendingMessage(
  role: 'user' | 'assistant',
  content: string,
  sortOrder: number,
  requestId: string,
): PendingMessage {
  return {
    id: `pending-${role}-${crypto.randomUUID()}`,
    change_request_id: requestId,
    role,
    content,
    sort_order: sortOrder,
    metadata: {},
    user_id: 'pending',
    created_at: nowIso(),
    pending: true,
  };
}

function parseStreamLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as FeaturePlanningStreamEvent;
}

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'Request failed.';
  } catch {
    return 'Request failed.';
  }
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

function MessageBubble({ message }: { message: PendingMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser && 'justify-end')}>
      <div
        className={cn(
          'max-w-[82%] rounded-[0.65rem] border px-3 py-2 text-sm leading-6',
          isUser
            ? 'border-primary/20 bg-primary text-primary-foreground'
            : 'bg-background dark:border-white/10 dark:bg-white/[0.055]',
          message.pending && 'opacity-70',
        )}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}

export function FeaturePlanningChat({
  request,
  initialMessages,
  initialPlan,
  latestRun,
}: {
  request: ChangeRequest;
  initialMessages: ChangeRequestPlanningMessage[];
  initialPlan: ChangeRequestPlan | null;
  latestRun?: AgentRun | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<PendingMessage[]>(initialMessages);
  const [plan, setPlan] = useState<ChangeRequestPlan | null>(initialPlan);
  const [input, setInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSendingAgent, setIsSendingAgent] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const nextSortOrder = useMemo(
    () => (messages.at(-1)?.sort_order ?? -1) + 1,
    [messages],
  );

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSendingMessage) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage = makePendingMessage('user', trimmed, nextSortOrder, request.id);
    const assistantMessage = makePendingMessage('assistant', '', nextSortOrder + 1, request.id);
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput('');
    setIsSendingMessage(true);

    try {
      const response = await fetch(`/api/feature-requests/${request.id}/planning-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(await getErrorMessage(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const event = parseStreamLine(line);
          if (!event) continue;

          if (event.type === 'delta') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: `${message.content}${event.content}` }
                  : message,
              ),
            );
          }

          if (event.type === 'warning') {
            toast.warning(event.message);
          }

          if (event.type === 'error') {
            throw new Error(event.error);
          }

          if (event.type === 'done') {
            setMessages((current) =>
              current.map((message) => {
                if (message.id === userMessage.id) return event.payload.userMessage;
                if (message.id === assistantMessage.id) return event.payload.assistantMessage;
                return message;
              }),
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error(error instanceof Error ? error.message : 'Unable to send message.');
      setMessages((current) =>
        current.filter(
          (message) => message.id !== userMessage.id && message.id !== assistantMessage.id,
        ),
      );
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function draftPlan() {
    setIsDrafting(true);
    try {
      const response = await fetch(`/api/feature-requests/${request.id}/planning-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'finalized' }),
      });

      if (!response.ok) throw new Error(await getErrorMessage(response));
      const body = (await response.json()) as { plan: ChangeRequestPlan };
      setPlan(body.plan);
      toast.success('Plan drafted.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to draft plan.');
    } finally {
      setIsDrafting(false);
    }
  }

  async function sendToAgent() {
    setIsSendingAgent(true);
    try {
      const response = await fetch(`/api/feature-requests/${request.id}/agent-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan?.id }),
      });

      if (!response.ok) throw new Error(await getErrorMessage(response));
      const body = (await response.json()) as { run: { id: string } };
      toast.success('Coding agent run queued.');
      router.push(`/feature-runs/${body.run.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to queue coding agent.');
    } finally {
      setIsSendingAgent(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.15rem] border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.18)] dark:border-white/[0.12] dark:bg-[#070707]/88 dark:shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
      <header className="flex items-start justify-between gap-4 border-b p-4 dark:border-white/10">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{request.customer_name}</span>
            <span>{request.customer_email}</span>
            <Badge variant="outline">{statusLabel(request.status)}</Badge>
            {plan ? <Badge>{statusLabel(plan.status)}</Badge> : null}
          </div>
          <h1 className="truncate text-base font-semibold">{request.title}</h1>
        </div>
        {latestRun ? (
          <Link href={`/feature-runs/${latestRun.id}`} className="shrink-0">
            <Button size="sm" variant="outline">
              Run
            </Button>
          </Link>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chat through the request, then draft a plan.
          </p>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
      </div>

      <footer className="border-t bg-background/70 p-3 dark:border-white/10 dark:bg-white/[0.035]">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder="Message the planning agent..."
            className="max-h-32 min-h-16 resize-none bg-card dark:border-white/12 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/35"
            disabled={isSendingMessage}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {latestRun ? `Latest run: ${statusLabel(latestRun.status)}` : 'No run queued'}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={draftPlan}
                disabled={isDrafting || isSendingAgent}
              >
                {isDrafting ? <Loader2 className="animate-spin" /> : null}
                Draft plan
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={sendToAgent}
                disabled={isDrafting || isSendingAgent}
              >
                {isSendingAgent ? <Loader2 className="animate-spin" /> : null}
                Send to agent
              </Button>
              <Button type="submit" disabled={!input.trim() || isSendingMessage}>
                {isSendingMessage ? <Loader2 className="animate-spin" /> : null}
                Send
              </Button>
            </div>
          </div>
        </form>
      </footer>
    </section>
  );
}
