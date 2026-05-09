import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@insforge/sdk';

const runnerId = process.env.FORKABLE_AGENT_RUNNER_ID || `compute-${randomUUID()}`;
const config = {
  enabled: process.env.FORKABLE_AGENT_RUNNER_ENABLED === 'true',
  port: Number(process.env.PORT || 8080),
  pollMs: Number(process.env.FORKABLE_AGENT_RUNNER_POLL_MS || 5000),
  webhookSecret: process.env.FORKABLE_RUNNER_WEBHOOK_SECRET || '',
  insforgeUrl: requireEnv('INSFORGE_URL'),
  insforgeApiKey: requireEnv('INSFORGE_API_KEY'),
  repoUrl: process.env.FORKABLE_TARGET_REPO_URL || '',
  repoRef: process.env.FORKABLE_TARGET_REPO_REF || 'main',
  repoSubdir: process.env.FORKABLE_TARGET_REPO_SUBDIR || '',
  workdir: process.env.FORKABLE_WORKDIR || path.join(process.cwd(), '.forkable-agent-runs'),
  codexHome: process.env.FORKABLE_CODEX_HOME || path.join(process.cwd(), '.forkable-codex-home'),
  pushBranch: process.env.FORKABLE_PUSH_BRANCH === 'true',
  createBackendBranch: process.env.FORKABLE_CREATE_BACKEND_BRANCH === 'true',
  requireBackendBranch: process.env.FORKABLE_REQUIRE_BACKEND_BRANCH === 'true',
  deployPreview: process.env.FORKABLE_DEPLOY_PREVIEW === 'true',
  codexModel: process.env.CODEX_MODEL || 'gpt-5.5',
  codexReasoningEffort: process.env.CODEX_REASONING_EFFORT || 'medium',
  checks: parseCommandList(process.env.FORKABLE_CHECK_COMMANDS || ''),
};

const insforge = createClient({
  baseUrl: config.insforgeUrl,
  anonKey: config.insforgeApiKey,
  edgeFunctionToken: config.insforgeApiKey,
  isServerMode: true,
  timeout: 60000,
  retryCount: 2,
});

const state = {
  activeRunId: null,
  codexAuthReady: false,
  lastError: null,
  lastRunAt: null,
  startedAt: new Date().toISOString(),
};

startHealthServer();
await mkdir(config.workdir, { recursive: true });
await mkdir(config.codexHome, { recursive: true });
await bootstrapCodexAuth();

if (config.enabled) {
  log(`agent runner ${runnerId} polling every ${config.pollMs}ms`);
  void pollLoop();
} else {
  log('agent runner is deployed but disabled; set FORKABLE_AGENT_RUNNER_ENABLED=true to process queued runs');
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function parseCommandList(raw) {
  return raw
    .split(/\n|&&/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function log(message) {
  console.log(JSON.stringify({
    level: 'info',
    runnerId,
    message,
    at: new Date().toISOString(),
  }));
}

function logError(error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);
  state.lastError = message;
  console.error(JSON.stringify({
    level: 'error',
    runnerId,
    message,
    context,
    at: new Date().toISOString(),
  }));
}

function startHealthServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        enabled: config.enabled,
        runnerId,
        activeRunId: state.activeRunId,
        codexAuthMode: getCodexAuthMode(),
        lastError: state.lastError,
        lastRunAt: state.lastRunAt,
        startedAt: state.startedAt,
      });
      return;
    }

    if (url.pathname === '/run-once' && request.method === 'POST') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      processNextRun().catch((error) => logError(error, { source: 'run-once' }));
      sendJson(response, 202, { accepted: true });
      return;
    }

    if (url.pathname === '/planning-chat' && request.method === 'POST') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      try {
        const body = await readJsonBody(request);
        const content = await runCodexPlanningChat(body);
        sendJson(response, 200, { content, model: config.codexModel });
      } catch (error) {
        logError(error, { source: 'planning-chat' });
        sendJson(response, 500, { error: formatError(error) });
      }
      return;
    }

    if (url.pathname === '/scheduled-tasks/tick' && request.method === 'POST') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      processScheduledTasksTick()
        .catch((error) => logError(error, { source: 'scheduled-tasks-tick' }));
      sendJson(response, 202, { accepted: true });
      return;
    }

    const runNowMatch = url.pathname.match(/^\/scheduled-tasks\/([^/]+)\/run-now$/);
    if (runNowMatch && request.method === 'POST') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      processScheduledTaskRunNow(decodeURIComponent(runNowMatch[1]))
        .catch((error) => logError(error, { source: 'scheduled-task-run-now', taskId: runNowMatch[1] }));
      sendJson(response, 202, { accepted: true, taskId: decodeURIComponent(runNowMatch[1]) });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  });

  server.listen(config.port, '0.0.0.0', () => {
    log(`health server listening on ${config.port}`);
  });
}

