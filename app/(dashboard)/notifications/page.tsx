import Link from 'next/link';
import { Bell, Check, ExternalLink, Inbox, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { archiveNotification, listUserNotifications, markNotificationRead } from '@/lib/queries';
import type { UserNotification } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function kindClass(kind: UserNotification['kind']) {
  if (kind === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (kind === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (kind === 'error') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-primary/25 bg-primary/10 text-primary';
}

async function markReadAction(formData: FormData) {
  'use server';

  const { accessToken: token } = await requireAuthenticatedSession();
  const id = String(formData.get('id') ?? '');
  if (id) await markNotificationRead(id, token);
}

async function archiveAction(formData: FormData) {
  'use server';

  const { accessToken: token } = await requireAuthenticatedSession();
  const id = String(formData.get('id') ?? '');
  if (id) await archiveNotification(id, token);
}

export default async function NotificationsPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const notifications = await listUserNotifications(token, { limit: 50 });
  const unreadCount = notifications.filter((notification) => notification.status === 'unread').length;

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        eyebrow="Notifications"
        title="No notifications yet"
        description="Scheduled automations will post Slack and customer-context findings here when they run."
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1 className="text-2xl font-semibold tracking-tight">Automation findings</h1>
        </div>
        <Badge variant="outline">{unreadCount} unread</Badge>
      </header>

      <section className="overflow-hidden rounded-[1.15rem] border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.14)] dark:border-white/[0.12] dark:bg-[#070707]/88">
        <div className="divide-y dark:divide-white/10">
          {notifications.map((notification) => (
            <article
              key={notification.id}
              className={cn(
                'grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]',
                notification.status === 'unread' && 'bg-primary/[0.035] dark:bg-white/[0.035]',
              )}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md border', kindClass(notification.kind))}>
                    <Bell className="h-4 w-4" />
                  </span>
                  <Badge variant={notification.status === 'unread' ? 'default' : 'outline'}>
                    {notification.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(notification.created_at)}</span>
                </div>
                <div>
                  <h2 className="text-base font-semibold">{notification.title}</h2>
                  {notification.body ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {notification.body}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {notification.action_href ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={notification.action_href}>
                      <ExternalLink />
                      {notification.action_label || 'Open'}
                    </Link>
                  </Button>
                ) : null}
                {notification.status === 'unread' ? (
                  <form action={markReadAction}>
                    <input type="hidden" name="id" value={notification.id} />
                    <Button variant="outline" size="sm" type="submit">
                      <Check />
                      Read
                    </Button>
                  </form>
                ) : null}
                <form action={archiveAction}>
                  <input type="hidden" name="id" value={notification.id} />
                  <Button variant="ghost" size="sm" type="submit">
                    <X />
                    Archive
                  </Button>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
