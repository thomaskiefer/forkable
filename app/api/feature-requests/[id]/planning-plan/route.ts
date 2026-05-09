import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { addDraftedPlanMessage, draftChangeRequestPlan } from '@/lib/feature-planning';
import { getChangeRequest } from '@/lib/queries';
import type { ChangeRequest, ChangeRequestPlan } from '@/lib/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { viewer, accessToken } = await getAuthenticatedSession();

  if (!viewer.isAuthenticated || !viewer.id || !accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    status?: ChangeRequestPlan['status'];
  };
  const changeRequest = (await getChangeRequest(id, accessToken)) as ChangeRequest | null;
  if (!changeRequest) {
    return NextResponse.json({ error: 'Feature request not found.' }, { status: 404 });
  }

  const plan = await draftChangeRequestPlan({
    request: changeRequest,
    userId: viewer.id,
    accessToken,
    status: body.status ?? 'finalized',
  });
  const message = await addDraftedPlanMessage({
    requestId: changeRequest.id,
    plan,
    userId: viewer.id,
    accessToken,
  });

  return NextResponse.json({ plan, message });
}