function isAuthorized(request) {
  return Boolean(config.webhookSecret && request.headers.authorization === `Bearer ${config.webhookSecret}`);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function pollLoop() {
  while (true) {
    try {
      await processNextRun();
    } catch (error) {
      logError(error, { source: 'poll-loop' });
    }

    await sleep(config.pollMs);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processNextRun() {
  if (state.activeRunId) return;

  const run = await claimQueuedRun();
  if (!run) return;

  state.activeRunId = run.id;
  state.lastRunAt = new Date().toISOString();

  try {
    await executeRun(run);
  } catch (error) {
    await failRun(run.id, error);
  } finally {
    state.activeRunId = null;
  }
}

async function claimQueuedRun() {
  const { data, error } = await insforge.database
    .from('agent_runs')
    .select('*')
    .eq('status', 'queued')
    .order('started_at', { ascending: true })
    .range(0, 0);

  assertDb(error, 'Unable to query queued agent runs.');
  const candidate = data?.[0];
  if (!candidate) return null;

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await insforge.database
    .from('agent_runs')
    .update({
      status: 'running',
      runner_mode: 'insforge_compute',
      runner_id: runnerId,
      runner_started_at: now,
      started_at: now,
      runner_error: null,
    })
    .eq('id', candidate.id)
    .eq('status', 'queued')
    .select('*');

  assertDb(claimError, 'Unable to claim queued agent run.');
  return claimed?.[0] || null;
}

async function processScheduledTasksTick() {
  const tasks = await claimDueScheduledTasks();
  for (const task of tasks) {
    await processScheduledTask(task);
  }
}

async function processScheduledTaskRunNow(taskId) {
  const task = await claimScheduledTaskById(taskId);
  if (!task) return;
  await processScheduledTask(task);
}

async function claimDueScheduledTasks() {
  const now = new Date();
  const { data, error } = await insforge.database
    .from('scheduled_agent_tasks')
    .select('*')
    .eq('status', 'active')
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true })
    .range(0, Number(process.env.FORKABLE_SCHEDULED_TASK_TICK_LIMIT || 4) - 1);

  assertDb(error, 'Unable to query due scheduled agent tasks.');
  const claimed = [];
  for (const task of data || []) {
    const nextRunAt = calculateNextRunAt(task, now);
    const { data: rows, error: claimError } = await insforge.database
      .from('scheduled_agent_tasks')
      .update({
        last_run_at: now.toISOString(),
        next_run_at: nextRunAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', task.id)
      .eq('status', 'active')
      .eq('next_run_at', task.next_run_at)
      .select('*');

    assertDb(claimError, 'Unable to claim scheduled agent task.');
    if (rows?.[0]) claimed.push({ ...rows[0], claimed_run_at: now.toISOString() });
  }
  return claimed;
}

async function claimScheduledTaskById(taskId) {
  const now = new Date();
  const { data: task, error } = await insforge.database
    .from('scheduled_agent_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('status', 'active')
    .maybeSingle();

  assertDb(error, 'Unable to load scheduled agent task.');
  if (!task) return null;

  const nextRunAt = calculateNextRunAt(task, now);
  const { data: rows, error: claimError } = await insforge.database
    .from('scheduled_agent_tasks')
    .update({
      last_run_at: now.toISOString(),
      next_run_at: nextRunAt.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', task.id)
    .eq('status', 'active')
    .eq('next_run_at', task.next_run_at)
    .select('*');

  assertDb(claimError, 'Unable to claim scheduled agent task.');
  return rows?.[0] ? { ...rows[0], claimed_run_at: now.toISOString() } : null;
}

async function processScheduledTask(task) {
  log(`claimed scheduled task ${task.id}`);
  const execution = await createScheduledExecution(task);

  try {
    const evaluation = await evaluateScheduledTask(task);
    let result = { warranted: false, reason: evaluation.summary || 'No work warranted.' };

    if (task.task_type === 'monitor_context') {
      const created = await createScheduledMonitorWork(task, execution, evaluation);
      result = {
        warranted: true,
        reason: `Queued scheduled monitor run ${created.run.id} for change request ${created.request.id}.`,
      };
    }

    await updateScheduledExecution(execution.id, {
      status: 'succeeded',
      finished_at: new Date().toISOString(),
      result_summary: trimForDb(result.reason),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    await updateScheduledExecution(execution.id, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: trimForDb(formatError(error)),
      error: trimForDb(formatError(error)),
      updated_at: new Date().toISOString(),
    });
    throw error;
  }
}

async function createScheduledExecution(task) {
  const now = new Date().toISOString();
  const { data, error } = await insforge.database
    .from('scheduled_agent_executions')
    .insert([{
      task_id: task.id,
      status: 'running',
      scheduled_for: task.claimed_run_at || now,
      started_at: now,
      runner_id: runnerId,
      user_id: task.user_id,
    }])
    .select('*');

  assertDb(error, 'Unable to create scheduled agent execution.');
  const execution = data?.[0];
  if (!execution) throw new Error('Scheduled agent execution was not created.');
  return execution;
}

async function updateScheduledExecution(id, patch) {
  const { error } = await insforge.database
    .from('scheduled_agent_executions')
    .update(patch)
    .eq('id', id);

  assertDb(error, 'Unable to update scheduled agent execution.');
}

async function evaluateScheduledTask(task) {
  const fallback = buildScheduledEvaluationFallback(task);
  if (getCodexAuthMode() === 'none') return fallback;

  try {
    const content = await runCodexScheduledEvaluation(task);
    return {
      summary: content || fallback.summary,
      raw: content,
    };
  } catch (error) {
    logError(error, { source: 'scheduled-task-evaluation', taskId: task.id });
    return fallback;
  }
}

async function runCodexScheduledEvaluation(task) {
  assertCodexAuthAvailable();

  const evaluationId = randomUUID();
  const evaluationDir = path.join(config.workdir, 'scheduled-evaluations', evaluationId);
  const workspace = evaluationDir;
  const codexHome = path.join(config.codexHome, `scheduled-${evaluationId}`);
  const outputPath = path.join(evaluationDir, 'final.md');

  await mkdir(evaluationDir, { recursive: true });
  await prepareCodexHome(codexHome, workspace);

  await runCodexExec({
    codexHome,
    workspace,
    prompt: buildScheduledEvaluationPrompt(task),
    outputPath,
    logPath: path.join(evaluationDir, 'codex-scheduled.jsonl'),
    sandbox: 'read-only',
    timeoutMs: Number(process.env.FORKABLE_CODEX_SCHEDULED_TIMEOUT_MS || 3 * 60 * 1000),
  });

  const finalMessage = await readTextIfExists(outputPath);
  await persistCodexAuth(codexHome);
  return finalMessage.trim();
}

function buildScheduledEvaluationPrompt(task) {
  return [
    "You are Forkable's scheduled automation evaluator.",
    '',
    'Use Hyperspell MCP first when available for customer context, then use Nia MCP to think through likely codebase impact before recommending edits.',
    'Keep this lightweight. Decide whether this scheduled task warrants a coding-agent run now.',
    '',
    'Scheduled task:',
    JSON.stringify(task, null, 2),
    '',
    'Return a concise markdown note with:',
    '- customer context considered',
    '- codebase impact planning needed before edits',
    '- whether work is warranted',
    '- the smallest useful implementation objective if work is warranted',
  ].join('\n');
}

function buildScheduledEvaluationFallback(task) {
  return {
    summary: [
      `Scheduled task ${task.id} (${task.task_type || 'unknown'}) was evaluated by deterministic fallback.`,
      task.prompt ? `Prompt: ${task.prompt}` : '',
      task.context ? `Context: ${JSON.stringify(task.context)}` : '',
    ].filter(Boolean).join('\n'),
    raw: null,
  };
}

async function createScheduledMonitorWork(task, execution, evaluation) {
  const customerName = task.customer_name || task.customer || task.account_name || 'Customer';
  const customerEmail = task.customer_email || task.contact_email || 'scheduled-automation@forkable.site';
  const branchPart = slugifyBranchPart(`${customerName}-scheduled-automation`);
  const title = `${customerName} scheduled automation finding`;
  const description = trimForDb([
    'A scheduled monitor_context automation found work that should be reviewed and implemented.',
    '',
    'Prompt/context summary:',
    evaluation.summary,
  ].join('\n'));

  const { data: requestRows, error: requestError } = await insforge.database
    .from('change_requests')
    .insert([{
      title,
      customer_name: customerName,
      customer_email: customerEmail,
      description,
      status: 'planning',
      feature_key: task.feature_key || null,
      user_id: task.user_id,
    }])
    .select('*');

  assertDb(requestError, 'Unable to create scheduled change request.');
  const request = requestRows?.[0];
  if (!request) throw new Error('Scheduled change request was not created.');

  const planSnapshot = buildScheduledPlanSnapshot(task, evaluation, customerName);
  const { data: planRows, error: planError } = await insforge.database
    .from('change_request_plans')
    .insert([{
      change_request_id: request.id,
      status: 'finalized',
      summary: planSnapshot.summary,
      implementation_plan: planSnapshot.implementation_plan,
      acceptance_criteria: planSnapshot.acceptance_criteria,
      coding_agent_prompt: planSnapshot.coding_agent_prompt,
      context_bundle: planSnapshot.context_bundle,
      finalized_at: new Date().toISOString(),
      user_id: task.user_id,
    }])
    .select('*');

  assertDb(planError, 'Unable to create scheduled change request plan.');
  const plan = planRows?.[0];
  if (!plan) throw new Error('Scheduled change request plan was not created.');

  const { data: runRows, error: runError } = await insforge.database
    .from('agent_runs')
    .insert([{
      change_request_id: request.id,
      status: 'queued',
      plan_id: plan.id,
      plan_snapshot: planSnapshot,
      trigger_type: 'scheduled',
      git_branch: `feat/${branchPart}`,
      backend_branch: branchPart,
      scheduled_task_id: task.id,
      scheduled_execution_id: execution.id,
      user_id: task.user_id,
    }])
    .select('*');

  assertDb(runError, 'Unable to queue scheduled agent run.');
  const run = runRows?.[0];
  if (!run) throw new Error('Scheduled agent run was not created.');

  await createAgentStepsForScheduledRun(run, planSnapshot, branchPart, task.user_id);
  await updateChangeRequest(request.id, { status: 'building' });
  const { error: sentError } = await insforge.database
    .from('change_request_plans')
    .update({
      status: 'sent_to_agent',
      sent_to_agent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.id);

  assertDb(sentError, 'Unable to mark scheduled plan as sent.');

  return { request, plan, run };
}

function buildScheduledPlanSnapshot(task, evaluation, customerName) {
  const summary = `${customerName} scheduled automation finding from ${task.task_type}.`;
  const implementationPlan = [
    '1. Use Hyperspell MCP first to retrieve and verify customer context before deciding exact edits.',
    '2. Use Nia MCP to inspect repository structure, migrations, RLS, data access, and UI impact before editing.',
    '3. Keep the implementation narrow to the scheduled finding and preserve behavior for unrelated customers.',
    '4. Run the configured verification commands and report changed files, tests, and residual risks.',
  ].join('\n');
  const codingAgentPrompt = [
    'This run was queued by a scheduled monitor_context automation.',
    '',
    'Before editing, use Hyperspell customer context first, then use Nia for codebase impact planning.',
    'Implement only the smallest useful change warranted by this finding.',
    '',
    'Scheduled task context:',
    JSON.stringify({
      task_id: task.id,
      task_type: task.task_type,
      prompt: task.prompt || null,
      context: task.context || null,
      evaluation: evaluation.summary,
    }, null, 2),
  ].join('\n');

  return {
    summary,
    implementation_plan: implementationPlan,
    acceptance_criteria: [
      'Hyperspell customer context is considered before code edits.',
      'Nia codebase impact planning is performed before code edits.',
      'The implementation is scoped to the scheduled automation finding.',
      'Verification results and changed files are reported for review.',
    ],
    coding_agent_prompt: codingAgentPrompt,
    context_bundle: {
      source: 'scheduled_agent_task',
      scheduled_task_id: task.id,
      task_type: task.task_type,
      customer: customerName,
      evaluation_summary: evaluation.summary,
      context_sources: ['scheduled_task', 'Hyperspell customer context', 'Nia codebase impact planning'],
    },
  };
}

async function createAgentStepsForScheduledRun(run, planSnapshot, branchPart, userId) {
  const labels = [
    'Load scheduled automation plan and context bundle',
    'Use Hyperspell to inspect customer context',
    'Use Nia to inspect repo, migrations, RLS, and UI patterns',
    `Create Git branch feat/${branchPart}`,
    `Create InsForge backend branch ${branchPart}`,
    'Implement the scheduled automation finding',
    'Deploy preview and run smoke tests',
    'Prepare developer review package',
  ];

  const { error } = await insforge.database
    .from('agent_steps')
    .insert(labels.map((label, index) => ({
      run_id: run.id,
      order_index: index + 1,
      label,
      status: index === 0 ? 'running' : 'pending',
      details: index === 0 ? planSnapshot.summary : null,
      user_id: userId,
    })));

  assertDb(error, 'Unable to create scheduled agent steps.');
}

function calculateNextRunAt(task, fromDate = new Date()) {
  const cron = String(task.cron || task.cron_expression || task.schedule || '').trim();
  const everyMinutes = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    return new Date(fromDate.getTime() + Math.max(1, Number(everyMinutes[1])) * 60 * 1000);
  }

  const daily = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) {
    return nextDailyRun(Number(daily[1]), Number(daily[2]), fromDate);
  }

  const weekdays = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/);
  if (weekdays) {
    return nextWeekdayRun(Number(weekdays[1]), Number(weekdays[2]), fromDate);
  }

  return new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
}

function nextDailyRun(minute, hour, fromDate) {
  const next = new Date(fromDate);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next <= fromDate) next.setDate(next.getDate() + 1);
  return next;
}

function nextWeekdayRun(minute, hour, fromDate) {
  const next = nextDailyRun(minute, hour, fromDate);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function slugifyBranchPart(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'scheduled-automation';
}

async function executeRun(run) {
  log(`claimed run ${run.id}`);
  await updateChangeRequest(run.change_request_id, { status: 'building' });

  const context = await loadRunContext(run);
  const runDir = path.join(config.workdir, run.id);
  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });

  await setStep(run.id, 1, 'running', 'Loaded queued run from Forkable.');
  await writeFile(
    path.join(runDir, 'request-context.json'),
    JSON.stringify(context, null, 2),
  );
  await setStep(run.id, 1, 'passed', 'Loaded finalized planning chat and context bundle.');

  if (!config.repoUrl) {
    throw new Error('FORKABLE_TARGET_REPO_URL is required before the runner can clone and edit code.');
  }

  const repoRoot = await prepareRepository(run, runDir);
  const workspace = config.repoSubdir ? path.join(repoRoot, config.repoSubdir) : repoRoot;
  await assertDirectory(workspace, `Target workspace not found: ${workspace}`);

  await maybeCreateBackendBranch(run, workspace);

  const codexResult = await runCodex(run, context, workspace, runDir);
  await setStep(run.id, 5, 'passed', trimForDb(codexResult.finalMessage || 'Codex finished the implementation pass.'));

  const commitSha = await commitAndMaybePush(run, workspace);
  const checks = await runChecks(workspace, runDir);
  await recordTestResults(run, checks);

  const preview = await maybeDeployPreview(run, workspace);
  if (preview?.url) {
    await upsertPreview(run, preview);
  }

  await setStep(run.id, 8, 'passed', [
    commitSha ? `Commit: ${commitSha}` : 'No commit was created.',
    preview?.url ? `Preview: ${preview.url}` : 'Preview deployment was not requested.',
  ].join('\n'));

  const now = new Date().toISOString();
  await updateRun(run.id, {
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    runner_finished_at: now,
    finished_at: now,
    output_summary: trimForDb(codexResult.finalMessage),
    commit_sha: commitSha,
    preview_url: preview?.url || null,
  });

  await updateChangeRequest(run.change_request_id, {
    status: checks.every((check) => check.status === 'passed') ? 'review' : 'building',
  });
}

async function loadRunContext(run) {
  const [{ data: request, error: requestError }, { data: steps, error: stepsError }] =
    await Promise.all([
      insforge.database
        .from('change_requests')
        .select('*')
        .eq('id', run.change_request_id)
        .maybeSingle(),
      insforge.database
        .from('agent_steps')
        .select('*')
        .eq('run_id', run.id)
        .order('order_index', { ascending: true }),
    ]);

  assertDb(requestError, 'Unable to load change request.');
  assertDb(stepsError, 'Unable to load agent steps.');

  if (!request) throw new Error(`Change request ${run.change_request_id} was not found.`);

  let planningMessages = [];
  const { data: messages, error: messagesError } = await insforge.database
    .from('change_request_planning_messages')
    .select('*')
    .eq('change_request_id', run.change_request_id)
    .order('sort_order', { ascending: true });

  if (!messagesError) planningMessages = messages || [];

  return {
    run,
    request,
    steps: steps || [],
    planningMessages,
    planSnapshot: run.plan_snapshot || {},
  };
}

async function prepareRepository(run, runDir) {
  await setStep(run.id, 2, 'running', 'Preparing repository checkout for Nia/Codex inspection.');

  const repoRoot = path.join(runDir, 'repo');
  const cloneUrl = authenticatedGitUrl(config.repoUrl);
  await execCommand('git', ['clone', '--depth', '1', '--branch', config.repoRef, cloneUrl, repoRoot], {
    cwd: runDir,
    logPath: path.join(runDir, 'git-clone.log'),
  });

  await execCommand('git', ['checkout', '-B', run.git_branch || `feat/${run.id}`], {
    cwd: repoRoot,
    logPath: path.join(runDir, 'git-checkout.log'),
  });

  await execCommand('git', ['config', 'user.name', process.env.GIT_AUTHOR_NAME || 'Forkable Agent'], {
    cwd: repoRoot,
    logPath: path.join(runDir, 'git-config.log'),
  });
  await execCommand('git', ['config', 'user.email', process.env.GIT_AUTHOR_EMAIL || 'agent@forkable.site'], {
    cwd: repoRoot,
    logPath: path.join(runDir, 'git-config.log'),
  });

  await setStep(run.id, 2, 'passed', 'Repository cloned and feature branch checked out.');
  await setStep(run.id, 3, 'passed', `Git branch ready: ${run.git_branch || `feat/${run.id}`}`);
  return repoRoot;
}

function authenticatedGitUrl(url) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !url.startsWith('https://github.com/')) return url;
  const withoutProtocol = url.replace('https://', '');
  return `https://x-access-token:${encodeURIComponent(token)}@${withoutProtocol}`;
}

async function maybeCreateBackendBranch(run, workspace) {
  if (!config.createBackendBranch) {
    await setStep(run.id, 4, 'skipped', 'Backend branch creation is disabled for this runner.');
    return;
  }

  await setStep(run.id, 4, 'running', `Creating InsForge backend branch ${run.backend_branch}.`);

  try {
    await execCommand(
      'npx',
      ['@insforge/cli', 'branch', 'create', run.backend_branch || run.id, '--mode', 'schema-only', '--no-switch'],
      {
        cwd: workspace,
        logPath: path.join(workspace, '..', 'insforge-branch.log'),
        env: {
          ...process.env,
          INSFORGE_ACCESS_TOKEN: process.env.INSFORGE_ACCESS_TOKEN || '',
          INSFORGE_PROJECT_ID: process.env.INSFORGE_PROJECT_ID || '',
        },
      },
    );
    await setStep(run.id, 4, 'passed', `InsForge backend branch ready: ${run.backend_branch}.`);
  } catch (error) {
    if (config.requireBackendBranch) throw error;
    await setStep(run.id, 4, 'skipped', `Backend branch creation failed but is non-blocking: ${formatError(error)}`);
  }
}

async function runCodex(run, context, workspace, runDir) {
  await setStep(run.id, 5, 'running', 'Codex is implementing the planned feature.');

  assertCodexAuthAvailable();

  const codexHome = path.join(config.codexHome, `run-${run.id}`);
  const finalPath = path.join(runDir, 'final.md');
  const promptPath = path.join(runDir, 'prompt.md');
  await prepareCodexHome(codexHome, workspace);
  await writeFile(promptPath, buildPrompt(run, context));

  await runCodexExec({
    codexHome,
    workspace,
    prompt: await readFile(promptPath, 'utf8'),
    outputPath: finalPath,
    logPath: path.join(runDir, 'codex.jsonl'),
    sandbox: 'workspace-write',
    timeoutMs: Number(process.env.FORKABLE_CODEX_TIMEOUT_MS || 45 * 60 * 1000),
  });

  const finalMessage = await readTextIfExists(finalPath);
  await persistCodexAuth(codexHome);
  return { finalMessage };
}

async function runCodexPlanningChat(body) {
  assertCodexAuthAvailable();

  const planningId = randomUUID();
  const planningDir = path.join(config.workdir, 'planning', planningId);
  const workspace = planningDir;
  const codexHome = path.join(config.codexHome, `planning-${planningId}`);
  const outputPath = path.join(planningDir, 'final.md');

  await mkdir(planningDir, { recursive: true });
  await prepareCodexHome(codexHome, workspace);

  await runCodexExec({
    codexHome,
    workspace,
    prompt: buildPlanningPrompt(body),
    outputPath,
    logPath: path.join(planningDir, 'codex-planning.jsonl'),
    sandbox: 'read-only',
    timeoutMs: Number(process.env.FORKABLE_CODEX_PLANNING_TIMEOUT_MS || 3 * 60 * 1000),
  });

  const finalMessage = await readTextIfExists(outputPath);
  await persistCodexAuth(codexHome);

  if (!finalMessage.trim()) {
    throw new Error('Codex returned an empty planning response.');
  }

  return finalMessage.trim();
}

async function runCodexExec({
  codexHome,
  workspace,
  prompt,
  outputPath,
  logPath,
  sandbox,
  timeoutMs,
}) {
  await execCommand(
    'codex',
    [
      'exec',
      '--profile',
      'forkable-runner',
      '--cd',
      workspace,
      '--sandbox',
      sandbox,
      '--skip-git-repo-check',
      '--json',
      '--output-last-message',
      outputPath,
      '-',
    ],
    {
      cwd: workspace,
      input: prompt,
      logPath,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CODEX_API_KEY: process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || '',
      },
      timeoutMs,
    },
  );
}

