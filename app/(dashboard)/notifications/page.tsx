import { requireAuthenticatedSession } from '@/lib/auth-state';
import { listUserNotifications } from '@/lib/queries';
import { NotificationsList } from '@/app/(dashboard)/notifications/notifications-list';

export default async function NotificationsPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const notifications = await listUserNotifications(token, { limit: 50 });
  return <NotificationsList initialNotifications={notifications} />;
}
