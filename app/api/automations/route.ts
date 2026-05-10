import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  addScheduledAgentMessages,
  createScheduledAgentTask,
  getCompanyAccountForEmail,
  listScheduledAgentTasks,
} from '@/lib/queries';
import type { ScheduledAgentMessage, ScheduledAgentTask } from '@/lib/types';

function taskMessage(role: 'user' | 'assistant', content: string) {
  return {
    role,
    content,
    metadata: {},
  };
}

export async function GET() {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tasks = await listScheduledAgentTasks(token);
  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated || !viewer.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    name?: string;
    description?: string;
    instructions?: string;
    prompt?: string;
    customer_name?: string;
    customer_email?: string;
    feature_key?: string;
    schedule?: string;
    schedule_label?: string;
    cron_expression?: string;
    status?: string;
    message?: string;
  };

  const title = (body.title ?? body.name ?? 'New scheduled agent').trim();
  const prompt = (body.message ?? body.prompt ?? body.instructions ?? body.description ?? '').trim();
  const requesterEmail = viewer.email?.trim().toLowerCase() ?? '';

  if (!requesterEmail) {
    return NextResponse.json(
      { error: 'Your account needs an email before it can create automations.' },
      { status: 400 },
    );
  }

  const company = await getCompanyAccountForEmail(requesterEmail, token);
  if (!company) {
    return NextResponse.json(
      { error: 'Your login is not mapped to a company account yet.' },
      { status: 400 },
    );
  }

  const task = (await createScheduledAgentTask(
    {
      title,
      description: body.description ?? prompt,
      instructions: body.instructions ?? prompt,
      prompt,
      customerName: company.name,
      customerEmail: requesterEmail,
      companyAccountId: company.id,
      featureKey: body.feature_key ?? null,
      scheduleType: body.cron_expression ? 'cron' : 'manual',
      cronExpression: body.cron_expression ?? null,
      schedule_label: body.schedule_label ?? body.schedule ?? null,
      metadata: {
        name: body.name,
        schedule: body.schedule,
        source: 'automation_chat',
      },
      status: body.status ?? 'draft',
      userId: viewer.id,
    },
    token,
  )) as ScheduledAgentTask;

  let messages: ScheduledAgentMessage[] = [];
  if (task && prompt) {
    messages = (await addScheduledAgentMessages(
      task.id,
      [
        taskMessage('user', prompt),
        taskMessage(
          'assistant',
          'Draft task created. Add scheduling details, then activate it when ready.',
        ),
      ],
      viewer.id,
      token,
    )) as ScheduledAgentMessage[];
  }

  return NextResponse.json({ task, messages }, { status: 201 });
}
