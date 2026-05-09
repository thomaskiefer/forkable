import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { streamPlanningMessage } from '@/lib/feature-planning';
import { createChangeRequest, getCompanyAccountForEmail } from '@/lib/queries';
import type { ChangeRequest, FeaturePlanningStreamEvent } from '@/lib/types';

function readRequiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function runInitialPlanningKickoff(input: {
  request: ChangeRequest;
  description: string;
  userId: string;
  accessToken: string;
}) {
  const stream = await streamPlanningMessage({
    request: input.request,
    text: input.description,
    userId: input.userId,
    accessToken: input.accessToken,
    isInitialKickoff: true,
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let planningError: string | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as FeaturePlanningStreamEvent;
    if (event.type === 'error') {
      planningError = event.error;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }

  if (buffer.trim()) handleLine(buffer);
  return planningError;
}

export async function POST(request: Request) {
  const { viewer, accessToken } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated || !viewer.id || !accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = readRequiredString(body.title);
  const description = readRequiredString(body.description);
  const requesterEmail = viewer.email?.trim().toLowerCase() ?? '';

  if (!title || !description) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }

  if (!requesterEmail) {
    return NextResponse.json(
      { error: 'Your account needs an email before it can create requests.' },
      { status: 400 },
    );
  }

  const company = await getCompanyAccountForEmail(requesterEmail, accessToken);
  if (!company) {
    return NextResponse.json(
      { error: 'Your login is not mapped to a company account yet.' },
      { status: 400 },
    );
  }

  const changeRequest = await createChangeRequest(
    {
      title,
      company,
      requesterEmail,
      description,
      userId: viewer.id,
    },
    accessToken,
  );

  if (!changeRequest) {
    return NextResponse.json({ error: 'Feature request was not created.' }, { status: 500 });
  }

  let planningError: string | null = null;
  try {
    planningError = await runInitialPlanningKickoff({
      request: changeRequest,
      description,
      userId: viewer.id,
      accessToken,
    });
  } catch (error) {
    planningError =
      error instanceof Error
        ? error.message
        : 'Planning kickoff failed. Open the request and send the description manually.';
  }

  return NextResponse.json({ request: changeRequest, planningError }, { status: 201 });
}
