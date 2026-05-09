const rows = Array.from({ length: 6 }, (_, index) => index);

export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-3">
          <div className="h-3 w-24 rounded-full bg-muted" />
          <div className="h-10 w-56 rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full rounded-full bg-muted" />
        </div>
        <div className="h-11 w-28 rounded-lg bg-muted" />
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="h-28 rounded-2xl border bg-card" />
        <div className="h-28 rounded-2xl border bg-card" />
        <div className="h-28 rounded-2xl border bg-card" />
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid gap-4 border-b bg-muted/30 px-6 py-3 lg:grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr_0.7fr]">
          <div className="h-3 rounded-full bg-muted-foreground/20" />
          <div className="h-3 rounded-full bg-muted-foreground/20" />
          <div className="h-3 rounded-full bg-muted-foreground/20" />
          <div className="h-3 rounded-full bg-muted-foreground/20" />
          <div className="h-3 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="divide-y">
          {rows.map((row) => (
            <div
              key={row}
              className="grid gap-4 px-6 py-5 lg:grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr_0.7fr]"
            >
              <div className="space-y-2">
                <div className="h-4 w-44 rounded-full bg-muted" />
                <div className="h-3 w-28 rounded-full bg-muted" />
              </div>
              <div className="h-4 w-24 rounded-full bg-muted" />
              <div className="h-4 w-20 rounded-full bg-muted" />
              <div className="h-4 w-24 rounded-full bg-muted" />
              <div className="h-6 w-20 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
