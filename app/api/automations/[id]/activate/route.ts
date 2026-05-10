import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { getScheduledAgentTask, updateScheduledAgentTask } from '@/lib/queries';

function getInitialNextRunAt() {
  const next = new Date();
  next.setMinutes(next.getMinutes() + 5, 0, 0);
  return next.toISOString();
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
  parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
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

function nextRunFromCron(cronExpression?: string | null, timezone = 'America/Los_Angeles') {
  const everyMinutes = cronExpression?.trim().match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    return new Date(Date.now() + Math.max(1, Number(everyMinutes[1])) * 60 * 1000).toISOString();
  }

  const parts = cronExpression?.trim().split(/\s+/) ?? [];
  if (parts.length !== 5) return null;
  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = parts;
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || monthRaw !== '*') return null;
  const dayOfMonth = dayOfMonthRaw === '*' ? null : Number(dayOfMonthRaw);
  if (dayOfMonth !== null && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) return null;

  let weekdays: number[] | null = null;
  if (dayOfWeekRaw === '1-5') weekdays = [1, 2, 3, 4, 5];
  else if (dayOfWeekRaw !== '*') {
    const day = Number(dayOfWeekRaw);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    weekdays = [day];
  }

  const now = new Date();
  const nowParts = getTimezoneParts(now, timezone);

  for (let offset = 0; offset <= 370; offset += 1) {
    const next = zonedTimeToUtc(
      {
        year: nowParts.year,
        month: nowParts.month,
        day: nowParts.day + offset,
        hour,
        minute,
        second: 0,
      },
      timezone,
    );
    const nextParts = getTimezoneParts(next, timezone);
    const maxDay = daysInMonth(nextParts.year, nextParts.month);
    if (dayOfMonth !== null && (dayOfMonth > maxDay || nextParts.day !== dayOfMonth)) continue;
    if (weekdays && !weekdays.includes(getTimezoneWeekday(next, timezone))) continue;
    if (next > now) {
      return next.toISOString();
    }
  }

  return null;
}

function getNextRunAt(task: { next_run_at?: string | null; cron_expression?: string | null; schedule_type?: string | null; timezone?: string | null }) {
  if (task.next_run_at) return task.next_run_at;
  if (task.cron_expression) return nextRunFromCron(task.cron_expression, task.timezone || 'America/Los_Angeles');
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

  const nextRunAt = getNextRunAt(task);
  if (task.schedule_type !== 'manual' && !nextRunAt) {
    return NextResponse.json(
      { error: 'This automation has an unsupported schedule. Update the schedule before activating it.' },
      { status: 400 },
    );
  }

  const updatedTask = await updateScheduledAgentTask(
    id,
    {
      status: 'active',
      activated_at: new Date().toISOString(),
      paused_at: null,
      nextRunAt,
      metadata: { ...task.metadata, activated_by: viewer.id },
    },
    token,
  );

  return NextResponse.json({ task: updatedTask });
}
