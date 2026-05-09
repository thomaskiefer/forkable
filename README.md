# Forkable

Forkable is a customizable sales workspace for teams with customer-specific workflows.

It starts with the everyday sales surface: leads, pipeline stages, clients,
projects, follow-ups, documents, auth, persistence, and row-level security. The
important part is what happens next: customer-specific requests become safe,
reviewable product changes that can be previewed, tested, approved, and enabled
for the right account.

## Product Positioning

Forkable is for teams that want their sales system to match how they sell instead of
forcing every customer workflow through a generic process.

- Customize fields, stages, qualification rules, approval gates, and dashboards.
- Build customer-specific behavior on a branch before it reaches production.
- Preview changes against isolated backend data.
- Run smoke tests and developer review before merge.
- Ship custom behavior behind account-level feature flags.

## Demo Flow

The included demo shows a company/team-scoped rollout workflow:

1. Shopify Enterprise Sales requests Legal Review for deals over $50k.
2. Forkable records the request and creates a safe implementation run.
3. The change is built on a Git branch and InsForge backend branch.
4. A preview deployment and smoke-test checklist are attached to the review.
5. The developer approves the change and enables it only for the right company/team.
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
npx @insforge/cli db import migrations/20260509200000_richer_two_company_demo.sql
npx @insforge/cli db import migrations/20260509201000_customer_scoped_feature_flags.sql
npx @insforge/cli db import migrations/20260509212000_realistic_company_team_demo.sql
npx @insforge/cli db import migrations/20260509213000_scheduled-agent-tasks.sql
npx @insforge/cli db import migrations/20260509214000_remove_project_codes.sql
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

To route the request-planning chat through the runner, set these on the Next app:

```bash
FEATURE_PLANNING_PROVIDER=codex
FORKABLE_AGENT_RUNNER_URL=https://your-runner.fly.dev
FORKABLE_RUNNER_WEBHOOK_SECRET=your-shared-secret
```

To activate an existing deployed runner, update its env with the target repo and
keys, then set:

```bash
npx @insforge/cli compute update <service-id> \
  --env-set FORKABLE_AGENT_RUNNER_ENABLED=true
```
