import { createAIProvider, getAIProviderName } from '@/lib/ai';
import { createInsforgeServerClient, getConfiguredModel } from '@/lib/insforge';
import {
  addPlanningMessages,
  getPlanningMessages,
  saveChangeRequestPlan,
} from '@/lib/queries';
import type {
  ChangeRequest,
  ChangeRequestPlan,
  ChangeRequestPlanningMessage,
} from '@/lib/types';

const PLANNER_SYSTEM_PROMPT = `You are Forkable's feature planning assistant.
Your job is to help a logged-in company user refine one CRM workflow request into a safe coding-agent handoff.

Operate like a pragmatic senior product engineer:
- Ask only for missing decisions that materially affect implementation.
- Keep the plan grounded in logged-in company scope, safe branching, InsForge backend branches, company feature flags, RLS, backend enforcement, preview deploys, smoke tests, and developer review.
- Never ask the user which customer should receive the change; the target company comes from the authenticated user's company mapping.
- Never claim code has been changed.
- When the request is ready, summarize the finalized implementation plan and say it is ready to send to the coding agent.
- Keep replies concise.`;

function serializeRequest(request: ChangeRequest) {
  return [
    `Title: ${request.title}`,
    `Company: ${request.customer_name}`,
    `Requested by: ${request.customer_email}`,
    `Status: ${request.status}`,
    `Feature key: ${request.feature_key ?? 'not set'}`,
    `Description: ${request.description}`,
  ].join('\n');
}

function serializeHistory(messages: ChangeRequestPlanningMessage[]) {
  return messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');
}

function fallbackAssistantReply(
  request: ChangeRequest,
  message: string,
) {
  const lowered = message.toLowerCase();
  const isFinalizing =
    lowered.includes('final') ||
    lowered.includes('send') ||
    lowered.includes('agent') ||
    lowered.includes('implement') ||
    lowered.includes('looks good');

  if (isFinalizing) {
    return [
      `I can turn "${request.title}" into a coding-agent handoff now.`,
      '',
      `The implementation should stay additive: company feature flag, approval persistence, backend enforcement, feature-gated CRM UI, preview deployment, and smoke tests that prove ${request.customer_name} differs only where intended.`,
      '',
      'Use "Draft plan" to freeze the reviewed plan, then "Send to coding agent" to queue the implementation run.',
    ].join('\n');
  }

  return [
    'I would refine this around four decisions before implementation:',
    '',
    `1. Rollout: what company-level behavior should ${request.customer_name} receive first?`,
    '2. Enforcement: which backend path blocks invalid stage movement?',
    '3. Data model: what approval state and audit events must persist?',
    '4. Proof: which smoke tests prove the customization is isolated?',
    '',
    `For the current request, the likely plan is ${request.customer_name}-scoped, backend-enforced, additive schema, focused CRM UI, and smoke tests for enabled-company and disabled-company behavior.`,
  ].join('\n');
}

function getRunnerUrl() {
  return process.env.FORKABLE_AGENT_RUNNER_URL?.replace(/\/+$/, '');
}

function shouldUseCodexPlanner() {
  return (
    process.env.FEATURE_PLANNING_PROVIDER === 'codex' &&
    Boolean(getRunnerUrl()) &&
    Boolean(process.env.FORKABLE_RUNNER_WEBHOOK_SECRET)
  );
}

async function getCodexPlanningReply(input: {
  request: ChangeRequest;
  messages: ChangeRequestPlanningMessage[];
  text: string;
}) {
  const runnerUrl = getRunnerUrl();
  const secret = process.env.FORKABLE_RUNNER_WEBHOOK_SECRET;

  if (!runnerUrl || !secret) {
    throw new Error('Codex planner runner is not configured.');
  }

  const response = await fetch(`${runnerUrl}/planning-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request: input.request,
      messages: input.messages,
      message: input.text,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    content?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(body.error ?? 'Codex planner request failed.');
  }

  if (!body.content?.trim()) {
    throw new Error('Codex planner returned an empty response.');
  }

  return body.content;
}

async function streamProviderPlanningReply(input: {
  request: ChangeRequest;
  messages: ChangeRequestPlanningMessage[];
  text: string;
  accessToken: string;
  onDelta: (delta: string) => void;
}) {
  const insforge = createInsforgeServerClient({ accessToken: input.accessToken });
  const provider = await createAIProvider(insforge);
  const stream = await provider.streamCompletion({
    model: getConfiguredModel(),
    messages: [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          'Feature request context:',
          serializeRequest(input.request),
          '',
          'Planning conversation so far:',
          serializeHistory(input.messages) || '(none yet)',
          '',
          `Latest user message: ${input.text}`,
        ].join('\n'),
      },
    ],
  });

  let assistantText = '';
  for await (const delta of stream) {
    assistantText += delta;
    input.onDelta(delta);
  }

  return assistantText;
}

export async function streamPlanningMessage(input: {
  request: ChangeRequest;
  text: string;
  userId: string;
  accessToken: string;
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
        let warning: string | null = null;

        try {
          if (shouldUseCodexPlanner()) {
            assistantText = await getCodexPlanningReply({
              request: input.request,
              messages: existingMessages,
              text: input.text,
            });

            for (const chunk of assistantText.match(/.{1,80}(\s|$)/g) ?? [assistantText]) {
              writeEvent({ type: 'delta', content: chunk });
            }
          } else {
            assistantText = await streamProviderPlanningReply({
              request: input.request,
              messages: existingMessages,
              text: input.text,
              accessToken: input.accessToken,
              onDelta: (delta) => writeEvent({ type: 'delta', content: delta }),
            });
          }
        } catch (error) {
          warning =
            error instanceof Error
              ? `Planning agent unavailable: ${error.message}`
              : 'Planning agent unavailable.';
          assistantText = fallbackAssistantReply(input.request, input.text);
          writeEvent({ type: 'warning', message: warning });

          for (const chunk of assistantText.match(/.{1,80}(\s|$)/g) ?? [assistantText]) {
            writeEvent({ type: 'delta', content: chunk });
          }
        }

        if (!assistantText.trim()) {
          assistantText = fallbackAssistantReply(input.request, input.text);
          writeEvent({
            type: 'warning',
            message: `${getAIProviderName()} returned an empty response; using the local planning fallback.`,
          });
          writeEvent({ type: 'delta', content: assistantText });
        }

        const [userMessage, assistantMessage] = await addPlanningMessages(
          input.request.id,
          [
            {
              role: 'user',
              content: input.text,
            },
            {
              role: 'assistant',
              content: assistantText,
              metadata: {
                provider: shouldUseCodexPlanner() ? 'codex_runner' : getAIProviderName(),
                ...(warning ? { warning } : {}),
              },
            },
          ],
          input.userId,
          input.accessToken,
        );

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
          error: error instanceof Error ? error.message : 'Unable to complete planning chat.',
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
    '7. Deploy a preview, run smoke tests, and show diff/test/preview evidence in developer review before merge.',
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
        sources: ['change_request', 'planning_chat', 'nia_repo_context', 'nia_customer_context'],
      },
      userId: input.userId,
    },
    input.accessToken,
  );

  if (!plan) throw new Error('The plan could not be saved.');
  return plan;
}