function buildPlanningPrompt(body) {
  const request = body?.request || {};
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const latestMessage = String(body?.message || '');
  const history = messages
    .slice(-12)
    .map((message) => `${String(message.role || 'user').toUpperCase()}: ${String(message.content || '')}`)
    .join('\n\n');

  return [
    "You are Forkable's interactive feature planning agent.",
    '',
    'Your job is to help a developer and product owner refine one customer feature request into a safe coding-agent handoff.',
    '',
    'Rules:',
    '- Ask only for missing decisions that materially affect implementation.',
    '- Keep the plan grounded in Git branches, InsForge backend branches, Nia repository context, Hyperspell customer context, backend enforcement, preview deploys, smoke tests, and developer review.',
    '- Do not claim code has been changed.',
    '- Keep the reply concise and conversational.',
    '- If the request is ready, say it is ready to draft and send to the coding agent.',
    '',
    'Feature request:',
    JSON.stringify(request, null, 2),
    '',
    history ? `Planning conversation so far:\n${history}` : 'Planning conversation so far: none',
    '',
    `Latest user message: ${latestMessage}`,
  ].join('\n');
}

function buildCodexConfig(workspace) {
  const escapedWorkspace = workspace.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const parts = [
    `model = "${config.codexModel}"`,
    `model_reasoning_effort = "${config.codexReasoningEffort}"`,
    'cli_auth_credentials_store = "file"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'web_search = "disabled"',
    '',
    '[profiles.forkable-runner]',
    `model = "${config.codexModel}"`,
    `model_reasoning_effort = "${config.codexReasoningEffort}"`,
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    '',
    `[projects."${escapedWorkspace}"]`,
    'trust_level = "trusted"',
  ];

  if (process.env.NIA_API_KEY) {
    parts.push(
      '',
      '[mcp_servers.nia]',
      'url = "https://apigcp.trynia.ai/mcp"',
      'bearer_token_env_var = "NIA_API_KEY"',
      'required = false',
      'tool_timeout_sec = 120',
    );
  }

  if (process.env.HYPERSPELL_API_KEY && process.env.HYPERSPELL_USER_ID) {
    parts.push(
      '',
      '[mcp_servers.hyperspell]',
      'command = "npx"',
      'args = ["-y", "@hyperspell/hyperspell-mcp@latest", "--client=codex", "--tools=all"]',
      'env_vars = ["HYPERSPELL_API_KEY", "HYPERSPELL_USER_ID"]',
      'required = false',
      'startup_timeout_sec = 30',
      'tool_timeout_sec = 120',
    );
  }

  return `${parts.join('\n')}\n`;
}

