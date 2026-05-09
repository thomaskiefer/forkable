import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { CreateAutomationButton } from '@/components/automations/create-automation-button';
import { ScheduledAgentChat } from '@/components/automations/scheduled-agent-chat';
import { DeleteRecordButton } from '@/components/delete-record-button';
import { EmptyState } from '@/components/ui/empty-state';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import {
  getScheduledAgentExecutions,
  getScheduledAgentMessages,
  listScheduledAgentTasks,
} from '@/lib/queries';
import type {
  ScheduledAgentExecution,
  ScheduledAgentMessage,
  ScheduledAgentTask,
} from '@/lib/types';
import { cn } from '@/lib/utils';

type TaskRecord = ScheduledAgentTask & Record<string, unknown>;

function getSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function taskString(task: TaskRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = task[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function taskTitle(task: ScheduledAgentTask) {
  return taskString(task as TaskRecord, ['title', 'name'], 'Untitled automation');
}

function taskSchedule(task: ScheduledAgentTask) {
  return taskString(
    task as TaskRecord,
    ['schedule_label', 'schedule', 'cron_expression', 'rrule'],
    'Waiting for schedule',
  );
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ task?: string | string[] }>;
}) {
  const { accessToken: token } = await requireAuthenticatedSession();
  const params = await searchParams;
  const tasks = (await listScheduledAgentTasks(token)) as ScheduledAgentTask[];
  const selectedId = getSearchValue(params?.task);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null;

  const [messages, executions] = selectedTask
    ? await Promise.all([
        getScheduledAgentMessages(selectedTask.id, token) as Promise<ScheduledAgentMessage[]>,
        getScheduledAgentExecutions(selectedTask.id, token) as Promise<ScheduledAgentExecution[]>,
      ])
    : [[], []];

  const latestExecution = executions[0] ?? null;

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] flex-col">
      {tasks.length === 0 || !selectedTask ? (
        <EmptyState
          icon={CalendarClock}
          eyebrow="No automations"
          title="Describe an automation"
          description="Tell the agent what should happen and when. It will set up the schedule."
          action={<CreateAutomationButton />}
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.15rem] border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.18)] dark:border-white/[0.12] dark:bg-[#070707]/88 dark:shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
            <div className="flex items-center justify-between gap-3 border-b p-3 dark:border-white/10">
              <h1 className="text-sm font-semibold">Automations</h1>
              <CreateAutomationButton />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tasks.map((task) => {
                const isSelected = task.id === selectedTask.id;

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'flex items-start gap-2 border-b px-3 py-3 transition-colors',
                      'dark:border-white/10',
                      isSelected
                        ? 'bg-accent/45 dark:bg-white/[0.08]'
                        : 'hover:bg-accent/25 dark:hover:bg-white/[0.055]',
                    )}
                  >
                    <Link
                      href={`/automations?task=${task.id}`}
                      aria-current={isSelected ? 'page' : undefined}
                      className="min-w-0 flex-1 space-y-1"
                    >
                      <p className="line-clamp-2 text-sm font-medium leading-5">
                        {taskTitle(task)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {taskSchedule(task)}
                      </p>
                    </Link>
                    <DeleteRecordButton
                      endpoint={`/api/automations/${task.id}`}
                      label="automation"
                      redirectTo="/automations"
                    />
                  </div>
                );
              })}
            </div>
          </aside>

          <ScheduledAgentChat
            key={selectedTask.id}
            task={selectedTask}
            initialMessages={messages}
            latestExecution={latestExecution}
          />
        </div>
      )}
    </div>
  );
}
