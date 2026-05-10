import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
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
  insforgeAccessToken: process.env.INSFORGE_ACCESS_TOKEN || '',
  insforgeProjectId: process.env.INSFORGE_PROJECT_ID || '',
  insforgeCliHome: process.env.INSFORGE_CLI_HOME || path.join(process.env.HOME || '/root', '.insforge'),
  insforgeProjectJson: getSeededJson('INSFORGE_PROJECT_JSON', 'INSFORGE_PROJECT_JSON_B64'),
  niaConfigHome: process.env.NIA_CONFIG_HOME || path.join(process.env.HOME || '/root', '.config', 'nia'),
  niaConfigJson: getSeededJson('NIA_CONFIG_JSON', 'NIA_CONFIG_JSON_B64'),
  repoUrl: process.env.FORKABLE_TARGET_REPO_URL || '',
  repoRef: process.env.FORKABLE_TARGET_REPO_REF || 'main',
  repoSubdir: process.env.FORKABLE_TARGET_REPO_SUBDIR || '',
  workdir: process.env.FORKABLE_WORKDIR || path.join(process.cwd(), '.forkable-agent-runs'),
  repoCacheDir: process.env.FORKABLE_REPO_CACHE_DIR || path.join(process.cwd(), '.forkable-repo-cache'),
  codexHome: process.env.FORKABLE_CODEX_HOME || path.join(process.cwd(), '.forkable-codex-home'),
  pushBranch: process.env.FORKABLE_PUSH_BRANCH !== 'false',
  autoMerge: process.env.FORKABLE_AUTO_MERGE !== 'false',
  createBackendBranch: process.env.FORKABLE_CREATE_BACKEND_BRANCH === 'true',
  requireBackendBranch: process.env.FORKABLE_REQUIRE_BACKEND_BRANCH === 'true',
  deployPreview: process.env.FORKABLE_DEPLOY_PREVIEW === 'true',
  deployProduction: process.env.FORKABLE_DEPLOY_PRODUCTION !== 'false',
  codexModel: process.env.CODEX_MODEL || 'gpt-5.5',
  codexReasoningEffort: normalizeCodexReasoningEffort(process.env.CODEX_REASONING_EFFORT || 'low'),
  skipVerification: process.env.FORKABLE_SKIP_VERIFICATION !== 'false',
  checks: parseCommandList(process.env.FORKABLE_CHECK_COMMANDS || ''),
};
const staleScheduledExecutionMs = Number(
  process.env.FORKABLE_STALE_SCHEDULED_EXECUTION_MS || 10 * 60 * 1000,
);

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
  insforgeCliAuthReady: false,
  niaConfigReady: false,
  lastError: null,
  lastRunAt: null,
  startedAt: new Date().toISOString(),
};

startHealthServer();
await mkdir(config.workdir, { recursive: true });
await mkdir(config.codexHome, { recursive: true });
await bootstrapInsforgeCliAuth();
await bootstrapNiaConfig();
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
        codexReasoningEffort: config.codexReasoningEffort,
        insforgeCliAuthMode: getInsforgeCliAuthMode(),
        niaMcpConfigured: Boolean(process.env.NIA_API_KEY),
        niaCliConfigMode: state.niaConfigReady ? 'config_file' : 'missing',
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

    const runStreamMatch = url.pathname.match(/^\/agent-runs\/([^/]+)\/stream$/);
    if (runStreamMatch && request.method === 'POST') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      await streamAgentRun(runStreamMatch[1], response);
      return;
    }

    if (url.pathname === '/planning-chat' && request.method === 'POST') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      try {
        const body = await readJsonBody(request);
        if (request.headers.accept?.includes('application/x-ndjson')) {
          response.writeHead(200, {
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Content-Type': 'application/x-ndjson; charset=utf-8',
          });

          const writeEvent = (event) => {
            response.write(`${JSON.stringify(event)}\n`);
          };

          const content = await runCodexPlanningChat(body, {
            onDelta: (content) => writeEvent({ type: 'delta', content }),
            onStatus: (message) => writeEvent({ type: 'status', message }),
          });

          writeEvent({ type: 'done', content, model: config.codexModel });
          response.end();
        } else {
          const content = await runCodexPlanningChat(body);
          sendJson(response, 200, { content, model: config.codexModel });
        }
      } catch (error) {
        logError(error, { source: 'planning-chat' });
        const publicError = formatPlanningChatError(error);
        if (response.headersSent) {
          response.write(`${JSON.stringify({ type: 'error', error: publicError })}\n`);
          response.end();
        } else {
          sendJson(response, 500, { error: publicError });
        }
      }
      return;
    }

    if (url.pathname === '/automation-setup' && request.method === 'POST') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      try {
        const body = await readJsonBody(request);
        const setup = await runCodexAutomationSetup(body);
        sendJson(response, 200, { setup, model: config.codexModel });
      } catch (error) {
        logError(error, { source: 'automation-setup' });
        sendJson(response, 500, { error: formatPlanningChatError(error) });
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

      try {
        const taskId = decodeURIComponent(runNowMatch[1]);
        const body = await readJsonBody(request).catch(() => ({}));
        const task = await claimScheduledTaskById(taskId);
        if (!task) {
          sendJson(response, 409, {
            error: 'Automation is not active, is already running, or could not be claimed.',
          });
          return;
        }

        processScheduledTask(task, {
          triggerType: 'manual',
          requestedBy: typeof body.requestedBy === 'string' ? body.requestedBy : null,
        }).catch((error) => logError(error, { source: 'scheduled-task-run-now', taskId }));
        sendJson(response, 202, { accepted: true, taskId });
      } catch (error) {
        logError(error, { source: 'scheduled-task-run-now', taskId: runNowMatch[1] });
        sendJson(response, 500, { error: formatError(error) });
      }
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
  await reconcileActiveRun();
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

async function streamAgentRun(runId, response) {
  await reconcileActiveRun();
  if (state.activeRunId) {
    const activeMessage = state.activeRunId === runId
      ? `Runner is already processing this run (${state.activeRunId}).`
      : `Runner is already processing ${state.activeRunId}.`;
    sendJson(response, 409, { error: activeMessage });
    return;
  }

  const run = await claimQueuedRunById(runId);
  if (!run) {
    sendJson(response, 404, { error: 'Queued agent run was not found.' });
    return;
  }

  state.activeRunId = run.id;
  state.lastRunAt = new Date().toISOString();

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'application/x-ndjson; charset=utf-8',
  });

  const writeEvent = (event) => {
    response.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const result = await executeRun(run, {
      onDelta: (content) => writeEvent({ type: 'delta', content }),
    });
    writeEvent({
      type: 'done',
      content: result?.finalMessage || 'Coding agent run finished.',
      runId: run.id,
    });
  } catch (error) {
    await failRun(run.id, error, { postPlanningMessage: false });
    writeEvent({ type: 'error', error: formatPlanningChatError(error) });
  } finally {
    state.activeRunId = null;
    response.end();
  }
}

