import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { getUnreadNotificationCount } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json(
      { count: 0 },
      {
        status: 401,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      },
    );
  }

  const count = await getUnreadNotificationCount(token);
  return NextResponse.json(
    { count },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
