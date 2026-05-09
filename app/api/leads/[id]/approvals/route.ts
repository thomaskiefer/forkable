import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  approveDealApproval,
  getDealApprovalRequests,
  requestDealApproval,
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
  const approvals = await getDealApprovalRequests(id, token);
  return NextResponse.json(approvals);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { reason } = await request.json();

  try {
    const approvalId = await requestDealApproval(id, reason, token);
    return NextResponse.json({ id: approvalId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to request approval.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await params;
  const { approvalRequestId } = await request.json();

  try {
    await approveDealApproval(approvalRequestId, token);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to approve request.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