async function reconcileActiveRun() {
  if (!state.activeRunId) return;

  const activeRunId = state.activeRunId;
  try {
    const { data, error } = await insforge.database
      .from('agent_runs')
      .select('id,status,runner_finished_at')
      .eq('id', activeRunId)
      .maybeSingle();

    assertDb(error, 'Unable to reconcile active agent run.');

    if (!data || data.status !== 'running' || data.runner_finished_at) {
      log(`clearing stale active run ${activeRunId}`);
      state.activeRunId = null;
    }
  } catch (error) {
    logError(error, { source: 'reconcile-active-run', activeRunId });
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

async function claimQueuedRunById(runId) {
  const now = new Date().toISOString();
  const { data: claimed, error } = await insforge.database
    .from('agent_runs')
    .update({
      status: 'running',
      runner_mode: 'insforge_compute',
      runner_id: runnerId,
      runner_started_at: now,
      started_at: now,
      runner_error: null,
    })
    .eq('id', runId)
    .eq('status', 'queued')
    .select('*');

  assertDb(error, 'Unable to claim queued agent run.');
  return claimed?.[0] || null;
}

async function processScheduledTasksTick() {
  await reconcileStaleScheduledExecutions();
  const tasks = await claimDueScheduledTasks();
  for (const task of tasks) {
    await processScheduledTask(task);
  }
}

async function processScheduledTaskRunNow(taskId) {
  const task = await claimScheduledTaskById(taskId);
  if (!task) return;
  await processScheduledTask(task, { triggerType: 'manual' });
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
    const taskPatch = buildScheduledTaskClaimPatch(task, now, nextRunAt);
    const { data: rows, error: claimError } = await insforge.database
      .from('scheduled_agent_tasks')
      .update(taskPatch)
      .eq('id', task.id)
      .eq('status', 'active')
      .eq('next_run_at', task.next_run_at)
      .eq('updated_at', task.updated_at)
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
  await reconcileStaleScheduledExecutions(task.id);
  if (await hasRunningScheduledExecution(task.id)) return null;

  const nextRunAt = calculateNextRunAt(task, now);
  const taskPatch = buildScheduledTaskClaimPatch(task, now, nextRunAt);
  let claimQuery = insforge.database
    .from('scheduled_agent_tasks')
    .update(taskPatch)
    .eq('id', task.id)
    .eq('status', 'active')
    .eq('updated_at', task.updated_at);

  claimQuery = task.next_run_at
    ? claimQuery.eq('next_run_at', task.next_run_at)
    : claimQuery.is('next_run_at', null);

  const { data: rows, error: claimError } = await claimQuery.select('*');

  assertDb(claimError, 'Unable to claim scheduled agent task.');
  return rows?.[0] ? { ...rows[0], claimed_run_at: now.toISOString() } : null;
}

function isOneShotTask(task) {
  return String(task.schedule_type || '').toLowerCase() === 'once';
}

function buildScheduledTaskClaimPatch(task, now, nextRunAt) {
  return {
    last_run_at: now.toISOString(),
    next_run_at: nextRunAt ? nextRunAt.toISOString() : null,
    updated_at: now.toISOString(),
    metadata: {
      ...(task.metadata || {}),
      last_claimed_by: runnerId,
      last_claimed_at: now.toISOString(),
    },
  };
}

async function finalizeOneShotTask(task, status = 'paused') {
  if (!isOneShotTask(task)) return;

  const now = new Date().toISOString();
  const { error } = await insforge.database
    .from('scheduled_agent_tasks')
    .update({
      status,
      next_run_at: null,
      paused_at: now,
      updated_at: now,
      metadata: {
        ...(task.metadata || {}),
        completed_once_at: now,
        completed_once_by: runnerId,
      },
    })
    .eq('id', task.id);

  assertDb(error, 'Unable to finalize one-shot scheduled agent task.');
}

async function reconcileStaleScheduledExecutions(taskId = null) {
  const cutoff = new Date(Date.now() - staleScheduledExecutionMs).toISOString();
  let query = insforge.database
    .from('scheduled_agent_executions')
    .select('*')
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .neq('runner_id', runnerId)
    .range(0, Number(process.env.FORKABLE_STALE_SCHEDULED_EXECUTION_LIMIT || 10) - 1);

  if (taskId) query = query.eq('task_id', taskId);

  const { data, error } = await query;
  assertDb(error, 'Unable to query stale scheduled agent executions.');

  for (const execution of data || []) {
    const now = new Date().toISOString();
    const message = `Execution was claimed by ${execution.runner_id || 'unknown runner'} and became stale before completion.`;
    const { error: updateError } = await insforge.database
      .from('scheduled_agent_executions')
      .update({
        status: 'failed',
        finished_at: now,
        error_message: trimForDb(message),
        error: trimForDb(message),
        updated_at: now,
      })
      .eq('id', execution.id)
      .eq('status', 'running');

    assertDb(updateError, 'Unable to mark stale scheduled agent execution failed.');
    await finalizeStaleOneShotTask(execution.task_id).catch((finalizeError) => logError(finalizeError, {
      source: 'scheduled-task-stale-finalize-once',
      taskId: execution.task_id,
      executionId: execution.id,
    }));
  }
}

async function finalizeStaleOneShotTask(taskId) {
  if (!taskId) return;

  const { data: task, error } = await insforge.database
    .from('scheduled_agent_tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();

  assertDb(error, 'Unable to load stale one-shot scheduled agent task.');
  if (!task || !isOneShotTask(task)) return;
  await finalizeOneShotTask(task);
}

async function hasRunningScheduledExecution(taskId) {
  const { data, error } = await insforge.database
    .from('scheduled_agent_executions')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'running')
    .range(0, 0);

  assertDb(error, 'Unable to check scheduled agent execution state.');
  return Boolean(data?.[0]);
}

async function processScheduledTask(task, options = {}) {
  log(`claimed scheduled task ${task.id}`);
  const execution = await createScheduledExecution(task, options);

  try {
    const evaluation = await evaluateScheduledTask(task);
    let result = { warranted: false, reason: evaluation.summary || 'No work warranted.' };
    let created = null;

    if (['monitor_context', 'queue_agent'].includes(task.task_type) && evaluation.warranted) {
      created = await createScheduledMonitorWork(task, execution, evaluation);
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
    await createScheduledTaskNotification(task, execution, {
      evaluation,
      result,
      created,
    }).catch((notificationError) => logError(notificationError, {
      source: 'scheduled-task-notification',
      taskId: task.id,
      executionId: execution.id,
    }));
    await finalizeOneShotTask(task);
  } catch (error) {
    await updateScheduledExecution(execution.id, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: trimForDb(formatError(error)),
      error: trimForDb(formatError(error)),
      updated_at: new Date().toISOString(),
    });
    await createNotification({
      title: `${task.title || 'Scheduled automation'} failed`,
      body: trimForDb(formatError(error)),
      kind: 'error',
      source_type: 'scheduled_agent',
      action_label: 'Open automation',
      action_href: `/automations?task=${task.id}`,
      scheduled_task_id: task.id,
      scheduled_execution_id: execution.id,
      metadata: {
        runner_id: runnerId,
        task_type: task.task_type,
      },
      user_id: task.user_id,
    }).catch((notificationError) => logError(notificationError, {
      source: 'scheduled-task-notification',
      taskId: task.id,
    }));
    await finalizeOneShotTask(task).catch((finalizeError) => logError(finalizeError, {
      source: 'scheduled-task-finalize-once',
      taskId: task.id,
    }));
    throw error;
  }
}

async function createScheduledExecution(task, options = {}) {
  const now = new Date().toISOString();
  const triggerType = options.triggerType || 'scheduled';
  const { data, error } = await insforge.database
    .from('scheduled_agent_executions')
    .insert([{
      task_id: task.id,
      status: 'running',
      scheduled_for: task.claimed_run_at || now,
      started_at: now,
      runner_id: runnerId,
      user_id: task.user_id,
      metadata: {
        trigger_type: triggerType,
        requested_by: options.requestedBy || null,
      },
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

async function createNotification(record) {
  const { data, error } = await insforge.database
    .from('user_notifications')
    .insert([{
      title: record.title,
      body: record.body || '',
      kind: record.kind || 'info',
      source_type: record.source_type || 'system',
      action_label: record.action_label || null,
      action_href: record.action_href || null,
      scheduled_task_id: record.scheduled_task_id || null,
      scheduled_execution_id: record.scheduled_execution_id || null,
      change_request_id: record.change_request_id || null,
      plan_id: record.plan_id || null,
      agent_run_id: record.agent_run_id || null,
      metadata: record.metadata || {},
      user_id: record.user_id,
    }])
    .select('*');

  if (isMissingOptionalTable(error, 'user_notifications')) return null;
  assertDb(error, 'Unable to create notification.');
  return data?.[0] || null;
}

function isMissingOptionalTable(error, tableName) {
  const message = String(error?.message || error?.error || '');
  return (
    message.includes(tableName) &&
    (message.includes('does not exist') || message.includes('not found'))
  );
}

async function createScheduledTaskNotification(task, execution, details) {
  const created = details.created;
  const title = created
    ? `${task.title || 'Scheduled automation'} queued an agent run`
    : `${task.title || 'Scheduled automation'} checked context`;
  const body = created
    ? [
        details.evaluation.summary,
        '',
        `Queued run ${created.run.id} from scheduled execution ${execution.id}.`,
      ].join('\n')
    : details.result.reason;

  await createNotification({
    title,
    body: trimForDb(body),
    kind: created ? 'success' : 'info',
    source_type: 'scheduled_agent',
    action_label: created ? 'Review run' : 'Open automation',
    action_href: created ? `/feature-runs/${created.run.id}` : `/automations?task=${task.id}`,
    scheduled_task_id: task.id,
    scheduled_execution_id: execution.id,
    change_request_id: created?.request?.id || null,
    plan_id: created?.plan?.id || null,
    agent_run_id: created?.run?.id || null,
    metadata: {
      runner_id: runnerId,
      task_type: task.task_type,
      warranted: Boolean(created),
      context_sources: details.evaluation.raw ? ['codex_scheduled_evaluation'] : ['deterministic_fallback'],
    },
    user_id: task.user_id,
  });
}

async function evaluateScheduledTask(task) {
  if (task.task_type === 'report_only') {
    return buildReportOnlyScheduledEvaluation(task);
  }

  const fallback = buildScheduledEvaluationFallback(task);
  if (getCodexAuthMode() === 'none') return fallback;

  try {
    const content = await runCodexScheduledEvaluation(task);
    return {
      summary: content || fallback.summary,
      raw: content,
      warranted: inferWorkWarranted(content, task),
    };
  } catch (error) {
    logError(error, { source: 'scheduled-task-evaluation', taskId: task.id });
    return fallback;
  }
}

function buildReportOnlyScheduledEvaluation(task) {
  const prompt = String(task.prompt || task.instructions || task.description || '').trim();
  const echo = prompt.match(/^echo\s+(.+)$/i);
  const summary = echo ? echo[1].trim() : prompt || 'Scheduled automation ran.';
  return {
    summary,
    raw: null,
    warranted: false,
  };
}

function inferWorkWarranted(content, task) {
  if (task.task_type === 'queue_agent') return true;
  const text = String(content || '').toLowerCase();
  if (!text.trim()) return false;
  if (/\b(no work|not warranted|nothing changed|no changes|do not queue|no action)\b/.test(text)) {
    return false;
  }
  if (/\b(work is warranted|warranted:\s*yes|queue an? agent|create a feature request|implementation objective)\b/.test(text)) {
    return true;
  }
  return false;
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
    warranted: task.task_type === 'queue_agent',
  };
}

async function resolveCompanyAccountIdForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;

  const { data, error } = await insforge.database
    .from('company_account_members')
    .select('company_account_id')
    .eq('email', normalized)
    .range(0, 0);

  if (error) {
    logError(error, { source: 'scheduled-company-account-lookup', email: normalized });
    return null;
  }

  return data?.[0]?.company_account_id || null;
}

async function createScheduledMonitorWork(task, execution, evaluation) {
  const customerName = task.customer_name || task.customer || task.account_name || 'Customer';
  const customerEmail = task.customer_email || task.contact_email || 'scheduled-automation@forkable.site';
  const companyAccountId = await resolveCompanyAccountIdForEmail(customerEmail);
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
      company_account_id: companyAccountId,
      user_id: task.user_id,
    }])
    .select('*');

  assertDb(requestError, 'Unable to create scheduled change request.');
  const request = requestRows?.[0];
  if (!request) throw new Error('Scheduled change request was not created.');

  try {
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
        trigger_type: execution.metadata?.trigger_type === 'manual' ? 'manual' : 'scheduled',
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
    await updateScheduledExecution(execution.id, {
      change_request_id: request.id,
      plan_id: plan.id,
      agent_run_id: run.id,
      updated_at: new Date().toISOString(),
    });
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
  } catch (error) {
    await insforge.database.from('change_requests').delete().eq('id', request.id);
    throw error;
  }
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
      'Verification results and changed files are captured before automatic merge and deploy.',
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
  await createRunEvent(run, 'summary', `Queued scheduled Codex run for ${planSnapshot.summary || branchPart}.\n`);
}

function calculateNextRunAt(task, fromDate = new Date()) {
  const cron = String(task.cron || task.cron_expression || task.schedule || '').trim();
  const scheduleType = String(task.schedule_type || '').toLowerCase();
  if (scheduleType === 'manual' || scheduleType === 'once') return null;
  if (!cron) return null;

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

  return null;
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

async function executeRun(run, streamHandlers = {}) {
  log(`claimed run ${run.id}`);
  const isStreaming = Boolean(streamHandlers.onDelta || streamHandlers.onStatus);
  streamHandlers.onStatus?.('Loading run context');
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

  const codexResult = await runCodex(run, context, workspace, runDir, streamHandlers);
  await setStep(run.id, 5, 'passed', trimForDb(codexResult.finalMessage || 'Codex finished the implementation pass.'));

  streamHandlers.onStatus?.('Committing changes');
  const commitSha = await commitAndMaybePush(run, workspace);
  streamHandlers.onStatus?.('Running verification');
  const checks = await runChecks(workspace, runDir);
  await recordTestResults(run, checks);

  streamHandlers.onStatus?.('Preparing preview and automatic shipment');
  const preview = await maybeDeployPreview(run, workspace);
  if (preview?.url) {
    await upsertPreview(run, preview);
  }

  const checksPassed = checks.every((check) => ['passed', 'skipped'].includes(check.status));
  let finalization = null;

  if (checksPassed) {
    finalization = await finalizeSuccessfulRun(run, context, workspace, runDir, {
      commitSha,
      preview,
    });
  } else {
    await setStep(run.id, 8, 'failed', 'Verification failed; automatic merge and deploy were skipped.');
  }

  const now = new Date().toISOString();
  await updateRun(run.id, {
    status: checksPassed ? 'merged' : 'failed',
    runner_finished_at: now,
    finished_at: now,
    output_summary: trimForDb(codexResult.finalMessage),
    commit_sha: commitSha,
    preview_url: finalization?.productionUrl || preview?.url || null,
  });

  await updateChangeRequest(run.change_request_id, {
    status: checksPassed ? 'merged' : 'building',
  });

  await createRunNotification({
    run,
    request: context.request,
    success: checksPassed,
    finalization,
    preview,
  });

  if (!isStreaming) {
    await createRunPlanningMessage({
      runId: run.id,
      changeRequestId: run.change_request_id,
      planId: run.plan_id || null,
      userId: run.user_id,
      content: buildRunCompletionChatMessage({
        runId: run.id,
        status: checksPassed ? 'merged' : 'failed',
        success: checksPassed,
        finalization,
        preview,
      }),
      metadata: {
        provider: 'codex_runner',
        run_id: run.id,
        plan_id: run.plan_id || null,
        kind: 'run_completion',
      },
    });
  }

  return {
    finalMessage: codexResult.finalMessage,
    commitSha,
    preview,
    checks,
    finalization,
  };
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
  await setStep(run.id, 2, 'running', 'Refreshing reusable repository checkout for Nia/Codex inspection.');

  const repoRoot = path.join(config.repoCacheDir, 'repo');
  const cloneUrl = authenticatedGitUrl(config.repoUrl);

  if (await exists(path.join(repoRoot, '.git'))) {
    await execCommand('git', ['remote', 'set-url', 'origin', cloneUrl], {
      cwd: repoRoot,
      logPath: path.join(runDir, 'git-remote.log'),
    });
    await execCommand('git', ['fetch', 'origin', config.repoRef, '--prune'], {
      cwd: repoRoot,
      logPath: path.join(runDir, 'git-fetch.log'),
      timeoutMs: 10 * 60 * 1000,
    });
    await execCommand('git', ['checkout', config.repoRef], {
      cwd: repoRoot,
      logPath: path.join(runDir, 'git-checkout-base.log'),
    });
    await execCommand('git', ['reset', '--hard', `origin/${config.repoRef}`], {
      cwd: repoRoot,
      logPath: path.join(runDir, 'git-reset.log'),
    });
    await execCommand('git', ['clean', '-fd'], {
      cwd: repoRoot,
      logPath: path.join(runDir, 'git-clean.log'),
    });
  } else {
    await rm(repoRoot, { recursive: true, force: true });
    await mkdir(path.dirname(repoRoot), { recursive: true });
    await execCommand('git', ['clone', '--branch', config.repoRef, cloneUrl, repoRoot], {
      cwd: path.dirname(repoRoot),
      logPath: path.join(runDir, 'git-clone.log'),
      timeoutMs: 10 * 60 * 1000,
    });
  }

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
  await writeFile(path.join(repoRoot, '.git', 'info', 'exclude'), '\n.forkable/\n', { flag: 'a' });

  await setStep(run.id, 2, 'passed', 'Reusable repository checkout refreshed to the latest target ref.');
  await setStep(run.id, 3, 'passed', `Git branch ready: ${run.git_branch || `feat/${run.id}`}`);
  await prepareInsforgeProjectLink(repoRoot);
  return repoRoot;
}

async function prepareInsforgeProjectLink(workspace) {
  const projectJson = config.insforgeProjectJson || buildMinimalInsforgeProjectJson();
  if (!projectJson) return;

  const insforgeDir = path.join(workspace, '.insforge');
  await mkdir(insforgeDir, { recursive: true });
  await writeFile(path.join(insforgeDir, 'project.json'), projectJson);
}

function buildMinimalInsforgeProjectJson() {
  if (!config.insforgeProjectId) return '';
  return `${JSON.stringify({ project_id: config.insforgeProjectId }, null, 2)}\n`;
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
        env: insforgeCliEnv(),
      },
    );
    await setStep(run.id, 4, 'passed', `InsForge backend branch ready: ${run.backend_branch}.`);
  } catch (error) {
    if (config.requireBackendBranch) throw error;
    await setStep(run.id, 4, 'skipped', `Backend branch creation failed but is non-blocking: ${formatError(error)}`);
  }
}

