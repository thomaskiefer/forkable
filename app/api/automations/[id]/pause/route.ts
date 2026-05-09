import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { getScheduledAgentTask, updateScheduledAgentTask } from '@/lib/queries';

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

  const updatedTask = await updateScheduledAgentTask(
    id,
    {
      status: 'paused',
      paused_at: new Date().toISOString(),
      metadata: { ...task.metadata, paused_by: viewer.id },
    },
    token,
  );

  return NextResponse.json({ task: updatedTask });
}
