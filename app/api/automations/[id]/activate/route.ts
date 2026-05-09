import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { getScheduledAgentTask, updateScheduledAgentTask } from '@/lib/queries';

function getInitialNextRunAt() {
  const next = new Date();
  next.setMinutes(next.getMinutes() + 5, 0, 0);
  return next.toISOString();
}

function nextRunFromCron(cronExpression?: string | null) {
  const everyMinutes = cronExpression?.trim().match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    return new Date(Date.now() + Math.max(1, Number(everyMinutes[1])) * 60 * 1000).toISOString();
  }

  const match = cronExpression?.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/);
  if (!match) return null;

  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);

  if (match[3] === '1-5') {
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
  }

  return next.toISOString();
}

function getNextRunAt(task: { next_run_at?: string | null; cron_expression?: string | null; schedule_type?: string | null }) {
  if (task.next_run_at) return task.next_run_at;
  if (task.cron_expression) return nextRunFromCron(task.cron_expression);
  if (task.schedule_type === 'manual') return null;
  return getInitialNextRunAt();
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { viewer, accessToken: token } = await getAuthenticatedSession();

  if (!viewer.isAuthenticated || !viewer.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const task = await getScheduledAgentTask(id, token);
  if (!task) {
    return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
  }

  if (!task.prompt?.trim() && !task.instructions?.trim() && !task.description?.trim()) {
    return NextResponse.json(
      { error: 'Add automation instructions before activating it.' },
      { status: 400 },
    );
  }

  if (!task.next_run_at && !task.cron_expression && task.schedule_type !== 'manual') {
    return NextResponse.json(
      { error: 'Add a valid schedule before activating this automation.' },
      { status: 400 },
    );
  }

  const updatedTask = await updateScheduledAgentTask(
    id,
    {
      status: 'active',
      activated_at: new Date().toISOString(),
      paused_at: null,
      nextRunAt: getNextRunAt(task),
      metadata: { ...task.metadata, activated_by: viewer.id },
    },
    token,
  );

  return NextResponse.json({ task: updatedTask });
}