async function runCodex(run, context, workspace, runDir, streamHandlers = {}) {
  await setStep(run.id, 5, 'running', 'Codex is implementing the planned feature.');
  await createRunEvent(run, 'summary', 'Codex started.\n');

  assertCodexAuthAvailable();

  const codexHome = path.join(config.codexHome, `run-${run.id}`);
  const finalPath = path.join(runDir, 'final.md');
  const promptPath = path.join(runDir, 'prompt.md');
  await prepareCodexHome(codexHome, workspace);
  const runnerDir = path.join(workspace, '.forkable');
  await mkdir(runnerDir, { recursive: true });
  await writeFile(path.join(runnerDir, 'FORKABLE_RUNNER.md'), buildRunnerRunbook(run, context));
  await writeFile(promptPath, buildPrompt(run, context));

  const eventHandler = createCodexPlanningEventHandler({
    onDelta: (content) => {
      void createRunEvent(run, 'delta', content);
      streamHandlers.onDelta?.(content);
    },
    onStatus: (message) => {
      void createRunEvent(run, 'status', `\n> ${message}\n`);
    },
  });

  await runCodexExec({
    codexHome,
    workspace,
    prompt: await readFile(promptPath, 'utf8'),
    outputPath: finalPath,
    logPath: path.join(runDir, 'codex.jsonl'),
    sandbox: 'workspace-write',
    timeoutMs: Number(process.env.FORKABLE_CODEX_TIMEOUT_MS || 45 * 60 * 1000),
    onJsonEvent: eventHandler,
  });

  const finalMessage = await readTextIfExists(finalPath);
  if (finalMessage) await createRunEvent(run, 'summary', `\n${finalMessage}\n`);
  await persistCodexAuth(codexHome);
  return { finalMessage };
}