async function prepareCodexHome(codexHome, workspace) {
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, 'config.toml'), buildCodexConfig(workspace));

  const sourceAuthPath = path.join(config.codexHome, 'auth.json');
  if (await exists(sourceAuthPath)) {
    await copyFile(sourceAuthPath, path.join(codexHome, 'auth.json'));
    await chmod(path.join(codexHome, 'auth.json'), 0o600);
  }
}

async function bootstrapCodexAuth() {
  const authPath = path.join(config.codexHome, 'auth.json');
  if (await exists(authPath)) {
    state.codexAuthReady = true;
    return;
  }

  const value = getCodexAuthJsonSeed();

  if (!value) return;

  await writeFile(authPath, value);
  await chmod(authPath, 0o600);
  state.codexAuthReady = true;
}

async function persistCodexAuth(codexHome) {
  const authPath = path.join(codexHome, 'auth.json');
  if (!(await exists(authPath))) return;

  await copyFile(authPath, path.join(config.codexHome, 'auth.json'));
  await chmod(path.join(config.codexHome, 'auth.json'), 0o600);
}

function getCodexAuthMode() {
  if (process.env.CODEX_API_KEY) return 'api_key';
  if (process.env.OPENAI_API_KEY) return 'openai_api_key_compat';
  if (process.env.CODEX_AUTH_JSON_B64 || process.env.CODEX_AUTH_JSON) return 'chatgpt_auth_seed';
  if (hasChunkedCodexAuth()) return 'chatgpt_auth_seed_chunked';
  if (state.codexAuthReady) return 'chatgpt_auth_file';
  return 'none';
}

