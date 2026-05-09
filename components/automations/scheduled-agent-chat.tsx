'use client';

import { useRouter } from 'next/navigation';
import { CalendarClock, Loader2, Pause, Play, Send, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type {
  ScheduledAgentExecution,
  ScheduledAgentMessage,
  ScheduledAgentTask,
} from '@/lib/types';
import { cn } from '@/lib/utils';

type PendingMessage = ScheduledAgentMessage & { pending?: boolean };
type TaskRecord = ScheduledAgentTask & Record<string, unknown>;
type ExecutionRecord = ScheduledAgentExecution & Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function taskString(task: TaskRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = task[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function taskStatus(task: TaskRecord) {
  return taskString(task, ['status'], 'draft');
}

function taskTitle(task: TaskRecord) {
  return taskString(task, ['title', 'name'], 'Untitled automation');
}

function taskDescription(task: TaskRecord) {
  return taskString(task, ['description', 'instructions', 'prompt'], '');
}

function taskSchedule(task: TaskRecord) {
  return taskString(task, ['schedule_label', 'schedule', 'cron_expression', 'rrule'], 'Describe a schedule');
}

function executionStatus(execution?: ScheduledAgentExecution | null) {
  const value = execution ? (execution as ExecutionRecord).status : null;
  return typeof value === 'string' && value ? value.replaceAll('_', ' ') : 'No runs yet';
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

function makePendingMessage(
  role: 'user' | 'assistant',
  content: string,
  sortOrder: number,
  taskId: string,
): PendingMessage {
  return {
    id: `pending-${role}-${crypto.randomUUID()}`,
    scheduled_agent_task_id: taskId,
    task_id: taskId,
    role,
    content,
    sort_order: sortOrder,
    metadata: {},
    user_id: 'pending',
    created_at: nowIso(),
    pending: true,
  } as PendingMessage;
}

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'Request failed.';
  } catch {
    return 'Request failed.';
  }
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

export function ScheduledAgentChat({
  task,
  initialMessages,
  latestExecution,
}: {
  task: ScheduledAgentTask;
  initialMessages: ScheduledAgentMessage[];
  latestExecution?: ScheduledAgentExecution | null;
}) {
  const router = useRouter();
  const [currentTask, setCurrentTask] = useState<TaskRecord>(task as TaskRecord);
  const [messages, setMessages] = useState<PendingMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const nextSortOrder = useMemo(
    () => (messages.at(-1)?.sort_order ?? -1) + 1,
    [messages],
  );
  const status = taskStatus(currentTask);
  const isActive = status === 'active';

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busyAction) return;

    const userMessage = makePendingMessage('user', trimmed, nextSortOrder, String(currentTask.id));
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setBusyAction('message');

    try {
      const response = await fetch(`/api/automations/${currentTask.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!response.ok) throw new Error(await getErrorMessage(response));
      const body = (await response.json()) as {
        messages: ScheduledAgentMessage[];
        task?: ScheduledAgentTask;
      };
      if (body.task) setCurrentTask(body.task as TaskRecord);
      setMessages((current) => [
        ...current.filter((message) => message.id !== userMessage.id),
        ...body.messages,
      ]);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to send message.');
      setMessages((current) => current.filter((message) => message.id !== userMessage.id));
    } finally {
      setBusyAction(null);
    }
  }

  async function postTaskAction(
    action: 'draft' | 'activate' | 'pause' | 'run-now',
    successMessage: string,
  ) {
    setBusyAction(action);
    try {
      const response = await fetch(`/api/automations/${currentTask.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'draft' ? JSON.stringify({ prompt: input.trim() || undefined }) : undefined,
      });

      if (!response.ok) throw new Error(await getErrorMessage(response));
      const body = (await response.json()) as {
        task?: ScheduledAgentTask;
        message?: ScheduledAgentMessage;
      };
      if (body.task) setCurrentTask(body.task as TaskRecord);
      if (body.message) setMessages((current) => [...current, body.message as PendingMessage]);
      toast.success(successMessage);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to ${action}.`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.15rem] border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.18)] dark:border-white/[0.12] dark:bg-[#070707]/88 dark:shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
      <header className="flex items-start justify-between gap-4 border-b p-4 dark:border-white/10">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {taskSchedule(currentTask)}
            </span>
            <Badge variant="outline">{statusLabel(status)}</Badge>
          </div>
          <h1 className="truncate text-base font-semibold">{taskTitle(currentTask)}</h1>
          {taskDescription(currentTask) ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {taskDescription(currentTask)}
            </p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Describe the automation in one sentence. The agent will set up the schedule for you.
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
            placeholder="Message the scheduled agent..."
            className="max-h-32 min-h-16 resize-none bg-card dark:border-white/12 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/35"
            disabled={Boolean(busyAction)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              Latest run: {executionStatus(latestExecution)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  postTaskAction(isActive ? 'pause' : 'activate', isActive ? 'Automation paused.' : 'Automation activated.')
                }
                disabled={Boolean(busyAction)}
              >
                {busyAction === 'activate' || busyAction === 'pause' ? (
                  <Loader2 className="animate-spin" />
                ) : isActive ? (
                  <Pause />
                ) : (
                  <Play />
                )}
                {isActive ? 'Pause' : 'Activate'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => postTaskAction('run-now', 'Run requested.')}
                disabled={Boolean(busyAction) || !isActive}
              >
                {busyAction === 'run-now' ? <Loader2 className="animate-spin" /> : <Zap />}
                Run now
              </Button>
              <Button type="submit" disabled={!input.trim() || Boolean(busyAction)}>
                {busyAction === 'message' ? <Loader2 className="animate-spin" /> : <Send />}
                {status === 'draft' ? 'Set up' : 'Send'}
              </Button>
            </div>
          </div>
        </form>
      </footer>
    </section>
  );
}