function buildRunnerRunbook(run, context) {
  return [
    '# Forkable Runner Instructions',
    '',
    'Achieve the requested task as fast as possible.',
    '',
    'Use the repository already checked out in this workspace. It has been refreshed to the latest target branch before this run. Do not reclone it.',
    '',
    'Default execution rules:',
    '- Make the smallest useful code/data change that satisfies the request.',
    '- Move in one direct pass: inspect only the files needed, edit, commit, and deploy.',
    '- Do not run slow verification commands such as full production builds unless the request or a very risky edit makes them necessary.',
    '- Prefer quick targeted checks, syntax checks, or direct smoke checks over install/typecheck/build cycles.',
    '- If no code change is required, say so and finish immediately.',
    '- Use `npx @insforge/cli` only if the implementation itself needs InsForge inspection or data changes.',
    '- Do not run frontend deployment yourself. The runner will deploy after Codex returns.',
    '- Do not ask the user for company/customer scope; use the authenticated company context in the request.',
    '',
    'Current run:',
    `- Run id: ${run.id}`,
    `- Git branch: ${run.git_branch || `feat/${run.id}`}`,
    `- Request title: ${context.request.title}`,
    `- Requesting company account: ${context.request.company_account_id || 'unknown'}`,
    '',
  ].join('\n');
}

async function runCodexPlanningChat(body, streamHandlers = {}) {
  assertCodexAuthAvailable();

  const planningId = randomUUID();
  const planningDir = path.join(config.workdir, 'planning', planningId);
  const workspace = planningDir;
  const codexHome = path.join(config.codexHome, `planning-${planningId}`);
  const outputPath = path.join(planningDir, 'final.md');

  streamHandlers.onStatus?.('preparing Codex');
  await mkdir(planningDir, { recursive: true });
  await prepareCodexHome(codexHome, workspace, { includeMcpServers: false });

  streamHandlers.onStatus?.('starting Codex');
  await runCodexExec({
    codexHome,
    workspace,
    prompt: buildPlanningPrompt(body),
    outputPath,
    logPath: path.join(planningDir, 'codex-planning.jsonl'),
    sandbox: 'read-only',
    timeoutMs: Number(process.env.FORKABLE_CODEX_PLANNING_TIMEOUT_MS || 3 * 60 * 1000),
    onJsonEvent: streamHandlers.onDelta
      ? createCodexPlanningEventHandler(streamHandlers)
      : undefined,
  });

  const finalMessage = await readTextIfExists(outputPath);
  await persistCodexAuth(codexHome);

  if (!finalMessage.trim()) {
    throw new Error('Codex returned an empty planning response.');
  }

  return finalMessage.trim();
}

