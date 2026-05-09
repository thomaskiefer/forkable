import Link from 'next/link';
import { Plus, Users } from 'lucide-react';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getClients } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

export default async function ClientsPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const { clients, count } = await getClients(token);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Customers"
        title="Clients"
        description={
          count > 0
            ? `${count} ${count === 1 ? 'client' : 'clients'} on the books.`
            : 'Convert qualified leads into clients to start projects.'
        }
        actions={
          <Link href="/clients/add">
            <Button size="lg" className="gap-2">
              <Plus className="h-4 w-4" /> New client
            </Button>
          </Link>
        }
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          eyebrow="A clean slate"
          title="No clients yet"
          description="Convert a lead from the pipeline, or add a client directly when one comes from another channel."
          action={
            <Link href="/clients/add">
              <Button size="lg" className="gap-2">
                <Plus className="h-4 w-4" /> Add a client
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <div className="divide-y">
              {clients.map((client: Record<string, unknown>) => {
                const name = client.name as string;
                const isActive = client.is_active as boolean;
                return (
                  <div
                    key={client.id as string}
                    className="flex items-center gap-4 px-6 py-5"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-card font-display text-sm font-medium">
                      {initials(name)}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate font-medium">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {client.client_code as string}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                        isActive
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
