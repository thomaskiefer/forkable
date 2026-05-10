# npx @insforge/cli posthog setup

One-shot CLI command that connects an InsForge project to PostHog (provisioning a PostHog account if needed) and installs the PostHog SDK into the current directory's app via deterministic per-framework templates.

## Availability

PostHog integration is in private beta. Currently rolling out to early-access partners on InsForge Cloud — older cloud projects and self-hosted backends may not expose `/integrations/posthog/v1/*` yet.

Always start with:

```bash
npx @insforge/cli posthog setup
```

If the CLI fails with `PostHog connect flow unavailable (HTTP 404)` or a similar "endpoint not found" error, your project doesn't have PostHog integration enabled yet — wait for the rollout or ask the InsForge team for early access. Do not work around this by manually pulling a `phc_` key from a separate PostHog account and embedding it: the InsForge dashboard will not surface analytics until the OAuth-backed connection is established server-side.

Self-hosted InsForge backends do not currently include PostHog integration. To use PostHog with a self-hosted project, follow PostHog's standard SDK installation docs and configure your own PostHog account directly — InsForge Analytics will not render in this case.

## Usage

```bash
cd /path/to/your/app
npx @insforge/cli link --project-id <insforge-project-id>   # if not already linked
npx @insforge/cli posthog setup                             # one shot: connect + install SDK
```

## Flags

| Flag | Description |
|------|-------------|
| `--framework <name>` | Force framework instead of auto-detect (`next-app` / `next-pages` / `vite-react` / `sveltekit` / `astro`) |
| `--skip-install` | Do not run the package manager install step (you'll need to install `posthog-js` yourself) |
| `--skip-browser` | Do not auto-open the browser; only print the URL (useful for headless / SSH sessions) |

Inherited global flags (e.g. `--json`, `--api-url`) work too — see the main CLI skill.

## What the CLI does in order

1. Reads `.insforge/project.json` from the current directory to find your InsForge project ID
2. Calls cloud-backend `/integrations/posthog/v1/cli-start`. Two outcomes:
   - **New PostHog account** (your InsForge email isn't yet in PostHog): an account + project are auto-provisioned server-side, no browser hop. PostHog sends a welcome email so you can later set a password and log in to PostHog directly
   - **Existing PostHog account**: the CLI prints a URL and opens the browser to PostHog's consent page; after you click Authorize, the CLI's polling picks up the connection
3. Calls cloud-backend `/integrations/posthog/v1/connection` to fetch the `phc_` ingestion key and PostHog host
4. Detects the project's framework from `package.json` + filesystem layout (or uses `--framework` if set). Supported: Next.js App Router, Next.js Pages Router, Vite + React, SvelteKit, Astro
5. Installs `posthog-js` via the project's package manager (npm / yarn / pnpm / bun, auto-detected from lockfile)
6. Renders the per-framework template into the right entry file:
   - **Next.js App Router**: writes `app/posthog-provider.tsx` (or `src/app/...`); emits a printable note instructing the caller to wrap `<body>{children}</body>` in `app/layout.tsx` with `<PostHogProvider>` (left as a manual or agent-applied step because layout files vary too much to safely auto-edit)
   - **Next.js Pages Router**: writes `pages/_app.tsx` if missing; emits a note if the file already exists
   - **Vite + React**: emits a snippet to add to `src/main.tsx` (too many variants — providers, custom roots — to auto-edit)
   - **SvelteKit**: writes `src/hooks.client.ts` if missing; emits a note if it exists
   - **Astro**: writes `src/lib/posthog.ts` and emits a note instructing the caller to import it from a layout `<script>` tag
7. Writes the framework-appropriate env vars to `.env` (or `.env.local` for Next.js): `*_POSTHOG_KEY` and `*_POSTHOG_HOST`

> The CLI writes the SDK provider component automatically but leaves the **layout integration** as a printed note. AI coding agents (Cursor / Claude Code / Windsurf) typically apply the note automatically; in plain terminal usage you copy the snippet from the CLI output into `app/layout.tsx` (or equivalent) yourself.

## Environment variables written

| Framework | Env file | Vars |
|-----------|----------|------|
| Next.js (App / Pages) | `.env.local` | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| Vite + React | `.env` | `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST` |
| SvelteKit | `.env` | `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST` |
| Astro | `.env` | `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST` |

Existing matching keys are left alone (the CLI never overwrites — if a value differs, it logs a warning and keeps the existing).

## Verify events are flowing

After install, run your dev server and trigger a page view. The first event arrives at PostHog within seconds. To verify without launching the app, send a test event:

```bash
curl -X POST https://us.i.posthog.com/i/v0/e/ \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "phc_...",
    "event": "$pageview",
    "distinct_id": "test_user_1",
    "properties": { "$current_url": "https://example.com" }
  }'
```

Returns `{"status": 1}` on success. The InsForge Analytics dashboard updates within a minute.

## Common Mistakes

| Mistake | Solution |
|---------|----------|
| Running `npx @insforge/cli posthog setup` outside the linked project directory | The CLI reads `.insforge/project.json` from cwd. Run it from the project root after `npx @insforge/cli link --project-id <id>` |
| Framework not auto-detected (Bun, Deno, Solid, custom setups) | The CLI prints the `phc_` key + host and a link to PostHog's docs for that framework — install posthog-js manually following PostHog's guide |
| Next.js App Router setup leaves PostHog "uninitialised" at runtime | The CLI writes `posthog-provider.tsx` but does **not** auto-edit `app/layout.tsx`. Wrap `<body>{children}</body>` with `<PostHogProvider>` from the printed note, or have your AI coding agent apply the change |
| `posthog-provider.tsx` already exists from a prior setup | The CLI skips overwriting the file (logs `already calls posthog.init — leaving it alone`). Either delete the file and re-run, or hand-edit it |
| `.env.local` already has a different `NEXT_PUBLIC_POSTHOG_KEY` | The CLI keeps the existing value and logs a warning — manually reconcile if you intended to switch projects |