async function runCodexAutomationSetup(body) {
  assertCodexAuthAvailable();

  const setupId = randomUUID();
  const setupDir = path.join(config.workdir, 'automation-setup', setupId);
  const workspace = setupDir;
  const codexHome = path.join(config.codexHome, `automation-setup-${setupId}`);
  const outputPath = path.join(setupDir, 'setup.json');

  await mkdir(setupDir, { recursive: true });
  await prepareCodexHome(codexHome, workspace, { includeMcpServers: false });

  await runCodexExec({
    codexHome,
    workspace,
    prompt: buildAutomationSetupPrompt(body),
    outputPath,
    logPath: path.join(setupDir, 'codex-automation-setup.jsonl'),
    sandbox: 'read-only',
    timeoutMs: Number(process.env.FORKABLE_CODEX_AUTOMATION_SETUP_TIMEOUT_MS || 2 * 60 * 1000),
  });

  const finalMessage = await readTextIfExists(outputPath);
  await persistCodexAuth(codexHome);

  return parseAutomationSetupResult(finalMessage);
}

function buildAutomationSetupPrompt(body) {
  const task = body?.task || {};
  const message = String(body?.message || '');

  return [
    "You are Forkable's automation setup agent running on InsForge Compute through Codex.",
    '',
    'Convert the user request into scheduled_agent_tasks fields. The app will persist the result.',
    '',
    'Return only valid JSON. Do not wrap it in Markdown. Do not include commentary outside JSON.',
    '',
    'Required JSON shape:',
    JSON.stringify({
      status: 'configured | needs_more_info',
      title: 'short automation title',
      prompt: 'the durable automation instructions',
      taskType: 'report_only | monitor_context | queue_agent',
      cronExpression: 'cron in minute hour * * * form, or null',
      scheduleLabel: 'human-readable schedule, or null',
      scheduleType: 'daily | weekly | monthly | cron | manual',
      timezone: 'IANA timezone, default America/Los_Angeles when PT/Pacific is mentioned',
      assistantMessage: 'concise user-facing confirmation or one missing-info question',
    }, null, 2),
    '',
    'Rules:',
    '- If the request includes both the work and timing, set status to configured.',
    '- If timing is missing or ambiguous, set status to needs_more_info and ask one concise question.',
    '- For "every day at 3:23 pm PT", use cronExpression "23 15 * * *", scheduleType "daily", timezone "America/Los_Angeles".',
    '- For weekdays, use cronExpression with day-of-week 1-5.',
    '- Use taskType "report_only" for reminders, echo requests, status notes, or simple one-shot messages that do not need code changes.',
    '- Use taskType "monitor_context" for watch/check/monitor requests that may require customer or repo context before deciding what to do.',
    '- Use taskType "queue_agent" only when the user explicitly wants a coding agent run queued.',
    '- The title should describe the automation, not say "New automation".',
    '- Keep the prompt durable enough for a future scheduled runner to execute.',
    '',
    'Existing automation task:',
    JSON.stringify({
      id: task.id,
      title: task.title,
      description: task.description,
      instructions: task.instructions,
      prompt: task.prompt,
      status: task.status,
      schedule_label: task.schedule_label,
      cron_expression: task.cron_expression,
      timezone: task.timezone,
      customer_name: task.customer_name,
      customer_email: task.customer_email,
    }, null, 2),
    '',
    `Latest user message: ${message}`,
  ].join('\n');
}

function parseAutomationSetupResult(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Codex returned an empty automation setup response.');

  const jsonText = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Codex returned invalid automation setup JSON: ${error.message}`);
  }

  const status = parsed.status === 'configured' ? 'configured' : 'needs_more_info';
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : '';
  return {
    status,
    title: typeof parsed.title === 'string' ? parsed.title.slice(0, 120) : 'Scheduled automation',
    prompt,
    taskType: ['report_only', 'monitor_context', 'queue_agent'].includes(parsed.taskType)
      ? parsed.taskType
      : inferAutomationTaskType(prompt),
    cronExpression: typeof parsed.cronExpression === 'string' ? parsed.cronExpression : null,
    scheduleLabel: typeof parsed.scheduleLabel === 'string' ? parsed.scheduleLabel : null,
    scheduleType: typeof parsed.scheduleType === 'string' ? parsed.scheduleType : 'manual',
    timezone: typeof parsed.timezone === 'string' ? parsed.timezone : 'America/Los_Angeles',
    assistantMessage: typeof parsed.assistantMessage === 'string' ? parsed.assistantMessage : '',
  };
}

function inferAutomationTaskType(prompt) {
  const text = String(prompt || '').trim().toLowerCase();
  if (!text) return 'monitor_context';
  if (/^(echo|say|tell me|remind me|notify me|send me)\b/.test(text)) return 'report_only';
  if (/\b(run codex|coding agent|build|implement|fix|change code|deploy)\b/.test(text)) return 'queue_agent';
  return 'monitor_context';
}

function createCodexPlanningEventHandler({ onDelta, onStatus }) {
  let assistantText = '';

  return (event) => {
    const status = extractCodexStatus(event);
    if (status) onStatus?.(status);

    const nextText = extractCodexAssistantText(event);
    if (!nextText) return;

    if (nextText.startsWith(assistantText)) {
      const delta = nextText.slice(assistantText.length);
      assistantText = nextText;
      if (delta) onDelta(delta);
      return;
    }

    assistantText += nextText;
    onDelta(nextText);
  };
}

function extractCodexStatus(event) {
  const type = String(event?.method || event?.type || event?.msg?.type || '');
  if (type === 'item/started' || type === 'item.started') {
    const item = getCodexEventItem(event);
    const itemType = String(item?.type || '');
    if (itemType === 'command_execution') return formatCommandExecutionStatus(item);
    if (itemType === 'mcp_tool_call') return formatMcpToolCallStatus(item);
    if (itemType && !['agentMessage', 'agent_message'].includes(itemType)) return itemType;
  }
  if (type === 'item/completed' || type === 'item.completed') {
    const item = getCodexEventItem(event);
    const itemType = String(item?.type || '');
    if (itemType === 'command_execution') return formatCommandExecutionStatus(item);
    if (itemType === 'mcp_tool_call') return formatMcpToolCallStatus(item);
  }
  if (type.includes('tool') || type.includes('exec') || type.includes('mcp')) {
    return type.replaceAll('_', ' ').replaceAll('/', ' ');
  }
  return '';
}

function getCodexEventItem(event) {
  return event?.params?.item || event?.item || event?.msg?.item || null;
}

function formatCommandExecutionStatus(item) {
  const command = stringifyCodexCommand(item?.command || item?.cmd || item?.arguments);
  const status = item?.status ? `status: ${item.status}` : '';
  const exitCode = item?.exit_code ?? item?.exitCode ?? item?.exit_status ?? item?.exitStatus;
  const output = String(item?.aggregated_output || item?.output || item?.stdout || item?.stderr || '').trim();
  const lines = [];

  lines.push(command ? `$ ${command}` : 'command_execution');
  if (output) lines.push(trimActivityOutput(output, 1800));
  if (exitCode !== undefined && exitCode !== null) lines.push(`exit code: ${exitCode}`);
  if (!output && status) lines.push(status);

  return lines.join('\n');
}

function formatMcpToolCallStatus(item) {
  const server = item?.server || item?.server_name || item?.mcp_server || item?.mcpServer;
  const tool = item?.tool || item?.tool_name || item?.name;
  const label = [server, tool].filter(Boolean).join(' ');
  return label ? `MCP ${label}` : 'mcp_tool_call';
}

function stringifyCodexCommand(command) {
  if (Array.isArray(command)) return command.map(shellQuote).join(' ');
  if (command && typeof command === 'object') {
    if (Array.isArray(command.argv)) return command.argv.map(shellQuote).join(' ');
    if (typeof command.command === 'string') return command.command;
    if (typeof command.cmd === 'string') return command.cmd;
    return JSON.stringify(command);
  }
  return typeof command === 'string' ? command : '';
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function trimActivityOutput(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 80)}\n...[truncated ${text.length - (maxLength - 80)} chars]`;
}

