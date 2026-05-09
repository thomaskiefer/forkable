import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { getScheduledAgentTask } from '@/lib/queries';

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

  const runnerUrl = process.env.FORKABLE_AGENT_RUNNER_URL;
  const webhookSecret = process.env.FORKABLE_RUNNER_WEBHOOK_SECRET;
  if (!runnerUrl || !webhookSecret) {
    return NextResponse.json(
      {
        error:
          'Runner is not configured. Set FORKABLE_AGENT_RUNNER_URL and FORKABLE_RUNNER_WEBHOOK_SECRET to run automations.',
      },
      { status: 503 },
    );
  }

  const response = await fetch(
    `${runnerUrl.replace(/\/$/, '')}/scheduled-tasks/${id}/run-now`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${webhookSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requestedBy: viewer.id }),
    },
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          typeof body.error === 'string'
            ? body.error
            : 'Runner rejected the run-now request.',
      },
      { status: response.status },
    );
  }

  return NextResponse.json({ ok: true, runner: body });
}
