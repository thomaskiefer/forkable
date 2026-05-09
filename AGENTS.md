# Forkable Agent Instructions

## Product Idea

Forkable is an adaptable CRM. The CRM changes to fit the logged-in team's sales workflow, without creating permanent customer forks.

The core story is:

1. A user signs in as a member of a company/team.
2. That team describes a CRM workflow they need.
3. Forkable turns the request into a chat-refined implementation plan.
4. A coding agent uses Nia for codebase context and Hyperspell for customer/team context.
5. The agent builds the change on a Git branch and, when schema/RLS isolation matters, an InsForge backend branch.
6. The system deploys a preview, runs smoke tests, and shows a developer review package.
7. After approval, the change merges into the shared CRM and is enabled only for the requesting company through feature flags.

Do not frame Forkable as a marketplace of one-off customer forks. Branches are temporary safety environments. Production remains one shared CRM with company-scoped feature flags.

## Company Scoping

The company receiving a change must come from the authenticated user's company mapping, not from a user-selected customer field.

Use this model:

- `auth user` -> `company_account_members.email`
- `company_account_members.company_account_id` -> `company_accounts.id`
- `change_requests.company_account_id` records the company that requested the change.
- `company_feature_flags.company_account_id` controls rollout for that company/team.
- CRM reads should use `company_account_id` and feature-flag helpers rather than comparing arbitrary customer names.

The feature-request intake should ask what workflow the team wants, not which customer to customize. If a signed-in user is not mapped to a company account, block request creation with a clear setup error instead of asking them to choose a customer.

## Feature Request Workflow

The intended end-to-end workflow is:

1. The logged-in company user creates a feature request from `/feature-requests`.
2. The planning chat iterates on the request until the implementation scope is clear.
3. `Draft plan` freezes the plan into a coding-agent handoff.
4. `Send to agent` queues an agent run.
5. The InsForge Compute runner claims the queued run.
6. The runner clones the target CRM repo, checks out `feat/<feature>`, loads the plan, and invokes Codex with the user's Codex auth.
7. The agent uses Nia before editing code and uses Hyperspell when customer/team context is needed.
8. The agent applies additive schema/UI/backend changes, preserving existing behavior for companies without the flag.
9. Checks and smoke tests run.
10. A preview and developer review package are produced.
11. Approval merges the shared product changes and enables the feature flag for the requesting company only.

Until the runner is configured with a target repo and enabled, the UI should make it clear that a run is queued but not executing.

## Demo Framing

The demo should say:

> Forkable is a CRM that adapts to each team's workflow. A team asks for custom behavior, Forkable plans it in chat, builds it on a safe branch, reviews it, and ships it back into the shared CRM behind a company feature flag.

Avoid copy that implies a human operator manually chooses a customer to receive a feature. The logged-in company/team is the rollout scope.

## Implementation Rules

- Prefer additive migrations.
- Do not drop existing tables or columns unless explicitly requested.
- Feature flags must not be frontend-only; backend enforcement is required for business rules.
- Preserve behavior for companies without the flag.
- Keep the request planning UI minimal and chat-first.
- Do not expose a feature-flags admin tab to end users.
- Keep demo data and copy consistent with the company-account model.
- Use `npx @insforge/cli`, not a global InsForge CLI.
- Use InsForge Compute for background agent runs in this demo.
