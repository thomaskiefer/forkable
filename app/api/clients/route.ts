import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { getClients, addClient } from '@/lib/queries';

export async function GET(request: NextRequest) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined;
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

  const result = await getClients(token, page, limit);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated || !viewer.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const client = await addClient({ ...body, user_id: viewer.id }, token);
  return NextResponse.json(client, { status: 201 });
}
