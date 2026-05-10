import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  addScheduledAgentMessages,
  getScheduledAgentMessages,
  getScheduledAgentTask,
  updateScheduledAgentTask,
} from '@/lib/queries';
import { normalizeRunnerUrl, runnerEndpointUrl, runnerRequestError } from '@/lib/runner-url';
import type { ScheduledAgentMessage, ScheduledAgentTask } from '@/lib/types';

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
  runAt?: string | null;
  scheduleLabel?: string | null;
  scheduleType?: 'manual' | 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
  timezone?: string;
  assistantMessage?: string;
  toolCall?: {
    name?: string;
    arguments?: AutomationRegistration;
  };
};

type AutomationRegistration = {
  title?: string;
  prompt?: string;
  cronExpression?: string | null;
  runAt?: string | null;
  scheduleLabel?: string | null;
  scheduleType?: 'manual' | 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
  timezone?: string;
};

type IntervalUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

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
  const intervalNextRun = nextRunFromIntervalExpression(cronExpression);
  if (intervalNextRun) return intervalNextRun;

  const everyMinutes = cronExpression?.trim().match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    const interval = Math.max(1, Number(everyMinutes[1]));
    return new Date(Date.now() + interval * 60 * 1000).toISOString();
  }

  const cron = parseCronExpression(cronExpression);
  if (!cron) return null;
  const now = new Date();
  const nowParts = getTimezoneParts(now, timezone);

  for (let offset = 0; offset <= 370; offset += 1) {
    const candidate = zonedTimeToUtc(
      {
        year: nowParts.year,
        month: nowParts.month,
        day: nowParts.day + offset,
        hour: cron.hour,
        minute: cron.minute,
        second: 0,
      },
      timezone,
    );
    const candidateParts = getTimezoneParts(candidate, timezone);
    const maxDay = daysInMonth(candidateParts.year, candidateParts.month);

    if (cron.dayOfMonth !== null && (cron.dayOfMonth > maxDay || candidateParts.day !== cron.dayOfMonth)) {
      continue;
    }
    if (cron.weekdays && !cron.weekdays.includes(getTimezoneWeekday(candidate, timezone))) {
      continue;
    }
    if (candidate > now) {
      return candidate.toISOString();
    }
  }

  return null;
}

function getTimezoneWeekday(date: Date, timezone: string) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseCronExpression(cronExpression?: string | null) {
  const parts = cronExpression?.trim().split(/\s+/) ?? [];
  if (parts.length !== 5) return null;

  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = parts;
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (monthRaw !== '*') return null;

  const dayOfMonth = dayOfMonthRaw === '*' ? null : Number(dayOfMonthRaw);
  if (dayOfMonth !== null && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
    return null;
  }

  let weekdays: number[] | null = null;
  if (dayOfWeekRaw === '*') {
    weekdays = null;
  } else if (dayOfWeekRaw === '1-5') {
    weekdays = [1, 2, 3, 4, 5];
  } else {
    const day = Number(dayOfWeekRaw);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    weekdays = [day];
  }

  return { minute, hour, dayOfMonth, weekdays };
}

function normalizeIntervalUnit(unit: string): IntervalUnit | null {
  const value = unit.trim().toLowerCase();
  if (/^(s|sec|secs|second|seconds)$/.test(value)) return 'second';
  if (/^(m|min|mins|minute|minutes)$/.test(value)) return 'minute';
  if (/^(h|hr|hrs|hour|hours)$/.test(value)) return 'hour';
  if (/^(d|day|days)$/.test(value)) return 'day';
  if (/^(w|wk|wks|week|weeks)$/.test(value)) return 'week';
  if (/^(mo|mon|mons|month|months)$/.test(value)) return 'month';
  if (/^(y|yr|yrs|year|years)$/.test(value)) return 'year';
  return null;
}

function addInterval(date: Date, amount: number, unit: IntervalUnit) {
  const next = new Date(date);
  if (unit === 'second') next.setSeconds(next.getSeconds() + amount);
  if (unit === 'minute') next.setMinutes(next.getMinutes() + amount);
  if (unit === 'hour') next.setHours(next.getHours() + amount);
  if (unit === 'day') next.setDate(next.getDate() + amount);
  if (unit === 'week') next.setDate(next.getDate() + amount * 7);
  if (unit === 'month') next.setMonth(next.getMonth() + amount);
  if (unit === 'year') next.setFullYear(next.getFullYear() + amount);
  return next;
}

