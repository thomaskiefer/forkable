import {
  addPlanningMessages,
  createQueuedAgentRunFromPlan,
  getAgentRun,
  getPlanningMessages,
  getTestResults,
  saveChangeRequestPlan,
} from '@/lib/queries';
import { normalizeRunnerUrl, runnerEndpointUrl, runnerRequestError } from '@/lib/runner-url';
import type {
  ChangeRequest,
  ChangeRequestPlan,
  ChangeRequestPlanningMessage,
} from '@/lib/types';

function serializeHistory(messages: ChangeRequestPlanningMessage[]) {
  return messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');
}

function getRunnerUrl() {
  return normalizeRunnerUrl(process.env.FORKABLE_AGENT_RUNNER_URL);
}

function shouldUseCodexPlanner() {
  return Boolean(getRunnerUrl()) && Boolean(process.env.FORKABLE_RUNNER_WEBHOOK_SECRET);
}

function publicPlanningError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (
    message.includes('token_revoked') ||
    message.includes('refresh_token_invalidated') ||
    message.includes('invalidated oauth token') ||
    message.includes('refresh token has been invalidated')
  ) {
    return 'Codex authentication on the runner has expired. Reconnect Codex auth for the Forkable runner, then retry the planning chat.';
  }

  if (message.includes('FORKABLE_TARGET_REPO_URL')) {
    return 'The Forkable runner is missing its target repository configuration.';
  }

  if (message.includes('empty planning response')) {
    return 'Codex returned an empty planning response. Retry the planning chat.';
  }

  if (message.includes('Command timed out')) {
    return 'The planning agent timed out. Retry with a shorter request or check the runner logs.';
  }

  return message || 'The planning agent failed. Check the runner logs for details, then retry.';
}

function publicImplementationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const planningMessage = publicPlanningError(error);
  if (planningMessage !== message) return planningMessage;
  return message || 'The coding agent failed. Check the runner logs for details, then retry.';
}

function countChangedFiles(summary: string) {
  const explicitMatch = summary.match(/(?:files changed|changed files):?\s*(\d+)/i);
  if (explicitMatch?.[1]) return Number(explicitMatch[1]);

  const files = new Set<string>();
  for (const line of summary.split('\n')) {
    const trimmed = line.trim().replace(/^[-*]\s+/, '');
    if (/^(app|components|lib|worker|migrations|public|schema)\/.+\.[\w.-]+$/.test(trimmed)) {
      files.add(trimmed);
    }
  }

  return files.size || null;
}

function buildFriendlyCompletionMessage(input: {
  rawOutput: string;
  runStatus?: string | null;
  testsPassed: number;
  testsTotal: number;
}) {
  const changedFiles = countChangedFiles(input.rawOutput);
  const lines = ['Build finished.'];

  if (changedFiles !== null) {
    lines.push(`Changed ${changedFiles} ${changedFiles === 1 ? 'file' : 'files'}.`);
  }

  if (input.testsTotal > 0) {
    lines.push(`Checks passed: ${input.testsPassed}/${input.testsTotal}.`);
  }

  if (input.runStatus === 'merged') {
    lines.push('Merged, deployed, and enabled for your company.');
  } else if (input.runStatus) {
    lines.push(`Current status: ${input.runStatus.replaceAll('_', ' ')}.`);
  }

  return lines.join('\n');
}

async function getCodexPlanningReply(input: {
  request: ChangeRequest;
  messages: ChangeRequestPlanningMessage[];
  text: string;
  isInitialKickoff?: boolean;
  onDelta?: (delta: string) => void;
  onStatus?: (message: string) => void;
}) {
  const runnerUrl = getRunnerUrl();
  const secret = process.env.FORKABLE_RUNNER_WEBHOOK_SECRET;

  if (!runnerUrl || !secret) {
    throw new Error('Codex planner runner is not configured.');
  }

  const endpoint = '/planning-chat';
  const response = await fetch(runnerEndpointUrl(runnerUrl, endpoint), {
    method: 'POST',
    headers: {
      'Accept': input.onDelta ? 'application/x-ndjson' : 'application/json',
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request: input.request,
      messages: input.messages,
      message: input.text,
      isInitialKickoff: input.isInitialKickoff,
    }),
  });

  if (input.onDelta && response.ok && response.body) {
    return readCodexPlanningStream(response, input.onDelta, input.onStatus);
  }

  const body = (await response.json().catch(() => ({}))) as {
    content?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(runnerRequestError(endpoint, response.status, body.error));
  }

  if (!body.content?.trim()) {
    throw new Error('Codex planner returned an empty response.');
  }

  return body.content;
}

