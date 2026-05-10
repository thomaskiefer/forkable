'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Bell, Check, ExternalLink, Inbox, X } from 'lucide-react';
import { archiveNotificationAction, markNotificationReadAction } from '@/app/(dashboard)/notifications/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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

function notifyUnreadCountChanged() {
  globalThis.dispatchEvent(new Event('notifications:changed'));
}

export function NotificationsList({ initialNotifications }: { initialNotifications: UserNotification[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState(initialNotifications);
  const unreadCount = notifications.filter((notification) => notification.status === 'unread').length;

  function setNotificationPending(id: string, pending: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function markRead(id: string) {
    const previous = notifications;
    const now = new Date().toISOString();

    setNotifications((current) => current.map((notification) => {
      if (notification.id !== id) return notification;
      return { ...notification, status: 'read', read_at: now, updated_at: now };
    }));
    setNotificationPending(id, true);
    notifyUnreadCountChanged();

    startTransition(async () => {
      try {
        await markNotificationReadAction(id);
        router.refresh();
      } catch {
        setNotifications(previous);
      } finally {
        setNotificationPending(id, false);
        notifyUnreadCountChanged();
      }
    });
  }

  function archive(id: string) {
    const previous = notifications;

    setNotifications((current) => current.filter((notification) => notification.id !== id));
    setNotificationPending(id, true);
    notifyUnreadCountChanged();

    startTransition(async () => {
      try {
        await archiveNotificationAction(id);
        router.refresh();
      } catch {
        setNotifications(previous);
      } finally {
        setNotificationPending(id, false);
        notifyUnreadCountChanged();
      }
    });
  }

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
          {notifications.map((notification) => {
            const notificationPending = pendingIds.has(notification.id) || isPending;

            return (
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
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={notificationPending}
                      onClick={() => markRead(notification.id)}
                    >
                      <Check />
                      Read
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={notificationPending}
                    onClick={() => archive(notification.id)}
                  >
                    <X />
                    Archive
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