function parseIntervalExpression(value?: string | null) {
  const text = value?.trim();
  if (!text) return null;

  const encoded = text.match(/^interval:(\d+):(second|minute|hour|day|week|month|year)s?$/i);
  if (encoded) {
    return { amount: Number(encoded[1]), unit: encoded[2].toLowerCase() as IntervalUnit };
  }

  const natural = text.match(/\bevery\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|mons|month|months|y|yr|yrs|year|years)\b/i);
  if (!natural?.[1] || !natural[2]) return null;
  const unit = normalizeIntervalUnit(natural[2]);
  if (!unit) return null;
  return { amount: Number(natural[1]), unit };
}

function nextRunFromIntervalExpression(value?: string | null) {
  const interval = parseIntervalExpression(value);
  if (!interval || !Number.isInteger(interval.amount) || interval.amount <= 0) return null;
  return addInterval(new Date(), interval.amount, interval.unit).toISOString();
}

function intervalExpression(amount: number, unit: IntervalUnit) {
  return `interval:${amount}:${unit}`;
}

function intervalLabel(amount: number, unit: IntervalUnit) {
  return `Every ${amount} ${unit}${amount === 1 ? '' : 's'}`;
}

function futureRunAt(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date <= new Date()) return null;
  return date.toISOString();
}

function hasRelativeTime(value: string) {
  return /\bin\s+\d{1,4}\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|mons|month|months|y|yr|yrs|year|years)\b/i.test(value);
}

function isOnlyRelativeTime(value: string) {
  return /^\s*in\s+\d{1,4}\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|mons|month|months|y|yr|yrs|year|years)\s*$/i.test(value);
}

function isOnceConfirmation(value: string) {
  return /^(?:(?:just\s+)?once|one[-\s]?time|single\s+run|just\s+one\s+time)$/i.test(value.trim());
}

function relativeTimeMatch(value: string) {
  return value.match(/\bin\s+(\d{1,4})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|mons|month|months|y|yr|yrs|year|years)\b/i);
}

function cleanPrompt(value: string) {
  return value
    .replace(/\bin\s+\d{1,4}\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|mons|month|months|y|yr|yrs|year|years)\b/ig, '')
    .replace(/\bevery\s+\d{1,4}\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mon|mons|month|months|y|yr|yrs|year|years)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,.!?;:]+$/g, '');
}

function repairIntervalRegistration(input: {
  text: string;
  history: ScheduledAgentMessage[];
  registration: AutomationRegistration | null;
}): AutomationRegistration | null {
  const candidates = [
    input.text,
    input.registration?.cronExpression ?? '',
    input.registration?.scheduleLabel ?? '',
    ...input.history.filter((message) => message.role === 'user').map((message) => message.content).reverse(),
  ];
  const interval = candidates.map(parseIntervalExpression).find(Boolean);
  if (!interval || !Number.isInteger(interval.amount) || interval.amount <= 0) return null;

  const prompt = cleanPrompt(input.text) ||
    input.registration?.prompt?.trim() ||
    inferPromptFromHistory(input.history);
  if (!prompt) return null;

  return {
    ...input.registration,
    title: input.registration?.title?.trim() || (/slack/i.test(prompt) ? 'Slack summary' : prompt.slice(0, 80)),
    prompt,
    cronExpression: intervalExpression(interval.amount, interval.unit),
    runAt: null,
    scheduleLabel: intervalLabel(interval.amount, interval.unit),
    scheduleType: 'cron',
    timezone: input.registration?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
  };
}

function inferPromptFromHistory(history: ScheduledAgentMessage[]) {
  return [...history]
    .reverse()
    .filter((message) => message.role === 'user')
    .map((message) => cleanPrompt(message.content))
    .find((content) => content && !isOnceConfirmation(content) && !isOnlyRelativeTime(content)) ?? '';
}