async function readCodexPlanningStream(
  response: Response,
  onDelta: (delta: string) => void,
  onStatus?: (message: string) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Codex planner returned an empty stream.');

  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';
  let finalContent = '';

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type?: string;
      content?: string;
      error?: string;
      message?: string;
    };

    if (event.type === 'delta' && event.content) {
      assistantText += event.content;
      onDelta(event.content);
    }

    if (event.type === 'done') {
      finalContent = event.content ?? assistantText;
    }

    if (event.type === 'status' && event.message) {
      onStatus?.(event.message);
    }

    if (event.type === 'error') {
      throw new Error(event.error ?? 'Codex planner request failed.');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }

  if (buffer.trim()) handleLine(buffer);

  const content = finalContent || assistantText;
  if (!content.trim()) {
    throw new Error('Codex planner returned an empty response.');
  }

  return content;
}

export async function streamPlanningMessage(input: {
  request: ChangeRequest;
  text: string;
  userId: string;
  accessToken: string;
  persistUserMessage?: boolean;
  isInitialKickoff?: boolean;
}) {
  const existingMessages = await getPlanningMessages(input.request.id, input.accessToken);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      return (async () => {
        let assistantText = '';

        if (!shouldUseCodexPlanner()) {
          throw new Error(
            'Codex planner runner is not configured. Set FORKABLE_AGENT_RUNNER_URL and FORKABLE_RUNNER_WEBHOOK_SECRET.',
          );
        }

        assistantText = await getCodexPlanningReply({
          request: input.request,
          messages: existingMessages,
          text: input.text,
          isInitialKickoff: input.isInitialKickoff ?? input.persistUserMessage === false,
          onDelta: (delta) => writeEvent({ type: 'delta', content: delta }),
          onStatus: (message) => writeEvent({ type: 'status', message }),
        });

        if (!assistantText.trim()) {
          throw new Error('Codex planner returned an empty planning response.');
        }

        const messagesToSave: Array<{
          role: 'user' | 'assistant';
          content: string;
          metadata?: Record<string, unknown>;
        }> = [
          ...(input.persistUserMessage === false
            ? []
            : [
                {
                  role: 'user' as const,
                  content: input.text,
                },
              ]),
          {
            role: 'assistant' as const,
            content: assistantText,
            metadata: {
              provider: 'codex_runner',
              ...(input.isInitialKickoff || input.persistUserMessage === false
                ? { kickoff: true }
                : {}),
            },
          },
        ];

        const savedMessages = await addPlanningMessages(
          input.request.id,
          messagesToSave,
          input.userId,
          input.accessToken,
        );
        const userMessage = input.persistUserMessage === false ? null : savedMessages[0];
        const assistantMessage = savedMessages.at(-1);

        if (!assistantMessage) throw new Error('Planning reply could not be saved.');

        writeEvent({
          type: 'done',
          payload: {
            userMessage,
            assistantMessage,
          },
        });
        controller.close();
      })().catch((error) => {
        writeEvent({
          type: 'error',
          error: publicPlanningError(error),
        });
        controller.close();
      });
    },
  });
}

