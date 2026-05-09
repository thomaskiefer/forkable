import { requireAuthenticatedSession } from '@/lib/auth-state';
import { DashboardLayout } from '@/components/layout/dashboard-layout';

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAuthenticatedSession();

  return <DashboardLayout>{children}</DashboardLayout>;
}