function extractCodexAssistantText(event) {
  if (!event || typeof event !== 'object') return '';
  const eventName = String(event.method || event.type || '');

  if (eventName === 'item/agentMessage/delta') {
    return typeof event.params?.delta === 'string' ? event.params.delta : '';
  }

  if (
    (eventName === 'item/completed' || eventName === 'item.completed') &&
    ['agentMessage', 'agent_message'].includes(event.params?.item?.type || event.item?.type) &&
    typeof (event.params?.item?.text || event.item?.text) === 'string'
  ) {
    return event.params?.item?.text || event.item.text;
  }

  const candidates = [
    event.delta,
    event.content,
    event.text,
    event.message,
    event.msg?.delta,
    event.msg?.content,
    event.msg?.text,
    event.item?.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isAssistantTextEvent(event)) return candidate;
  }

  const itemText = extractTextFromContent(event.item?.content);
  if (itemText && isAssistantTextEvent(event)) return itemText;

  const messageText = extractTextFromContent(event.message?.content || event.msg?.message?.content);
  if (messageText && isAssistantTextEvent(event)) return messageText;

  return '';
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    })
    .join('');
}

function isAssistantTextEvent(event) {
  const role = event.role || event.item?.role || event.message?.role || event.msg?.role;
  if (role && role !== 'assistant') return false;

  const method = String(event.method || '');
  if (method) {
    return method.includes('agentMessage') || method.includes('output_text');
  }

  const type = String(event.type || event.msg?.type || event.item?.type || '');
  if (!type) return true;

  return (
    type.includes('message') ||
    type.includes('agent_message') ||
    type.includes('output_text') ||
    type.includes('assistant') ||
    type.includes('response')
  );
}

async function runCodexExec({
  codexHome,
  workspace,
  prompt,
  outputPath,
  logPath,
  sandbox,
  timeoutMs,
  onJsonEvent,
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
        CODEX_API_KEY: process.env.CODEX_API_KEY || '',
      },
      timeoutMs,
      onJsonEvent,
    },
  );
}

function buildPlanningPrompt(body) {
  const request = body?.request || {};
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const latestMessage = String(body?.message || '');
  const isInitialKickoff = body?.isInitialKickoff === true;
  const history = messages
    .slice(-12)
    .map((message) => `${String(message.role || 'user').toUpperCase()}: ${String(message.content || '')}`)
    .join('\n\n');

  return [
    "You are Forkable's interactive feature planning agent.",
    '',
    'Your job is to help a logged-in company user scope, plan, build, test, and ship one CRM workflow request end to end.',
    '',
    'Rules:',
    '- Use the private request context to know rollout scope, but do not mention the company name unless the user asks or it is needed for clarity.',
    '- Never ask which customer or company should receive the change; rollout scope comes from the authenticated user mapping.',
    '- Do not ask whether the feature should apply only to a CRM customer, deal account, or named company; assume the authenticated company account is the rollout scope unless the user explicitly asks for deal-account-specific behavior.',
    '- Ask only for missing decisions that materially affect implementation and cannot be reasonably inferred from common CRM behavior.',
    '- If the submitted request is specific enough to implement, do not ask an extra preference question; state the understood behavior and say it is ready to build.',
    '- For list/table sorting requests, assume server-backed sorting when pagination or filtering may exist, default directions from the request, and click-to-toggle directions unless the user says otherwise.',
    '- Keep the plan grounded in authenticated company scope, Git branches, InsForge backend branches, Nia repository context, Hyperspell company context, backend enforcement, preview deploys, smoke tests, and automatic merge/deploy.',
    '- Do not claim code has been changed.',
    '- For the initial turn, begin helping immediately from the submitted description. Ask one concise scoping question only when the request is genuinely ambiguous.',
    '- Keep the user-facing reply concise and conversational.',
    '- If the request is ready, the user-facing reply should say it is ready to build without exposing the internal scope checklist or implementation plan.',
    '- Put the detailed scope, assumptions, backend requirements, rollout model, Nia context expectations, verification plan, and coding-agent handoff in agent_handoff, not user_message.',
    '- Return only valid JSON. Do not wrap it in Markdown. Do not include commentary outside JSON.',
    '- JSON shape: {"user_message":"short message shown to the company user","agent_handoff":"private implementation handoff for the coding agent"}',
    '',
    'Private feature request context:',
    JSON.stringify({
      title: request.title,
      description: request.description,
      status: request.status,
      feature_key: request.feature_key,
      company_account_id: request.company_account_id,
      company_name: request.customer_name,
      requester_email: request.customer_email,
    }, null, 2),
    '',
    history ? `Planning conversation so far:\n${history}` : 'Planning conversation so far: none',
    '',
    isInitialKickoff
      ? `Initial workflow request description: ${latestMessage}`
      : `Latest user message: ${latestMessage}`,
  ].join('\n');
}

