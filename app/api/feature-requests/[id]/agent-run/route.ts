import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { draftChangeRequestPlan } from '@/lib/feature-planning';
import {
  createQueuedAgentRunFromPlan,
  getAgentRunsForRequest,
  getAgentSteps,
  getChangeRequest,
  getLatestChangeRequestPlan,
} from '@/lib/queries';
import type { ChangeRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { viewer, accessToken } = await getAuthenticatedSession();

  if (!viewer.isAuthenticated || !viewer.id || !accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const changeRequest = (await getChangeRequest(id, accessToken)) as ChangeRequest | null;
  if (!changeRequest) {
    return NextResponse.json({ error: 'Feature request not found.' }, { status: 404 });
  }

  const runs = await getAgentRunsForRequest(id, accessToken);
  const run = runs[0] ?? null;
  const steps = run ? await getAgentSteps(run.id, accessToken) : [];

  return NextResponse.json({ run, steps });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { viewer, accessToken } = await getAuthenticatedSession();

  if (!viewer.isAuthenticated || !viewer.id || !accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const changeRequest = (await getChangeRequest(id, accessToken)) as ChangeRequest | null;
  if (!changeRequest) {
    return NextResponse.json({ error: 'Feature request not found.' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { planId?: string };
  let plan = await getLatestChangeRequestPlan(id, accessToken);

  if (!plan || (body.planId && plan.id !== body.planId)) {
    plan = await draftChangeRequestPlan({
      request: changeRequest,
      userId: viewer.id,
      accessToken,
      status: 'finalized',
    });
  }

  const run = await createQueuedAgentRunFromPlan(
    changeRequest,
    plan,
    viewer.id,
    accessToken,
  );

  return NextResponse.json({ run });
}
