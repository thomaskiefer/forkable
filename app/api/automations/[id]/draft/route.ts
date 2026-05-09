import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  addScheduledAgentMessages,
  getScheduledAgentTask,
  updateScheduledAgentTask,
} from '@/lib/queries';
import type { ScheduledAgentMessage } from '@/lib/types';

function message(content: string) {
  return {
    role: 'assistant' as const,
    content,
    metadata: {},
  };
}

function getDefaultNextRunAt() {
  const next = new Date();
  next.setMinutes(next.getMinutes() + 5, 0, 0);
  return next.toISOString();
}

export async function POST(
  request: Request,
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

  const body = (await request.json().catch(() => ({}))) as { prompt?: string };
  const prompt = body.prompt?.trim() || task.prompt || task.instructions || task.description;
  const taskUpdate = {
    status: 'draft' as const,
    prompt,
    instructions: prompt,
    customerName: task.customer_name,
    customerEmail: task.customer_email,
    taskType: task.task_type || 'monitor_context',
    featureKey: task.feature_key || null,
    scheduleType: 'cron' as const,
    cronExpression: task.cron_expression || '0 8 * * 1-5',
    schedule_label: task.schedule_label || 'Weekdays at 8:00 AM',
    timezone: task.timezone || 'America/Los_Angeles',
    nextRunAt: task.next_run_at ?? getDefaultNextRunAt(),
    draft_prompt: prompt,
    metadata: {
      ...task.metadata,
      source: 'automation_chat',
    },
  };

  const updatedTask = await updateScheduledAgentTask(id, taskUpdate, token);
  const [draftMessage] = (await addScheduledAgentMessages(
    id,
    [
      message(
        'Draft schedule saved. Review the timing fields, then activate the automation.',
      ),
    ],
    viewer.id,
    token,
  )) as ScheduledAgentMessage[];

  return NextResponse.json({ task: updatedTask, message: draftMessage });
}
