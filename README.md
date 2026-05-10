# Forkable

Forkable is a customizable sales workspace for companies with customer-specific workflows.

It starts with the everyday sales surface: leads, pipeline stages, clients,
projects, follow-ups, documents, auth, persistence, and row-level security. The
important part is what happens next: customer-specific requests become safe,
reviewable product changes that can be previewed, tested, approved, and enabled
for the right account.

## Product Positioning

Forkable is for companies that want their sales system to match how they sell instead of
forcing every customer workflow through a generic process.

- Customize fields, stages, qualification rules, approval gates, and dashboards.
- Build customer-specific behavior on a branch before it reaches production.
- Preview changes against isolated backend data.
- Run smoke tests, then merge, deploy, and notify the requester automatically.
- Ship custom behavior behind account-level feature flags.

## Demo Flow

The included demo shows a company-scoped rollout workflow:

1. Shopify requests Legal Review for deals over $50k.
2. Forkable records the request and creates a safe implementation run.
3. The change is built on a Git branch and InsForge backend branch.
4. A preview deployment and smoke-test checklist are attached to the review.
5. The developer approves the change and enables it only for the right company.
6. Stripe and other accounts keep the standard product behavior.

## Stack

- Next.js App Router
- React
- shadcn/ui-style primitives
- InsForge auth, database, storage, and RLS
- Account-level feature flags
- Additive SQL migrations

## Local Setup

Install dependencies:

```bash
pnpm install
```

Copy environment variables:

```bash
cp .env.example .env.local
```

Set the InsForge values in `.env.local`:

```text
NEXT_PUBLIC_INSFORGE_URL=
NEXT_PUBLIC_INSFORGE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Apply migrations to the linked InsForge project:

```bash
npx @insforge/cli db import migrations/20260509181347_crm-base.sql
npx @insforge/cli db import migrations/20260509182053_forkable-approval-gate.sql
npx @insforge/cli db import migrations/20260509183048_crm-storage-policies.sql
npx @insforge/cli db import migrations/20260509190000_feature-planning-chat.sql
npx @insforge/cli db import migrations/20260509193000_agent-runner.sql
npx @insforge/cli db import migrations/20260509200000_richer-two-company-demo.sql
npx @insforge/cli db import migrations/20260509201000_customer-scoped-feature-flags.sql
npx @insforge/cli db import migrations/20260509212000_realistic-company-team-demo.sql
npx @insforge/cli db import migrations/20260509213000_scheduled-agent-tasks.sql
npx @insforge/cli db import migrations/20260509214000_remove-project-codes.sql
npx @insforge/cli db import migrations/20260509220000_company-scoped-flags.sql
```

Run the app:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, then use
`Seed demo data` from the Customize page to load the realistic pipeline and
Forkable review flow.

## Useful Routes

- `/dashboard` - pipeline overview
- `/leads` - lead list
- `/leads/pipeline` - drag-and-drop pipeline
- `/feature-requests` - customer customization requests
- `/developer-guide` - Customize page

## Verification

```bash
pnpm typecheck
pnpm build
```

## Agent Runner

The coding-agent worker lives in `worker/agent-runner` and is intended to run as
an InsForge Compute service. It has two jobs:

1. Power the interactive feature-planning chat through Codex.
2. Poll queued `agent_runs`, clone the target repo, run Codex in the background,
   run checks, and write review artifacts back to InsForge.

Copy `worker/agent-runner/.env.example` to a private env file, set the server
secrets, then deploy. Keep `FORKABLE_AGENT_RUNNER_ENABLED=false` until the
Codex auth, target repo, and repo credentials are configured.

```bash
npx @insforge/cli compute deploy worker/agent-runner \
  --name forkable-agent-runner \
  --port 8080 \
  --cpu shared-2x \
  --memory 4096 \
  --region iad \
  --env-file .env.runner.local
```

To use a ChatGPT/Codex subscription instead of API-key billing, seed the runner
with Codex's file-backed login cache on a trusted machine:

```bash
codex login
base64 -i ~/.codex/auth.json | tr -d '\n'
```

Put that value in your private runner env as `CODEX_AUTH_JSON_B64`. Treat it as
a password. `CODEX_API_KEY` is simpler for automation, but the subscription path
is useful for this demo on trusted private infrastructure.

If Compute rejects the value because it is larger than the per-env-var limit,
split it into chunks and set `CODEX_AUTH_JSON_B64_PART_001`,
`CODEX_AUTH_JSON_B64_PART_002`, and so on. The runner reconstructs them in
numeric order at startup.

The runner also needs InsForge CLI auth for backend branches and managed
deployments. Seed it from a trusted local CLI login:

```bash
base64 -i ~/.insforge/credentials.json | tr -d '\n'
base64 -i ~/.insforge/config.json | tr -d '\n'
base64 -i .insforge/project.json | tr -d '\n'
```

Set those values as `INSFORGE_CLI_CREDENTIALS_JSON_B64` and
`INSFORGE_CLI_CONFIG_JSON_B64` and `INSFORGE_PROJECT_JSON_B64`, and set
`INSFORGE_PROJECT_ID` to the target project id.

To route the request-planning chat through the runner, set these on the Next app:

```bash
FEATURE_PLANNING_PROVIDER=codex
FORKABLE_AGENT_RUNNER_URL=https://your-runner.fly.dev
FORKABLE_RUNNER_WEBHOOK_SECRET=your-shared-secret
```

Forkable uses Nia for repo context and can use Hyperspell for customer context.
Index the product repo in Nia and provide the runner with:

```bash
NIA_API_KEY=your-nia-api-key
```

If customer context lives in Hyperspell, also provide:

```bash
HYPERSPELL_API_KEY=your-hyperspell-api-key
HYPERSPELL_USER_ID=your-hyperspell-user-id
```

To activate an existing deployed runner, update its env with the target repo and
keys, then set:

```bash
npx @insforge/cli compute update <service-id> \
  --env-set FORKABLE_AGENT_RUNNER_ENABLED=true
```
