'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export const dashboardPrefetchRoutes = [
  '/dashboard',
  '/leads',
  '/leads/pipeline',
  '/clients',
  '/projects',
  '/feature-requests',
  '/automations',
  '/notifications',
];

function scheduleIdleWork(callback: () => void) {
  if (typeof window === 'undefined') return () => {};

  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = globalThis.setTimeout(callback, 250);
  return () => globalThis.clearTimeout(timeoutId);
}

export function DashboardRoutePrefetcher() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];
    const cancelIdleWork = scheduleIdleWork(() => {
      dashboardPrefetchRoutes
        .filter((route) => route !== pathname)
        .forEach((route, index) => {
          timeoutIds.push(globalThis.setTimeout(() => router.prefetch(route), index * 150));
        });
    });

    return () => {
      cancelIdleWork();
      timeoutIds.forEach((timeoutId) => globalThis.clearTimeout(timeoutId));
    };
  }, [pathname, router]);

  return null;
}
