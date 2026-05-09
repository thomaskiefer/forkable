import { redirect } from 'next/navigation';
import { getAuthenticatedSession } from '@/lib/auth-state';
import { DEFAULT_LANDING_ROUTE } from '@/lib/constants';

export default async function HomePage() {
  const { viewer } = await getAuthenticatedSession();

  if (viewer.isAuthenticated) {
    redirect(DEFAULT_LANDING_ROUTE);
  }

  redirect('/auth/sign-in');
}
