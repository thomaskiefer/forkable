import { Sidebar } from '@/components/layout/sidebar';
import { DashboardRoutePrefetcher } from '@/components/layout/dashboard-route-prefetcher';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground dark:bg-[#070706]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(112deg,#050504_0%,#11100e_52%,#070706_100%)] dark:block"
      />
      <DashboardRoutePrefetcher />
      <Sidebar />
      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-screen-2xl px-6 py-10 sm:px-10 lg:px-14">
          {children}
        </div>
      </main>
    </div>
  );
}