async function streamRunnerImplementation(input: {
  runId: string;
  onDelta: (delta: string) => void;
  onStatus?: (message: string) => void;
}) {
  const runnerUrl = getRunnerUrl();
  const secret = process.env.FORKABLE_RUNNER_WEBHOOK_SECRET;

  if (!runnerUrl || !secret) {
    throw new Error('Forkable runner is not configured.');
  }

  const endpoint = `/agent-runs/${input.runId}/stream`;
  const response = await fetch(runnerEndpointUrl(runnerUrl, endpoint), {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      Authorization: `Bearer ${secret}`,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(runnerRequestError(endpoint, response.status, body.error));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`Forkable runner request to ${endpoint} returned an empty stream.`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';
  let finalContent = '';

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type?: string;
      content?: string;
      error?: string;
      message?: string;
    };

    if (event.type === 'delta' && event.content) {
      assistantText += event.content;
      input.onDelta(event.content);
    }

    if (event.type === 'status' && event.message) {
      input.onStatus?.(event.message);
    }

    if (event.type === 'done') {
      finalContent = event.content ?? assistantText;
    }

    if (event.type === 'error') {
      throw new Error(event.error ?? 'Coding agent run failed.');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }

  if (buffer.trim()) handleLine(buffer);

  return finalContent || assistantText;
}

export async function streamImplementationMessage(input: {
  request: ChangeRequest;
  text: string;
  userId: string;
  accessToken: string;
}) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      return (async () => {
        const userMessageText = input.text.trim();
        const savedUserMessages = userMessageText
          ? await addPlanningMessages(
              input.request.id,
              [{ role: 'user', content: userMessageText }],
              input.userId,
              input.accessToken,
            )
          : [];
        const userMessage = savedUserMessages[0] ?? null;

        writeEvent({ type: 'status', message: 'Drafting implementation handoff' });
        const plan = await draftChangeRequestPlan({
          request: input.request,
          userId: input.userId,
          accessToken: input.accessToken,
          status: 'finalized',
        });
        const planMessage = await addDraftedPlanMessage({
          requestId: input.request.id,
          plan,
          userId: input.userId,
          accessToken: input.accessToken,
        });
        writeEvent({
          type: 'message',
          payload: {
            message: planMessage,
          },
        });

        writeEvent({ type: 'status', message: 'Queuing coding agent run' });
        const run = await createQueuedAgentRunFromPlan(
          input.request,
          plan,
          input.userId,
          input.accessToken,
        );

        let assistantText = '';
        writeEvent({ type: 'status', message: 'Starting coding agent' });
        const finalContent = await streamRunnerImplementation({
          runId: run.id,
          onDelta: (delta) => {
            assistantText += delta;
          },
          onStatus: (message) => writeEvent({ type: 'status', message }),
        });

        const completedRun = await getAgentRun(run.id, input.accessToken);
        const tests = await getTestResults(run.id, input.accessToken);
        const testsPassed = tests.filter((test) => test.status === 'passed').length;
        const rawOutput = (completedRun?.output_summary || finalContent || assistantText || '').trim();
        const finalAssistantText = buildFriendlyCompletionMessage({
          rawOutput,
          runStatus: completedRun?.status ?? run.status,
          testsPassed,
          testsTotal: tests.length,
        });
        const savedAssistantMessages = await addPlanningMessages(
          input.request.id,
          [{
            role: 'assistant',
            content: finalAssistantText,
            metadata: {
              provider: 'codex_runner',
              run_id: run.id,
              plan_id: plan.id,
            },
          }],
          input.userId,
          input.accessToken,
        );
        const assistantMessage = savedAssistantMessages[0];
        if (!assistantMessage) throw new Error('Coding agent output could not be saved.');

        writeEvent({
          type: 'done',
          payload: {
            userMessage,
            assistantMessage,
            run: completedRun ?? run,
            plan,
          },
        });
        controller.close();
      })().catch((error) => {
        writeEvent({
          type: 'error',
          error: publicImplementationError(error),
        });
        controller.close();
      });
    },
  });
}

function buildImplementationPlan(request: ChangeRequest) {
  return [
    `1. Use Nia to inspect the ${request.title} impact area before changing files: request/detail UI, pipeline movement, database queries, migrations, RLS policies, and existing shadcn components.`,
    '2. Create a safe Git branch and an InsForge backend branch so code, schema, RLS, and functions are isolated from production.',
    `3. Add or reuse the feature flag ${request.feature_key ?? 'for this request'} and scope rollout to ${request.customer_name} through company_account_id/company_feature_flags.`,
    '4. Implement additive persistence for the requested workflow and audit trail; do not drop or rewrite existing CRM tables.',
    '5. Enforce the workflow in the backend path that mutates production state, not only in frontend UI.',
    '6. Add the smallest clear UI to explain the requirement, collect the missing decision, and show persisted status.',
    '7. Deploy a preview, run smoke tests, then automatically merge, deploy, enable the company flag, and notify the requester.',
  ].join('\n');
}

