import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  completeAcmeClosePlanItem,
  getAcmeClosePlanItems,
} from '@/lib/queries';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const items = await getAcmeClosePlanItems(id, token);
  return NextResponse.json(items);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { actionKey, notes } = await request.json();

  try {
    await completeAcmeClosePlanItem(id, actionKey, notes, token);
    const items = await getAcmeClosePlanItems(id, token);
    return NextResponse.json(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete close-plan action.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
