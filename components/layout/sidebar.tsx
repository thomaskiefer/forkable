'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarClock,
  LayoutDashboard,
  Target,
  KanbanSquare,
  Users,
  Briefcase,
  GitPullRequestArrow,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/lib/auth-actions';
import { dashboardPrefetchRoutes } from '@/components/layout/dashboard-route-prefetcher';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Target },
  { href: '/leads/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/projects', label: 'Projects', icon: Briefcase },
  { href: '/feature-requests', label: 'Feature requests', icon: GitPullRequestArrow },
  { href: '/automations', label: 'Automations', icon: CalendarClock },
  { href: '/notifications', label: 'Notifications', icon: Bell },
];

function matchesRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getActiveHref(pathname: string) {
  return navItems
    .filter((item) => matchesRoute(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const activeHref = getActiveHref(pathname);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadUnreadNotifications() {
      try {
        const response = await fetch('/api/notifications/unread-count', {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const body = (await response.json()) as { count?: number };
        if (!cancelled) setUnreadNotifications(Math.max(0, body.count ?? 0));
      } catch {
        if (!cancelled) setUnreadNotifications(0);
      }
    }

    function loadWhenVisible() {
      if (document.visibilityState === 'visible') {
        void loadUnreadNotifications();
      }
    }

    void loadUnreadNotifications();
    const intervalId = globalThis.setInterval(loadUnreadNotifications, 5000);
    globalThis.addEventListener('notifications:changed', loadUnreadNotifications);
    globalThis.addEventListener('focus', loadWhenVisible);
    document.addEventListener('visibilitychange', loadWhenVisible);

    return () => {
      cancelled = true;
      globalThis.clearInterval(intervalId);
      globalThis.removeEventListener('notifications:changed', loadUnreadNotifications);
      globalThis.removeEventListener('focus', loadWhenVisible);
      document.removeEventListener('visibilitychange', loadWhenVisible);
    };
  }, [pathname]);

  function prefetchRoute(href: string) {
    if (dashboardPrefetchRoutes.includes(href)) {
      router.prefetch(href);
    }
  }

  return (
    <aside className="relative z-10 flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground dark:bg-[#070707]/88 dark:backdrop-blur">
      {/* Wordmark */}
      <div className="flex h-20 items-center px-6">
        <Link href="/" className="group" aria-label="Forkable">
          <Wordmark size="md" />
        </Link>
      </div>

      <nav className="stagger mt-4 flex-1 space-y-0.5 px-3 pb-4">
        {navItems.map((item) => {
          const isActive = item.href === activeHref;

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onFocus={() => prefetchRoute(item.href)}
              onPointerEnter={() => prefetchRoute(item.href)}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-foreground dark:bg-white/[0.08]'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground dark:hover:bg-white/[0.055]',
              )}
            >
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-x-3 -translate-y-1/2 rounded-full bg-primary"
                />
              ) : null}
              <item.icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground',
                )}
              />
              <span className="truncate">{item.label}</span>
              {item.href === '/notifications' && unreadNotifications > 0 ? (
                <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[0.68rem] font-semibold leading-none text-primary-foreground">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-sidebar-border p-3">
        <div className="flex items-center justify-between gap-2 px-2 pt-1">
          <span className="eyebrow">Theme</span>
          <ThemeToggle />
        </div>
        <form action={signOut}>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
            type="submit"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}