function assertCodexAuthAvailable() {
  if (
    process.env.CODEX_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.CODEX_AUTH_JSON_B64 ||
    process.env.CODEX_AUTH_JSON ||
    hasChunkedCodexAuth() ||
    state.codexAuthReady
  ) {
    return;
  }

  throw new Error('Codex auth is not configured. Set CODEX_API_KEY or seed ChatGPT-managed auth with CODEX_AUTH_JSON_B64.');
}

function hasChunkedCodexAuth() {
  return Object.keys(process.env).some((key) => /^CODEX_AUTH_JSON_B64_PART_\d+$/.test(key));
}

function getCodexAuthJsonSeed() {
  if (process.env.CODEX_AUTH_JSON_B64) {
    return Buffer.from(process.env.CODEX_AUTH_JSON_B64, 'base64').toString('utf8');
  }

  if (process.env.CODEX_AUTH_JSON) {
    return process.env.CODEX_AUTH_JSON;
  }

  const chunks = Object.entries(process.env)
    .filter(([key]) => /^CODEX_AUTH_JSON_B64_PART_\d+$/.test(key))
    .sort(([a], [b]) => Number(a.split('_').at(-1)) - Number(b.split('_').at(-1)))
    .map(([, value]) => value || '');

  if (chunks.length === 0) return '';

  return Buffer.from(chunks.join(''), 'base64').toString('utf8');
}

