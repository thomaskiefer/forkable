import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { deleteChangeRequest, getChangeRequest } from '@/lib/queries';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { viewer, accessToken } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated || !viewer.id || !accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const changeRequest = await getChangeRequest(id, accessToken);
  if (!changeRequest) {
    return NextResponse.json({ error: 'Feature request not found.' }, { status: 404 });
  }

  await deleteChangeRequest(id, accessToken);
  return NextResponse.json({ ok: true });
}
