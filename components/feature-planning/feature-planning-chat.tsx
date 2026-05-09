'use client';

import Link from 'next/link';
import { Loader2, Terminal } from 'lucide-react';
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
type PlanningErrorMessage = PendingMessage & { failed?: boolean };

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

function plannerErrorText(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || 'Coding agent failed.');
  if (
    raw.includes('token_revoked') ||
    raw.includes('refresh_token_invalidated') ||
    raw.includes('invalidated oauth token') ||
    raw.includes('refresh token has been invalidated')
  ) {
    return 'Codex authentication on the runner has expired. Reconnect Codex auth for the Forkable runner, then retry the planning chat.';
  }

  const withoutPrefix = raw.replace(/^(Planning|Coding) agent failed:\s*/i, '');
  const firstLine = withoutPrefix.split('\n').find(Boolean) ?? withoutPrefix;
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
}

function MessageBubble({ message }: { message: PendingMessage }) {
  const isUser = message.role === 'user';
  const isFailed = 'failed' in message && message.failed;

  return (
    <div className={cn('flex', isUser && 'justify-end')}>
      <div
        className={cn(
          'max-w-[82%] rounded-[0.65rem] border px-3 py-2 text-sm leading-6',
          isFailed
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : isUser
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
  const [messages, setMessages] = useState<PendingMessage[]>(initialMessages);
  const [plan, setPlan] = useState<ChangeRequestPlan | null>(initialPlan);
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(latestRun ?? null);
  const [input, setInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [planningStatus, setPlanningStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const nextSortOrder = useMemo(
    () => (messages.at(-1)?.sort_order ?? -1) + 1,
    [messages],
  );

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (isSendingMessage) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage = trimmed
      ? makePendingMessage('user', trimmed, nextSortOrder, request.id)
      : null;
    const initialAssistantMessage = makePendingMessage(
      'assistant',
      'Preparing the build...',
      nextSortOrder + (userMessage ? 1 : 0),
      request.id,
    );
    let activeAssistantMessage = initialAssistantMessage;
    setMessages((current) => [
      ...current,
      ...(userMessage ? [userMessage] : []),
      initialAssistantMessage,
    ]);
    setInput('');
    setIsSendingMessage(true);
    setPlanningStatus('Queuing coding agent run');

    try {
      const response = await fetch(`/api/feature-requests/${request.id}/planning-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed || undefined }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(await getErrorMessage(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleEvent = (event: FeaturePlanningStreamEvent | null) => {
        if (!event) return;

        if (event.type === 'delta') {
          setPlanningStatus('Building feature');
        }

        if (event.type === 'message') {
          const nextAssistantMessage = makePendingMessage(
            'assistant',
            'Building the feature now. I will post a short summary when it is shipped.',
            event.payload.message.sort_order + 1,
            request.id,
          );
          setMessages((current) =>
            current
              .map((message) =>
                message.id === activeAssistantMessage.id
                  ? event.payload.message
                  : message,
              )
              .concat(nextAssistantMessage),
          );
          activeAssistantMessage = nextAssistantMessage;
        }

        if (event.type === 'status') {
          setPlanningStatus(event.message);
        }

        if (event.type === 'warning') {
          toast.warning(event.message);
        }

        if (event.type === 'error') {
          const errorMessage = `Coding agent failed: ${plannerErrorText(event.error)}`;
          setMessages((current) =>
            current.map((message): PlanningErrorMessage =>
              message.id === activeAssistantMessage.id
                ? { ...message, content: errorMessage, failed: true, pending: false }
                : message,
            ),
          );
          throw new Error(errorMessage);
        }

        if (event.type === 'done') {
          if (event.payload.plan) setPlan(event.payload.plan);
          if (event.payload.run) setCurrentRun(event.payload.run);
          setMessages((current) =>
            current.map((message) => {
              if (userMessage && message.id === userMessage.id && event.payload.userMessage) {
                return event.payload.userMessage;
              }
              if (message.id === activeAssistantMessage.id) return event.payload.assistantMessage;
              return message;
            }),
          );
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          handleEvent(parseStreamLine(line));
        }
      }

      handleEvent(parseStreamLine(buffer));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const errorText = plannerErrorText(error);
      toast.error(errorText);
      setMessages((current) => {
        const hasInlineError = current.some(
          (message) =>
            message.id === activeAssistantMessage.id &&
            'failed' in message &&
            message.failed,
        );

        if (hasInlineError) return current;

        return current.map((message): PlanningErrorMessage =>
          userMessage && message.id === userMessage.id
            ? { ...message, pending: false }
            : message.id === activeAssistantMessage.id
            ? {
                ...message,
                content: `${message.content.trim() ? `${message.content.trim()}\n\n` : ''}Coding agent failed: ${errorText}`,
                failed: true,
                pending: false,
              }
            : message,
        );
      });
    } finally {
      setIsSendingMessage(false);
      setPlanningStatus(null);
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
        {currentRun ? (
          <Link href={`/feature-runs/${currentRun.id}`} className="shrink-0">
            <Button size="sm" variant="outline">
              Run
            </Button>
          </Link>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The coding agent can build from the request as written. Add a note only if there is something else it should know.
          </p>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {planningStatus ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Terminal className="size-3.5" />
            <span className="capitalize">{planningStatus}</span>
          </div>
        ) : null}
      </div>

      <footer className="border-t bg-background/70 p-3 dark:border-white/10 dark:bg-white/[0.035]">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage(input);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
        >
          <Textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder="Optional note for the coding agent..."
            className="max-h-32 min-h-16 resize-none bg-card dark:border-white/12 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/35"
            disabled={isSendingMessage}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {currentRun ? `Latest run: ${statusLabel(currentRun.status)}` : 'No run queued'}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isSendingMessage}>
                {isSendingMessage ? <Loader2 className="animate-spin" /> : null}
                Build feature
              </Button>
            </div>
          </div>
        </form>
      </footer>
    </section>
  );
}
