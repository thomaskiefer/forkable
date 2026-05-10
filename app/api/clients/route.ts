import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import {
  getClients,
  addClient,
  hasFeatureFlag,
  normalizeClientSort,
} from '@/lib/queries';

const CLIENT_SORTING_FEATURE = 'sort_clients_table_by_attribute';

export async function GET(request: NextRequest) {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined;
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
  const clientsSortingEnabled = await hasFeatureFlag(CLIENT_SORTING_FEATURE, token);
  const sort = clientsSortingEnabled
    ? normalizeClientSort(searchParams.get('sort'), searchParams.get('direction'))
    : { field: 'company_name' as const, direction: 'asc' as const };

  const result = await getClients(token, page, limit, sort.field, sort.direction);
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
