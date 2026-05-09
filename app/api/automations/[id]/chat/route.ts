import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  addScheduledAgentMessages,
  getScheduledAgentTask,
  updateScheduledAgentTask,
} from '@/lib/queries';
import { normalizeRunnerUrl, runnerEndpointUrl, runnerRequestError } from '@/lib/runner-url';
import type { ScheduledAgentTask } from '@/lib/types';

function taskMessage(role: 'user' | 'assistant', content: string) {
  return {
    role,
    content,
    metadata: {},
  };
}

type AutomationSetupResult = {
  status?: 'configured' | 'needs_more_info';
  title?: string;
  prompt?: string;
  cronExpression?: string | null;
  scheduleLabel?: string | null;
  scheduleType?: 'manual' | 'daily' | 'weekly' | 'monthly' | 'cron';
  timezone?: string;
  assistantMessage?: string;
};

function getRunnerConfig() {
  const runnerUrl = normalizeRunnerUrl(process.env.FORKABLE_AGENT_RUNNER_URL);
  const webhookSecret = process.env.FORKABLE_RUNNER_WEBHOOK_SECRET;
  if (!runnerUrl || !webhookSecret) return null;
  return { runnerUrl, webhookSecret };
}

function getTimezoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zonedTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timezone: string,
) {
  const utcGuess = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
    0,
  ));
  const actualParts = getTimezoneParts(utcGuess, timezone);
  const actualAsUtc = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  );
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
    0,
  );

  return new Date(utcGuess.getTime() + desiredAsUtc - actualAsUtc);
}

function nextRunFromCronInTimezone(cronExpression?: string | null, timezone = 'America/Los_Angeles') {
  const everyMinutes = cronExpression?.trim().match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    const interval = Math.max(1, Number(everyMinutes[1]));
    return new Date(Date.now() + interval * 60 * 1000).toISOString();
  }

  const match = cronExpression?.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/);
  if (!match) return null;

  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  const now = new Date();
  const nowParts = getTimezoneParts(now, timezone);
  const targetParts = {
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day,
    hour,
    minute,
    second: 0,
  };
  let next = zonedTimeToUtc(targetParts, timezone);
  if (next <= now) {
    next = zonedTimeToUtc(
      {
        ...targetParts,
        day: targetParts.day + 1,
      },
      timezone,
    );
  }

  if (match[3] === '1-5') {
    while ([0, 6].includes(getTimezoneWeekday(next, timezone))) {
      const nextParts = getTimezoneParts(next, timezone);
      next = zonedTimeToUtc(
        {
          year: nextParts.year,
          month: nextParts.month,
          day: nextParts.day + 1,
          hour,
          minute,
          second: 0,
        },
        timezone,
      );
    }
  }

  return next.toISOString();
}

function getTimezoneWeekday(date: Date, timezone: string) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}

async function requestAutomationSetupFromRunner(input: {
  message: string;
  task: ScheduledAgentTask;
}) {
  const runner = getRunnerConfig();
  if (!runner) {
    throw new Error(
      'Automation setup requires the InsForge Compute runner. Set FORKABLE_AGENT_RUNNER_URL and FORKABLE_RUNNER_WEBHOOK_SECRET.',
    );
  }

  const endpoint = '/automation-setup';
  const response = await fetch(runnerEndpointUrl(runner.runnerUrl, endpoint), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runner.webhookSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const body = (await response.json().catch(() => ({}))) as {
    setup?: AutomationSetupResult;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(runnerRequestError(endpoint, response.status, body.error));
  }

  if (!body.setup) {
    throw new Error('Compute runner did not return automation setup details.');
  }

  return body.setup;
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

  const body = (await request.json()) as { message?: string };
  const text = body.message?.trim();
  if (!text) {
    return NextResponse.json({ error: 'message is required.' }, { status: 400 });
  }

  let setup: AutomationSetupResult;
  try {
    setup = await requestAutomationSetupFromRunner({ message: text, task });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to set up automation on Compute.',
      },
      { status: 503 },
    );
  }

  const canSetUp = setup.status === 'configured' && Boolean(setup.cronExpression);
  const prompt = setup.prompt?.trim() || text;
  const title = setup.title?.trim() || task.title || 'Scheduled automation';
  const updatedTask = canSetUp
    ? await updateScheduledAgentTask(
        id,
        {
          title,
          name: title,
          description: prompt,
          instructions: prompt,
          prompt,
          status: 'active',
          scheduleType: setup.scheduleType || 'cron',
          cronExpression: setup.cronExpression,
          schedule_label: setup.scheduleLabel || setup.cronExpression,
          timezone: setup.timezone || 'America/Los_Angeles',
          nextRunAt: nextRunFromCronInTimezone(
            setup.cronExpression,
            setup.timezone || 'America/Los_Angeles',
          ),
          activated_at: new Date().toISOString(),
          paused_at: null,
          draft_prompt: prompt,
          metadata: {
            ...task.metadata,
            source: 'automation_chat',
            setup_by_agent: true,
            setup_runner: 'insforge_compute_codex',
          },
        },
        token,
      )
    : null;

  const messages = await addScheduledAgentMessages(
    id,
    [
      taskMessage('user', text),
      taskMessage(
        'assistant',
        canSetUp
          ? setup.assistantMessage ||
              `Set up and activated. I will run this automation ${setup.scheduleLabel?.toLowerCase()}.`
          : setup.assistantMessage ||
              'I have the task. Tell me when it should run, for example: "every day at 3:23 PM PT."',
      ),
    ],
    viewer.id,
    token,
  );

  return NextResponse.json({ messages, task: updatedTask ?? task });
}
