import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  addScheduledAgentMessages,
  getScheduledAgentTask,
} from '@/lib/queries';

function taskMessage(role: 'user' | 'assistant', content: string) {
  return {
    role,
    content,
    metadata: {},
  };
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

  const messages = await addScheduledAgentMessages(
    id,
    [
      taskMessage('user', text),
      taskMessage(
        'assistant',
        'Noted. Draft or update the schedule when the task details are ready.',
      ),
    ],
    viewer.id,
    token,
  );

  return NextResponse.json({ messages });
}