function buildCodexConfig(workspace, options = {}) {
  const includeMcpServers = options.includeMcpServers !== false;
  const escapedWorkspace = workspace.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const parts = [
    `model = "${config.codexModel}"`,
    `model_reasoning_effort = "${config.codexReasoningEffort}"`,
    'model_reasoning_summary = "none"',
    'model_verbosity = "low"',
    'service_tier = "fast"',
    'cli_auth_credentials_store = "file"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'web_search = "disabled"',
    '',
    '[features]',
    'fast_mode = true',
    '',
    '[profiles.forkable-runner]',
    `model = "${config.codexModel}"`,
    `model_reasoning_effort = "${config.codexReasoningEffort}"`,
    'model_reasoning_summary = "none"',
    'model_verbosity = "low"',
    'service_tier = "fast"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    '',
    `[projects."${escapedWorkspace}"]`,
    'trust_level = "trusted"',
  ];

  if (includeMcpServers && process.env.NIA_API_KEY) {
    parts.push(
      '',
      '[mcp_servers.nia]',
      'url = "https://apigcp.trynia.ai/mcp"',
      'bearer_token_env_var = "NIA_API_KEY"',
      'required = false',
      'tool_timeout_sec = 120',
    );
  }

  if (includeMcpServers && process.env.HYPERSPELL_API_KEY && process.env.HYPERSPELL_USER_ID) {
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

function normalizeCodexReasoningEffort(value) {
  const requested = String(value || 'low').trim().toLowerCase();
  if (requested === 'none' || requested === 'minimal') return 'low';
  if (['low', 'medium', 'high', 'xhigh'].includes(requested)) return requested;
  return 'low';
}

async function prepareCodexHome(codexHome, workspace, options = {}) {
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, 'config.toml'), buildCodexConfig(workspace, options));

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

async function bootstrapInsforgeCliAuth() {
  await mkdir(config.insforgeCliHome, { recursive: true });

  const credentialsPath = path.join(config.insforgeCliHome, 'credentials.json');
  if (await exists(credentialsPath)) {
    state.insforgeCliAuthReady = true;
    return;
  }

  const credentials = getSeededJson('INSFORGE_CLI_CREDENTIALS_JSON', 'INSFORGE_CLI_CREDENTIALS_JSON_B64');
  const cliConfig = getSeededJson('INSFORGE_CLI_CONFIG_JSON', 'INSFORGE_CLI_CONFIG_JSON_B64');

  if (cliConfig) {
    await writeFile(path.join(config.insforgeCliHome, 'config.json'), cliConfig);
  }

  if (!credentials) return;

  await writeFile(credentialsPath, credentials);
  await chmod(credentialsPath, 0o600);
  state.insforgeCliAuthReady = true;
}

async function bootstrapNiaConfig() {
  await mkdir(config.niaConfigHome, { recursive: true });

  const configPath = path.join(config.niaConfigHome, 'config.json');
  if (await exists(configPath)) {
    state.niaConfigReady = true;
    return;
  }

  if (config.niaConfigJson) {
    await writeFile(configPath, config.niaConfigJson);
    await chmod(configPath, 0o600);
    state.niaConfigReady = true;
    return;
  }

  if (!process.env.NIA_API_KEY) return;

  await writeFile(configPath, JSON.stringify({
    baseUrl: process.env.NIA_BASE_URL || 'https://apigcp.trynia.ai/v2',
    useExperimentalApi: process.env.NIA_USE_EXPERIMENTAL_API === 'true',
    apiKey: process.env.NIA_API_KEY,
  }, null, 2));
  await chmod(configPath, 0o600);
  state.niaConfigReady = true;
}

function getSeededJson(rawKey, encodedKey) {
  if (process.env[encodedKey]) {
    return Buffer.from(process.env[encodedKey], 'base64').toString('utf8');
  }

  return process.env[rawKey] || '';
}

async function persistCodexAuth(codexHome) {
  const authPath = path.join(codexHome, 'auth.json');
  if (!(await exists(authPath))) return;

  await copyFile(authPath, path.join(config.codexHome, 'auth.json'));
  await chmod(path.join(config.codexHome, 'auth.json'), 0o600);
}

function getCodexAuthMode() {
  if (process.env.CODEX_API_KEY) return 'api_key';
  if (process.env.CODEX_AUTH_JSON_B64 || process.env.CODEX_AUTH_JSON) return 'chatgpt_auth_seed';
  if (hasChunkedCodexAuth()) return 'chatgpt_auth_seed_chunked';
  if (state.codexAuthReady) return 'chatgpt_auth_file';
  return 'none';
}

function getInsforgeCliAuthMode() {
  if (config.insforgeAccessToken && config.insforgeProjectId) return 'access_token';
  if (process.env.INSFORGE_CLI_CREDENTIALS_JSON_B64 || process.env.INSFORGE_CLI_CREDENTIALS_JSON) {
    return 'credential_file_seed';
  }
  if (state.insforgeCliAuthReady) return 'credential_file';
  if (process.env.INSFORGE_EMAIL && process.env.INSFORGE_PASSWORD && config.insforgeProjectId) {
    return 'email_password';
  }
  return 'none';
}

function insforgeCliEnv() {
  const env = { ...process.env };
  if (config.insforgeAccessToken) env.INSFORGE_ACCESS_TOKEN = config.insforgeAccessToken;
  if (config.insforgeProjectId) env.INSFORGE_PROJECT_ID = config.insforgeProjectId;
  return env;
}

function assertCodexAuthAvailable() {
  if (
    process.env.CODEX_API_KEY ||
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
    'Before doing anything else, read .forkable/FORKABLE_RUNNER.md in the workspace and follow it. It is the operational runbook for this Compute run.',
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
    '- Any residual risks or follow-up notes.',
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
  if (config.skipVerification && config.checks.length === 0) {
    const results = [{
      name: 'Runner verification skipped',
      status: 'skipped',
      details: 'FORKABLE_SKIP_VERIFICATION is enabled. Codex is instructed to use only fast targeted checks when needed.',
    }];
    await setStepFromRunDir(runDir, 7, 'skipped', results[0].details);
    return results;
  }

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

  const allPassed = results.every((result) => ['passed', 'skipped'].includes(result.status));
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

  await rm(path.join(workspace, '.forkable'), { recursive: true, force: true });
  await prepareInsforgeProjectLink(workspace);
  await execCommand(
    'npx',
    ['@insforge/cli', 'deployments', 'deploy', '.', '--json'],
    {
      cwd: workspace,
      logPath: path.join(workspace, '..', 'preview-deploy.json'),
      env: insforgeCliEnv(),
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

async function finalizeSuccessfulRun(run, context, workspace, runDir, result) {
  await setStep(run.id, 8, 'running', 'Automatically merging, deploying, enabling the company flag, and notifying the requester.');

  const merge = await mergeFeatureBranch(run, workspace, runDir, result.commitSha);
  const production = await maybeDeployProduction(workspace);
  const featureKey = resolveFeatureKey(run, context);
  const flag = await maybeEnableCompanyFeatureFlag(run, context, featureKey);

  const details = [
    result.commitSha ? `Commit: ${result.commitSha}` : 'No commit was created.',
    merge,
    production?.url ? `Production deploy: ${production.url}` : 'Production deploy was not configured.',
    result.preview?.url ? `Preview: ${result.preview.url}` : 'Preview deployment was not requested.',
    flag ? `Enabled feature flag ${featureKey} for the requesting company.` : 'No company feature flag was enabled.',
  ];

  await setStep(run.id, 8, 'passed', details.join('\n'));

  return {
    productionUrl: production?.url || null,
    featureKey,
    flagEnabled: Boolean(flag),
  };
}

async function mergeFeatureBranch(run, workspace, runDir, commitSha) {
  if (!config.autoMerge) return 'Automatic merge is disabled for this runner.';
  if (!commitSha) return 'No commit was created, so there was nothing to merge.';

  const targetRef = config.repoRef || 'main';
  await execCommand('git', ['checkout', targetRef], {
    cwd: workspace,
    logPath: path.join(runDir, 'git-checkout-target.log'),
  });
  await execCommand('git', ['merge', '--no-ff', run.git_branch || commitSha, '-m', `Merge ${run.git_branch || commitSha}`], {
    cwd: workspace,
    logPath: path.join(runDir, 'git-merge.log'),
    timeoutMs: 10 * 60 * 1000,
  });

  if (config.pushBranch) {
    await execCommand('git', ['push', 'origin', targetRef], {
      cwd: workspace,
      logPath: path.join(runDir, 'git-push-target.log'),
      timeoutMs: 10 * 60 * 1000,
    });
    return `Merged into ${targetRef} and pushed.`;
  }

  return `Merged into ${targetRef} locally; set FORKABLE_PUSH_BRANCH=true to push automatically.`;
}

async function maybeDeployProduction(workspace) {
  if (!config.deployProduction) return null;

  await rm(path.join(workspace, '.forkable'), { recursive: true, force: true });
  await prepareInsforgeProjectLink(workspace);
  await execCommand(
    'npx',
    ['@insforge/cli', 'deployments', 'deploy', '.', '--json'],
    {
      cwd: workspace,
      logPath: path.join(workspace, '..', 'production-deploy.json'),
      env: insforgeCliEnv(),
      timeoutMs: 20 * 60 * 1000,
    },
  );

  const raw = await readTextIfExists(path.join(workspace, '..', 'production-deploy.json'));
  const deployment = parseLastJsonObject(raw);
  return {
    url: deployment?.url || deployment?.deploymentUrl || deployment?.app_url || null,
    id: deployment?.id || deployment?.deployment_id || null,
  };
}

function resolveFeatureKey(run, context) {
  const snapshot = run.plan_snapshot || {};
  const contextBundle = snapshot.context_bundle || {};
  return contextBundle.feature_key || context.request.feature_key || run.backend_branch || null;
}

async function maybeEnableCompanyFeatureFlag(run, context, featureKey) {
  const companyAccountId = context.request.company_account_id;
  if (!companyAccountId || !featureKey) return null;

  await ensureFeatureFlag(featureKey, context.request);

  const { error } = await insforge.database
    .from('company_feature_flags')
    .upsert([{
      company_account_id: companyAccountId,
      feature_key: featureKey,
      enabled: true,
      rollout_stage: 'production',
      notes: `Automatically enabled after agent run ${run.id} merged.`,
      user_id: run.user_id,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'company_account_id,feature_key,user_id' });

  if (isMissingOptionalTable(error, 'company_feature_flags')) return null;
  assertDb(error, 'Unable to enable company feature flag.');
  return true;
}

async function ensureFeatureFlag(featureKey, request) {
  const { error } = await insforge.database
    .from('feature_flags')
    .upsert([{
      key: featureKey,
      name: request.title || featureKey.replace(/[_-]+/g, ' '),
      description: `Automatically managed for change request ${request.id}.`,
    }], { onConflict: 'key' });

  assertDb(error, 'Unable to ensure feature flag.');
}

async function createRunNotification({ run, request, success, finalization, preview }) {
  const title = success
    ? `${request.title || 'Feature request'} merged and deployed`
    : `${request.title || 'Feature request'} needs attention`;
  const body = success
    ? [
      'The coding agent finished, checks passed, and the change was merged automatically.',
      finalization?.flagEnabled ? 'The company feature flag is enabled for the requesting company.' : '',
      finalization?.productionUrl ? `Deployment: ${finalization.productionUrl}` : preview?.url ? `Preview: ${preview.url}` : '',
    ].filter(Boolean).join(' ')
    : 'The coding agent run failed before automatic merge and deploy. Open the run for details.';

  const { error } = await insforge.database.from('user_notifications').insert([{
    title,
    body,
    kind: success ? 'success' : 'error',
    source_type: 'agent_run',
    action_label: 'Open run',
    action_href: `/feature-runs/${run.id}`,
    change_request_id: run.change_request_id,
    plan_id: run.plan_id || null,
    agent_run_id: run.id,
    metadata: {
      status: success ? 'merged' : 'failed',
      feature_key: finalization?.featureKey || null,
      production_url: finalization?.productionUrl || null,
      preview_url: preview?.url || null,
    },
    user_id: run.user_id,
  }]);

  if (isMissingOptionalTable(error, 'user_notifications')) return;
  assertDb(error, 'Unable to create run notification.');
}

function buildRunCompletionChatMessage({ runId, status, success, finalization, preview, error }) {
  const lines = [
    success
      ? 'Build finished and shipped.'
      : 'Build finished but needs attention.',
    `Current status: ${status}.`,
  ];

  const deploymentUrl = finalization?.productionUrl || preview?.url;
  if (deploymentUrl) lines.push(`Deployment: ${deploymentUrl}`);
  if (error) lines.push(`Runner note: ${trimForDb(formatError(error))}`);
  lines.push(`Run details: /feature-runs/${runId}`);

  return lines.join('\n');
}

async function createRunPlanningMessage({ changeRequestId, planId, userId, content, metadata }) {
  const { data: latestRows, error: latestError } = await insforge.database
    .from('change_request_planning_messages')
    .select('sort_order')
    .eq('change_request_id', changeRequestId)
    .order('sort_order', { ascending: false })
    .range(0, 0);

  assertDb(latestError, 'Unable to load latest planning message.');
  const nextSortOrder = Number(latestRows?.[0]?.sort_order ?? -1) + 1;

  const { error } = await insforge.database
    .from('change_request_planning_messages')
    .insert([{
      change_request_id: changeRequestId,
      role: 'assistant',
      content: trimForDb(content),
      sort_order: nextSortOrder,
      metadata: {
        ...metadata,
        plan_id: planId,
      },
      user_id: userId,
    }]);

  assertDb(error, 'Unable to create run completion planning message.');
}

async function failRun(runId, error, options = {}) {
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

  if (options.postPlanningMessage === false) return;

  const { data: run, error: runError } = await insforge.database
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  assertDb(runError, 'Unable to load failed run.');
  if (!run) return;

  await createRunPlanningMessage({
    runId,
    changeRequestId: run.change_request_id,
    planId: run.plan_id || null,
    userId: run.user_id,
    content: buildRunCompletionChatMessage({
      runId,
      status: 'failed',
      success: false,
      error,
    }),
    metadata: {
      provider: 'codex_runner',
      run_id: runId,
      plan_id: run.plan_id || null,
      kind: 'run_completion',
    },
  });
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

async function createRunEvent(run, eventType, body, metadata = {}) {
  if (!body) return;
  const { error } = await insforge.database
    .from('agent_run_events')
    .insert([{
      run_id: run.id,
      event_type: eventType,
      title: eventType === 'summary' ? 'Codex output' : 'Codex',
      body: trimForDb(body),
      metadata,
      user_id: run.user_id,
    }]);

  if (error && /agent_run_events/i.test(error.message || '')) return;
  assertDb(error, 'Unable to save Codex run output.');
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
    onJsonEvent,
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

    const jsonLines = onJsonEvent
      ? createInterface({ input: child.stdout, crlfDelay: Infinity })
      : null;

    if (jsonLines) {
      jsonLines.on('line', (line) => {
        const text = redact(line);
        stdout += `${text}\n`;
        logStream?.write(`${text}\n`);

        try {
          onJsonEvent(JSON.parse(text));
        } catch {
          // Codex JSON output should be newline-delimited JSON; keep raw output in logs if a line is not JSON.
        }
      });
    } else {
      child.stdout.on('data', (chunk) => {
        const text = redact(String(chunk));
        stdout += text;
        logStream?.write(text);
      });
    }

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
    process.env.CODEX_AUTH_JSON,
    process.env.CODEX_AUTH_JSON_B64,
    ...Object.entries(process.env)
      .filter(([key]) => /^CODEX_AUTH_JSON_B64_PART_\d+$/.test(key))
      .map(([, value]) => value),
    process.env.GITHUB_TOKEN,
    process.env.NIA_API_KEY,
    process.env.HYPERSPELL_API_KEY,
    process.env.INSFORGE_ACCESS_TOKEN,
    process.env.INSFORGE_CLI_CREDENTIALS_JSON,
    process.env.INSFORGE_CLI_CREDENTIALS_JSON_B64,
    process.env.INSFORGE_CLI_CONFIG_JSON,
    process.env.INSFORGE_CLI_CONFIG_JSON_B64,
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

function formatPlanningChatError(error) {
  const message = formatError(error);
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

  if (message.includes('Codex returned an empty planning response')) {
    return 'Codex returned an empty planning response. Retry the planning chat.';
  }

  if (message.includes('Command timed out')) {
    return 'The planning agent timed out. Retry with a shorter request or check the runner logs.';
  }

  if (
    message.includes("cannot be used with reasoning.effort 'minimal'") ||
    message.includes('cannot be used with reasoning.effort "minimal"')
  ) {
    return 'The runner Codex reasoning effort is too low for available tools. Redeploy the runner with CODEX_REASONING_EFFORT=low or newer, then retry the planning chat.';
  }

  return 'The planning agent failed. Check the runner logs for details, then retry.';
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