function buildAcceptanceCriteria(request: ChangeRequest) {
  const customer = request.customer_name || 'the target customer';

  return [
    `${customer} sees the new workflow only when the company feature flag is enabled.`,
    'Companies without the flag keep the existing CRM behavior.',
    'The backend rejects invalid state transitions when the workflow requirement has not been satisfied.',
    'The UI lets a user complete or request the required step and then shows persisted status.',
    'Audit or activity records are created for the user-visible workflow events.',
    'Smoke tests cover enabled-company behavior, disabled-company behavior, backend rejection, persistence, and the success path.',
  ];
}

function buildCodingAgentPrompt(
  request: ChangeRequest,
  messages: ChangeRequestPlanningMessage[],
) {
  return [
    'Use Nia to inspect this CRM repo before making changes.',
    '',
    `Company workflow request: ${request.customer_name} wants "${request.title}".`,
    `Requester: ${request.customer_email}.`,
    `Company account id: ${request.company_account_id ?? 'look up from request context if needed'}.`,
    `Feature key: ${request.feature_key ?? 'choose a clear snake_case key if missing'}.`,
    `Original request: ${request.description}`,
    '',
    'Planning conversation:',
    serializeHistory(messages) || '(none)',
    '',
    'Implementation requirements:',
    '- Do not modify production directly.',
    '- Prefer additive migrations.',
    '- Preserve existing CRM behavior for companies without the flag.',
    '- Scope rollout through company_account_id and company_feature_flags, not a manually selected customer.',
    '- Enforce workflow rules in the backend mutation path.',
    '- Add a focused UI using existing components and design conventions.',
    '- Return exact changed files, schema changes, smoke test results, preview URL, and review notes.',
  ].join('\n');
}

function formatPlanForChat(plan: ChangeRequestPlan) {
  return [
    'Ready to build',
    '',
    plan.summary,
    '',
    'I have enough context to send this to the coding agent. I will keep the change scoped to your company, preserve the default CRM behavior for everyone else, and report back with the run when it is ready to review.',
  ].join('\n');
}

export async function addDraftedPlanMessage(input: {
  requestId: string;
  plan: ChangeRequestPlan;
  userId: string;
  accessToken: string;
}) {
  const savedMessages = await addPlanningMessages(
    input.requestId,
    [{
      role: 'assistant',
      content: formatPlanForChat(input.plan),
      metadata: {
        kind: 'drafted_plan',
        plan_id: input.plan.id,
      },
    }],
    input.userId,
    input.accessToken,
  );

  const message = savedMessages[0];
  if (!message) throw new Error('Draft plan message could not be saved.');
  return message;
}

export async function draftChangeRequestPlan(input: {
  request: ChangeRequest;
  userId: string;
  accessToken: string;
  status?: ChangeRequestPlan['status'];
}) {
  const messages = await getPlanningMessages(input.request.id, input.accessToken);
  const status = input.status ?? 'finalized';
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const summary = [
    `${input.request.customer_name} request: ${input.request.title}.`,
    input.request.description,
    latestUserMessage ? `Latest planning note: ${latestUserMessage.content}` : null,
  ].filter(Boolean).join(' ');

  const plan = await saveChangeRequestPlan(
    {
      changeRequestId: input.request.id,
      status,
      summary,
      implementationPlan: buildImplementationPlan(input.request),
      acceptanceCriteria: buildAcceptanceCriteria(input.request),
      codingAgentPrompt: buildCodingAgentPrompt(input.request, messages),
      contextBundle: {
        customer: input.request.customer_name,
        customer_email: input.request.customer_email,
        feature_key: input.request.feature_key,
        planning_message_count: messages.length,
        sources: ['change_request', 'planning_chat', 'nia_repo_context', 'hyperspell_customer_context'],
      },
      userId: input.userId,
    },
    input.accessToken,
  );

  if (!plan) throw new Error('The plan could not be saved.');
  return plan;
}
