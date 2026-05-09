import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getAgentRun, getAgentSteps, getBranchPreview, getTestResults } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentRun, AgentStep, BranchPreview, TestResult } from '@/lib/types';

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { accessToken: token } = await requireAuthenticatedSession();
  const run = (await getAgentRun(id, token)) as AgentRun | null;
  if (!run) notFound();

  const [steps, preview, tests] = await Promise.all([
    getAgentSteps(id, token) as Promise<AgentStep[]>,
    getBranchPreview(id, token) as Promise<BranchPreview | null>,
    getTestResults(id, token) as Promise<TestResult[]>,
  ]);
  const planSnapshot = run.plan_snapshot as {
    summary?: string;
    implementation_plan?: string;
    acceptance_criteria?: string[];
  } | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{run.git_branch}</p>
          <h1 className="text-2xl font-bold">Customization run</h1>
        </div>
        <Badge>{run.status}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center justify-between rounded-md border p-3">
                <span className="text-sm font-medium">{step.label}</span>
                <Badge variant={step.status === 'passed' ? 'default' : 'outline'}>{step.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {planSnapshot?.summary ? (
            <Card>
              <CardHeader>
                <CardTitle>Queued plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="leading-6 text-muted-foreground">{planSnapshot.summary}</p>
                {planSnapshot.implementation_plan ? (
                  <div className="rounded-md border p-3">
                    <p className="whitespace-pre-wrap leading-6">
                      {planSnapshot.implementation_plan}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Preview and tests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {preview && (
                <div className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{preview.app_url}</p>
                  <p className="text-muted-foreground">{preview.backend_branch}</p>
                </div>
              )}
              <div className="space-y-2">
                {tests.map((test) => (
                  <div key={test.id} className="flex items-center justify-between text-sm">
                    <span>{test.name}</span>
                    <Badge variant={test.status === 'passed' ? 'default' : 'outline'}>{test.status}</Badge>
                  </div>
                ))}
                {tests.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Tests will appear after the coding agent starts the implementation run.
                  </p>
                ) : null}
              </div>
              <Link href={`/feature-reviews/${run.id}`}>
                <Button className="w-full">Open shipment details</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