function buildPrompt(run, context) {
  const plan = context.planSnapshot || {};
  const planningConversation = context.planningMessages
    .map((message) => `${String(message.role).toUpperCase()}: ${message.content}`)
    .join('\n\n');

  return [
    'You are the coding agent for Forkable.',
    '',
    'Goal:',
    plan.coding_agent_prompt || plan.summary || context.request.description,
    '',
    'Change request:',
    JSON.stringify(context.request, null, 2),
    '',
    'Run constraints:',
    `- Work on Git branch ${run.git_branch}.`,
    `- Treat InsForge backend branch ${run.backend_branch} as the isolated backend target.`,
    '- Use Nia MCP first when available to inspect repository structure, migrations, RLS policies, data access, and UI patterns before editing.',
    '- Use Hyperspell MCP when available only for customer/request context. Do not write unrelated memory.',
    '- Prefer additive migrations and small, reviewable UI changes.',
    '- Do not drop tables or columns.',
    '- Do not commit secrets, .env files, local state, or generated dependency folders.',
    '- Preserve existing behavior for customers not included in the feature rollout.',
    '',
    plan.implementation_plan ? `Implementation plan:\n${plan.implementation_plan}` : '',
    Array.isArray(plan.acceptance_criteria)
      ? `Acceptance criteria:\n${plan.acceptance_criteria.map((item) => `- ${item}`).join('\n')}`
      : '',
    planningConversation ? `Planning conversation:\n${planningConversation}` : '',
    '',
    'Final response required:',
    '- Exact files changed.',
    '- Schema/RLS changes.',
    '- Commands run and results.',
    '- Smoke test checklist.',
    '- Any residual risks or manual review notes.',
  ].filter(Boolean).join('\n');
}