function repairRelativeOneShotRegistration(input: {
  text: string;
  history: ScheduledAgentMessage[];
  registration: AutomationRegistration | null;
}): AutomationRegistration | null {
  const userHistory = input.history.filter((message) => message.role === 'user');
  const latestWithRelativeTime = hasRelativeTime(input.text)
    ? input.text
    : [...userHistory].reverse().find((message) => hasRelativeTime(message.content))?.content ?? '';
  const match = relativeTimeMatch(latestWithRelativeTime);
  if (!match?.[1] || !match[2]) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = normalizeIntervalUnit(match[2]);
  if (!unit) return null;

  const label = `${amount} ${unit}${amount === 1 ? '' : 's'}`;
  const prompt = cleanPrompt(latestWithRelativeTime) ||
    input.registration?.prompt?.trim() ||
    inferPromptFromHistory(input.history);
  if (!prompt) return null;

  const title = input.registration?.title?.trim() ||
    (/slack/i.test(prompt) ? 'Slack summary' : prompt.slice(0, 80));

  return {
    ...input.registration,
    title,
    prompt,
    cronExpression: null,
    runAt: addInterval(new Date(), amount, unit).toISOString(),
    scheduleLabel: `Once in ${label}`,
    scheduleType: 'once',
    timezone: input.registration?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
  };
}

function getRegistration(setup: AutomationSetupResult): AutomationRegistration | null {
  if (
    setup.toolCall?.name === 'register_automation' &&
    setup.toolCall.arguments &&
    typeof setup.toolCall.arguments === 'object'
  ) {
    return setup.toolCall.arguments;
  }

  if (setup.status === 'configured') {
    return {
      title: setup.title,
      prompt: setup.prompt,
      cronExpression: setup.cronExpression,
      runAt: setup.runAt,
      scheduleLabel: setup.scheduleLabel,
      scheduleType: setup.scheduleType,
      timezone: setup.timezone,
    };
  }

  return null;
}

async function requestAutomationSetupFromRunner(input: {
  message: string;
  task: ScheduledAgentTask;
  history: Array<Pick<ScheduledAgentMessage, 'role' | 'content'>>;
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
  const history = await getScheduledAgentMessages(id, token);

  let setup: AutomationSetupResult;
  try {
    setup = await requestAutomationSetupFromRunner({
      message: text,
      task,
      history: history.slice(-10).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to set up automation on Compute.',
      },
      { status: 503 },
    );
  }

  const rawRegistration = getRegistration(setup);
  const registration = repairIntervalRegistration({ text, history, registration: rawRegistration }) ??
    (rawRegistration && !futureRunAt(rawRegistration.runAt) && !rawRegistration.cronExpression
      ? repairRelativeOneShotRegistration({ text, history, registration: rawRegistration }) ?? rawRegistration
      : rawRegistration);
  const nextRunAt = registration
    ? futureRunAt(registration.runAt) ??
      nextRunFromCronInTimezone(
        registration.cronExpression,
        registration.timezone || 'America/Los_Angeles',
      )
    : null;
  const canSetUp = Boolean(registration && nextRunAt);
  const invalidSchedule = Boolean(registration && !nextRunAt);
  const prompt = registration?.prompt?.trim() || setup.prompt?.trim() || text;
  const title = registration?.title?.trim() || setup.title?.trim() || task.title || 'Scheduled automation';
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
          scheduleType: registration?.runAt ? 'once' : registration?.scheduleType || 'cron',
          cronExpression: registration?.runAt ? null : registration?.cronExpression,
          schedule_label: registration?.scheduleLabel || registration?.cronExpression || 'Once',
          timezone: registration?.timezone || 'America/Los_Angeles',
          nextRunAt,
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
  const draftTask = !canSetUp && !invalidSchedule && (setup.prompt?.trim() || setup.title?.trim())
    ? await updateScheduledAgentTask(
        id,
        {
          title,
          name: title,
          description: prompt,
          instructions: prompt,
          prompt,
          draft_prompt: prompt,
          metadata: {
            ...task.metadata,
            source: 'automation_chat',
            setup_pending: true,
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
              `Set up and activated. I will run this automation ${(registration?.scheduleLabel || setup.scheduleLabel || 'on schedule').toLowerCase()}.`
          : invalidSchedule
            ? 'I could not activate that schedule. Use a daily, weekday, weekly, monthly day-of-month, or every-N interval such as every 10 seconds, every 2 hours, every 3 weeks, or every 6 months.'
          : setup.assistantMessage ||
              'I have the task. Tell me when it should run, for example: "every day at 3:23 PM PT."',
      ),
    ],
    viewer.id,
    token,
  );

  return NextResponse.json({ messages, task: updatedTask ?? draftTask ?? task });
}
