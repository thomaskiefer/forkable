import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { streamImplementationMessage } from '@/lib/feature-planning';
import { getChangeRequest } from '@/lib/queries';
import type { ChangeRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { viewer, accessToken } = await getAuthenticatedSession();

  if (!viewer.isAuthenticated || !viewer.id || !accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { message?: string };
  const text = body.message?.trim();
  if (!text) {
    return NextResponse.json({ error: 'message is required.' }, { status: 400 });
  }

  const changeRequest = (await getChangeRequest(id, accessToken)) as ChangeRequest | null;
  if (!changeRequest) {
    return NextResponse.json({ error: 'Feature request not found.' }, { status: 404 });
  }

  const stream = await streamImplementationMessage({
    request: changeRequest,
    text,
    userId: viewer.id,
    accessToken,
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
    },
  });
}