async function commitAndMaybePush(run, workspace) {
  const status = await execCommand('git', ['status', '--porcelain'], {
    cwd: workspace,
    captureOnly: true,
  });

  if (!status.stdout.trim()) {
    await setStep(run.id, 6, 'skipped', 'Codex completed without file changes.');
    return null;
  }

  await execCommand('git', ['add', '-A'], {
    cwd: workspace,
    logPath: path.join(workspace, '..', 'git-add.log'),
  });
  await execCommand('git', ['commit', '-m', `Implement ${run.backend_branch || 'customer feature'}`], {
    cwd: workspace,
    logPath: path.join(workspace, '..', 'git-commit.log'),
  });

  const sha = (await execCommand('git', ['rev-parse', 'HEAD'], {
    cwd: workspace,
    captureOnly: true,
  })).stdout.trim();

  if (config.pushBranch) {
    await execCommand('git', ['push', '-u', 'origin', run.git_branch || `feat/${run.id}`], {
      cwd: workspace,
      logPath: path.join(workspace, '..', 'git-push.log'),
      timeoutMs: 10 * 60 * 1000,
    });
    await setStep(run.id, 6, 'passed', `Changes committed and pushed: ${sha}`);
  } else {
    await setStep(run.id, 6, 'passed', `Changes committed locally in runner: ${sha}`);
  }

  return sha;
}

async function runChecks(workspace, runDir) {
  await setStepFromRunDir(runDir, 7, 'running', 'Running verification commands.');

  const commands = config.checks.length > 0 ? config.checks : await detectChecks(workspace);
  const results = [];

  for (const command of commands) {
    try {
      await execShell(command, {
        cwd: workspace,
        logPath: path.join(runDir, `check-${results.length + 1}.log`),
        timeoutMs: Number(process.env.FORKABLE_CHECK_TIMEOUT_MS || 15 * 60 * 1000),
      });
      results.push({ name: command, status: 'passed', details: 'Command completed successfully.' });
    } catch (error) {
      results.push({ name: command, status: 'failed', details: trimForDb(formatError(error)) });
      break;
    }
  }

  if (results.length === 0) {
    results.push({
      name: 'No check commands configured',
      status: 'skipped',
      details: 'Set FORKABLE_CHECK_COMMANDS to run project-specific verification.',
    });
  }

  const allPassed = results.every((result) => result.status === 'passed');
  await setStepFromRunDir(
    runDir,
    7,
    allPassed ? 'passed' : 'failed',
    results.map((result) => `${result.status}: ${result.name}`).join('\n'),
  );

  return results;
}

async function detectChecks(workspace) {
  const packagePath = path.join(workspace, 'package.json');
  try {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    const commands = [];

    if (await exists(path.join(workspace, 'pnpm-lock.yaml'))) {
      commands.push('corepack enable && pnpm install --frozen-lockfile');
      if (packageJson.scripts?.typecheck) commands.push('pnpm typecheck');
      if (packageJson.scripts?.build) commands.push('pnpm build');
    } else if (await exists(path.join(workspace, 'package-lock.json'))) {
      commands.push('npm ci');
      if (packageJson.scripts?.typecheck) commands.push('npm run typecheck');
      if (packageJson.scripts?.build) commands.push('npm run build');
    } else {
      commands.push('npm install');
      if (packageJson.scripts?.typecheck) commands.push('npm run typecheck');
      if (packageJson.scripts?.build) commands.push('npm run build');
    }

    return commands;
  } catch {
    return [];
  }
}

