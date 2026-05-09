import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { getClients, addClient, hasFeatureFlag } from '@/lib/queries';

const CLIENT_SORT_FEATURE_KEY = 'sort_clients_table_by_attribute';
const allowedSortFields = new Set(['company_name', 'deal_value', 'last_activity', 'arr']);
const allowedDirections = new Set(['asc', 'desc']);

export async function GET(request: NextRequest) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined;
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
  const sort = searchParams.get('sort');
  const dir = searchParams.get('dir');

  if (sort || dir) {
    if (!sort || !allowedSortFields.has(sort) || (dir && !allowedDirections.has(dir))) {
      return NextResponse.json({ error: 'Unsupported client sort.' }, { status: 400 });
    }

    const sortingEnabled = await hasFeatureFlag(CLIENT_SORT_FEATURE_KEY, token);
    if (!sortingEnabled) {
      return NextResponse.json({ error: 'Client sorting is not enabled for this company.' }, { status: 403 });
    }
  }

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
