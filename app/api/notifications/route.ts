import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { listUserNotifications } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const { viewer, accessToken: token } = await getAuthenticatedSession();
  if (!viewer.isAuthenticated) {
    return NextResponse.json(
      { notifications: [] },
      {
        status: 401,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      },
    );
  }

  const notifications = await listUserNotifications(token, { limit: 50 });
  return NextResponse.json(
    { notifications },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
