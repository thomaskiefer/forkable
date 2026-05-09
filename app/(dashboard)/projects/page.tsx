import Link from 'next/link';
import { Briefcase, Plus } from 'lucide-react';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getProjects } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

const statusTone: Record<string, string> = {
  active: 'border-primary/30 bg-primary/10 text-primary',
  on_hold: 'border-chart-2/30 bg-chart-2/10 text-chart-2',
  completed: 'border-chart-3/30 bg-chart-3/10 text-chart-3',
  cancelled: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export default async function ProjectsPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const { projects, count } = await getProjects(token);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        description={
          count > 0
            ? `${count} ${count === 1 ? 'project' : 'projects'} in motion across your clients.`
            : 'Once a client is converted, projects track the work you deliver.'
        }
        actions={
          <Link href="/projects/add">
            <Button size="lg" className="gap-2">
              <Plus className="h-4 w-4" /> New project
            </Button>
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          eyebrow="Ready when you are"
          title="No projects yet"
          description="Spin one up when a deal closes. Track scope, status, and the client it belongs to."
          action={
            <Link href="/projects/add">
              <Button size="lg" className="gap-2">
                <Plus className="h-4 w-4" /> Start a project
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <div className="divide-y">
              {projects.map((project: Record<string, unknown>) => {
                const name = project.name as string;
                const clientName = (project.client as Record<string, string> | undefined)?.name;
                const status = (project.deal_status as string) ?? 'active';
                return (
                  <div
                    key={project.id as string}
                    className="flex items-center gap-4 px-6 py-5"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate font-medium">{name}</p>
                      {clientName ? (
                        <p className="truncate text-xs text-muted-foreground">{clientName}</p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                        statusTone[status] ?? 'border-border text-muted-foreground',
                      )}
                    >
                      {status.replace('_', ' ')}
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