async function recordTestResults(run, checks) {
  const rows = checks.map((check) => ({
    run_id: run.id,
    name: check.name,
    status: check.status,
    details: check.details,
    user_id: run.user_id,
  }));

  const { error } = await insforge.database.from('test_results').insert(rows);
  assertDb(error, 'Unable to record test results.');
}

async function maybeDeployPreview(run, workspace) {
  if (!config.deployPreview) return null;

  await execCommand(
    'npx',
    ['@insforge/cli', 'deployments', 'deploy', '.', '--json'],
    {
      cwd: workspace,
      logPath: path.join(workspace, '..', 'preview-deploy.json'),
      timeoutMs: 20 * 60 * 1000,
    },
  );

  const raw = await readTextIfExists(path.join(workspace, '..', 'preview-deploy.json'));
  const deployment = parseLastJsonObject(raw);
  return {
    url: deployment?.url || deployment?.deploymentUrl || deployment?.app_url || null,
    id: deployment?.id || deployment?.deployment_id || null,
  };
}

async function upsertPreview(run, preview) {
  const { error } = await insforge.database.from('branch_previews').insert([{
    run_id: run.id,
    app_url: preview.url,
    backend_branch: run.backend_branch,
    deployment_id: preview.id,
    status: 'ready',
    user_id: run.user_id,
  }]);

  assertDb(error, 'Unable to record preview deployment.');
}

async function failRun(runId, error) {
  const message = trimForDb(formatError(error));
  logError(error, { runId });

  const now = new Date().toISOString();
  await updateRun(runId, {
    status: 'failed',
    runner_error: message,
    runner_finished_at: now,
    finished_at: now,
  });

  const { data: steps } = await insforge.database
    .from('agent_steps')
    .select('*')
    .eq('run_id', runId)
    .order('order_index', { ascending: true });

  const runningStep = steps?.find((step) => step.status === 'running');
  if (runningStep) {
    await setStep(runId, runningStep.order_index, 'failed', message);
  }
}

async function updateRun(id, patch) {
  const { error } = await insforge.database
    .from('agent_runs')
    .update(patch)
    .eq('id', id);

  assertDb(error, 'Unable to update agent run.');
}

async function updateChangeRequest(id, patch) {
  const { error } = await insforge.database
    .from('change_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);

  assertDb(error, 'Unable to update change request.');
}

async function setStep(runId, orderIndex, status, details) {
  const patch = {
    status,
    details: details ? trimForDb(details) : null,
    completed_at: ['passed', 'failed', 'skipped'].includes(status) ? new Date().toISOString() : null,
  };

  const { error } = await insforge.database
    .from('agent_steps')
    .update(patch)
    .eq('run_id', runId)
    .eq('order_index', orderIndex);

  assertDb(error, `Unable to update step ${orderIndex}.`);
}

async function setStepFromRunDir(runDir, orderIndex, status, details) {
  const runId = path.basename(runDir);
  await setStep(runId, orderIndex, status, details);
}

async function execShell(command, options = {}) {
  return execCommand('/bin/sh', ['-lc', command], options);
}

async function execCommand(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    input,
    logPath,
    captureOnly = false,
    timeoutMs = 10 * 60 * 1000,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const logStream = logPath && !captureOnly ? createWriteStream(logPath, { flags: 'a' }) : null;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(redact(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`)));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = redact(String(chunk));
      stdout += text;
      logStream?.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = redact(String(chunk));
      stderr += text;
      logStream?.write(text);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      logStream?.end();
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      logStream?.end();
      const result = { code, stdout, stderr };

      if (code === 0) {
        resolve(result);
        return;
      }

      const error = new Error(redact(`Command failed (${code}): ${command} ${args.join(' ')}\n${tail(stderr || stdout)}`));
      error.result = result;
      reject(error);
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function redact(value) {
  let output = value;
  for (const secret of [
    process.env.INSFORGE_API_KEY,
    process.env.CODEX_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.CODEX_AUTH_JSON,
    process.env.CODEX_AUTH_JSON_B64,
    ...Object.entries(process.env)
      .filter(([key]) => /^CODEX_AUTH_JSON_B64_PART_\d+$/.test(key))
      .map(([, value]) => value),
    process.env.GITHUB_TOKEN,
    process.env.NIA_API_KEY,
    process.env.HYPERSPELL_API_KEY,
    process.env.INSFORGE_ACCESS_TOKEN,
  ]) {
    if (secret) output = output.split(secret).join('[redacted]');
  }
  return output;
}

function trimForDb(value) {
  return String(value || '').slice(0, 12000);
}

function tail(value) {
  return trimForDb(value).split('\n').slice(-40).join('\n');
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertDb(error, message) {
  if (!error) return;
  throw new Error(`${message} ${error.message || JSON.stringify(error)}`);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertDirectory(directory, message) {
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) throw new Error(message);
  } catch {
    throw new Error(message);
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseLastJsonObject(raw) {
  const lines = raw.trim().split('\n').filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // Keep looking for JSON in command output.
    }
  }
  return null;
}
