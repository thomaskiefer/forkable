import { UPLOAD_BUCKET } from '@/lib/constants';
import { createInsforgeServerClient, getInsforgeServerClient } from '@/lib/insforge';
import type {
  AgentRun,
  AcmeClosePlanItem,
  ChangeRequest,
  ChangeRequestPlan,
  ChangeRequestPlanningMessage,
  CompanyAccount,
  PlanningMessageRole,
  ScheduledAgentExecution,
  ScheduledAgentMessage,
  ScheduledAgentScheduleType,
  ScheduledAgentTask,
  ScheduledAgentTaskType,
  ScheduledAgentTaskStatus,
  UserNotification,
  UserNotificationKind,
  UserNotificationSourceType,
} from '@/lib/types';

type InsforgeClient = ReturnType<typeof createInsforgeServerClient>;

function getInsforge(accessToken?: string | null): InsforgeClient {
  if (accessToken) {
    return createInsforgeServerClient({ accessToken });
  }
  return getInsforgeServerClient();
}

function assertNoDatabaseError(
  error: { message?: string } | null,
  fallbackMessage: string,
) {
  if (error) {
    throw new Error(error.message ?? fallbackMessage);
  }
}

function isMissingNotificationsTable(error: { message?: string } | null) {
  const message = error?.message ?? '';
  return (
    message.includes('user_notifications') &&
    (message.includes('does not exist') || message.includes('not found'))
  );
}

// ============================================================
// Clients
// ============================================================

export async function getClients(
  accessToken?: string | null,
  page?: number,
  itemsPerPage?: number,
) {
  const insforge = getInsforge(accessToken);
  let query = insforge.database
    .from('clients')
    .select('*', { count: 'exact' })
    .eq('is_deleted', false)
    .order('name', { ascending: true });

  if (page !== undefined && itemsPerPage !== undefined) {
    const start = (page - 1) * itemsPerPage;
    query = query.range(start, start + itemsPerPage - 1);
  }

  const { data, error, count } = await query;
  assertNoDatabaseError(error, 'Unable to load clients.');
  return { clients: data ?? [], count: count ?? 0 };
}

export async function getClientById(id: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('clients')
    .select('*')
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load client.');
  return data;
}

export async function addClient(
  clientData: { name: string; client_code: string; address?: string; postal_code?: string; country_code?: string; user_id: string },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('clients')
    .insert([clientData])
    .select();

  assertNoDatabaseError(error, 'Unable to create client.');
  return data?.[0] ?? null;
}

export async function updateClient(
  id: string,
  clientData: Record<string, unknown>,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('clients')
    .update(clientData)
    .eq('id', id)
    .select();

  assertNoDatabaseError(error, 'Unable to update client.');
  return data?.[0] ?? null;
}

// ============================================================
// Lead Sources
// ============================================================

export async function getLeadSources(accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('lead_sources')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load lead sources.');
  return data ?? [];
}

// ============================================================
// Lead Stages
// ============================================================

export async function getLeadStages(accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('lead_stages')
    .select('*')
    .eq('is_active', true)
    .order('order_index', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load lead stages.');
  return data ?? [];
}

// ============================================================
// Leads
// ============================================================

export async function getLeads(
  accessToken?: string | null,
  page?: number,
  itemsPerPage?: number,
) {
  const insforge = getInsforge(accessToken);
  let query = insforge.database
    .from('leads')
    .select('*, source:source_id(name), current_stage:current_stage_id(name)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (page !== undefined && itemsPerPage !== undefined) {
    const start = (page - 1) * itemsPerPage;
    query = query.range(start, start + itemsPerPage - 1);
  }

  const { data, error, count } = await query;
  assertNoDatabaseError(error, 'Unable to load leads.');
  return { leads: data ?? [], count: count ?? 0 };
}

export async function getLead(id: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('leads')
    .select('*, source:source_id(name), current_stage:current_stage_id(name)')
    .eq('id', id)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load lead.');
  return data;
}

export async function addLead(
  leadData: {
    company_name: string;
    contact_name: string;
    source_id: string;
    current_stage_id: string;
    user_id: string;
    deal_value?: number;
    industry?: string;
    website?: string;
    contact_title?: string;
    contact_email?: string;
    contact_phone?: string;
    status?: string;
    notes?: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('leads')
    .insert([leadData])
    .select();

  assertNoDatabaseError(error, 'Unable to create lead.');
  return data?.[0] ?? null;
}

export async function updateLead(
  id: string,
  leadData: Record<string, unknown>,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('leads')
    .update(leadData)
    .eq('id', id)
    .select();

  assertNoDatabaseError(error, 'Unable to update lead.');
  return data?.[0] ?? null;
}

export async function getLeadsByStage(accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('leads')
    .select('*, source:source_id(name), current_stage:current_stage_id(name, order_index)')
    .eq('is_converted', false)
    .order('created_at', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load pipeline leads.');
  return data ?? [];
}

export async function updateLeadStage(
  leadId: string,
  toStageId: string,
  userId: string,
  notes?: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { error } = await insforge.database.rpc('update_lead_stage', {
    p_lead_id: leadId,
    p_to_stage_id: toStageId,
    p_user_id: userId,
    p_notes: notes ?? null,
  });

  assertNoDatabaseError(error, 'Unable to update lead stage.');
}

export async function hasFeatureFlag(
  featureKey: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database.rpc('has_feature_flag', {
    p_feature_key: featureKey,
  });

  assertNoDatabaseError(error, 'Unable to load feature flag.');
  return data === true;
}

export async function leadHasFeatureFlag(
  leadId: string,
  featureKey: string,
  userId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database.rpc('lead_has_feature_flag', {
    p_lead_id: leadId,
    p_feature_key: featureKey,
    p_user_id: userId,
  });

  assertNoDatabaseError(error, 'Unable to load lead feature flag.');
  return data === true;
}

export async function getAcmeClosePlanItems(
  leadId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database.rpc('get_acme_close_plan_items', {
    p_lead_id: leadId,
  });

  assertNoDatabaseError(error, 'Unable to load Acme close plan.');
  return (data ?? []) as AcmeClosePlanItem[];
}

export async function completeAcmeClosePlanItem(
  leadId: string,
  actionKey: string,
  notes?: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { error } = await insforge.database.rpc('complete_acme_close_plan_item', {
    p_lead_id: leadId,
    p_action_key: actionKey,
    p_notes: notes ?? null,
  });

  assertNoDatabaseError(error, 'Unable to complete Acme close-plan action.');
}

export async function getDealApprovalRequests(
  leadId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('deal_approval_requests')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load approval requests.');
  return data ?? [];
}

export async function requestDealApproval(
  leadId: string,
  reason?: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database.rpc('request_deal_approval', {
    p_lead_id: leadId,
    p_reason: reason ?? null,
  });

  assertNoDatabaseError(error, 'Unable to request approval.');
  return data as string;
}

export async function approveDealApproval(
  approvalRequestId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { error } = await insforge.database.rpc('approve_deal_approval', {
    p_request_id: approvalRequestId,
  });

  assertNoDatabaseError(error, 'Unable to approve request.');
}

// ============================================================
// Lead Activities
// ============================================================

export async function getLeadActivities(leadId: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('lead_activities')
    .select('*')
    .eq('lead_id', leadId)
    .order('activity_date', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load activities.');
  return data ?? [];
}

export async function addLeadActivity(
  activityData: {
    lead_id: string;
    type: string;
    subject: string;
    description?: string;
    activity_date: string;
    duration_minutes?: number;
    status?: string;
    user_id: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('lead_activities')
    .insert([activityData])
    .select();

  assertNoDatabaseError(error, 'Unable to create activity.');
  return data?.[0] ?? null;
}

// ============================================================
// Lead Documents
// ============================================================

export async function getLeadDocuments(leadId: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('lead_documents')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load documents.');
  return data ?? [];
}

export async function addLeadDocument(
  file: { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
  leadId: string,
  userId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const filePath = `leads/${leadId}/${Date.now()}-${file.name}`;

  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type });
  const { error: uploadError } = await insforge.storage
    .from(UPLOAD_BUCKET)
    .upload(filePath, blob);

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const publicUrl = insforge.storage
    .from(UPLOAD_BUCKET)
    .getPublicUrl(filePath);

  const { data, error } = await insforge.database
    .from('lead_documents')
    .insert([{
      lead_id: leadId,
      name: file.name,
      file_url: publicUrl,
      file_type: file.type,
      file_size: file.size,
      user_id: userId,
    }])
    .select();

  assertNoDatabaseError(error, 'Unable to save document record.');
  return data?.[0] ?? null;
}

export async function deleteLeadDocument(
  documentId: string,
  filePath: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);

  await insforge.storage.from(UPLOAD_BUCKET).remove(filePath);

  const { error } = await insforge.database
    .from('lead_documents')
    .delete()
    .eq('id', documentId);

  assertNoDatabaseError(error, 'Unable to delete document.');
}

// ============================================================
// Lead Follow-Ups
// ============================================================

export async function getLeadFollowUps(leadId: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('lead_follow_ups')
    .select('*')
    .eq('lead_id', leadId)
    .order('due_date', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load follow-ups.');
  return data ?? [];
}

export async function addLeadFollowUp(
  followUpData: {
    lead_id: string;
    due_date: string;
    priority: string;
    description: string;
    user_id: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('lead_follow_ups')
    .insert([{ ...followUpData, status: 'pending' }])
    .select();

  assertNoDatabaseError(error, 'Unable to create follow-up.');
  return data?.[0] ?? null;
}

export async function completeFollowUp(id: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { error } = await insforge.database
    .from('lead_follow_ups')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id);

  assertNoDatabaseError(error, 'Unable to complete follow-up.');
}

// ============================================================
// Lead Conversion
// ============================================================

export async function convertLeadToClient(
  leadId: string,
  clientData: { name: string; client_code: string; user_id: string },
  dealValue?: number,
  notes?: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);

  // Create client
  const { data: clientResult, error: clientError } = await insforge.database
    .from('clients')
    .insert([clientData])
    .select();

  assertNoDatabaseError(clientError, 'Unable to create client from lead.');
  const client = clientResult?.[0];
  if (!client) throw new Error('Client creation returned no data.');

  // Record conversion
  const { error: convError } = await insforge.database
    .from('lead_conversions')
    .insert([{
      lead_id: leadId,
      client_id: client.id,
      converted_by: clientData.user_id,
      deal_value: dealValue ?? null,
      conversion_notes: notes ?? null,
      user_id: clientData.user_id,
    }]);

  assertNoDatabaseError(convError, 'Unable to record conversion.');

  // Mark lead as converted
  const { error: leadError } = await insforge.database
    .from('leads')
    .update({
      is_converted: true,
      converted_to_client_id: client.id,
      converted_at: new Date().toISOString(),
    })
    .eq('id', leadId);

  assertNoDatabaseError(leadError, 'Unable to update lead status.');

  return client;
}

// ============================================================
// Projects
// ============================================================

export async function getProjects(
  accessToken?: string | null,
  page?: number,
  itemsPerPage?: number,
) {
  const insforge = getInsforge(accessToken);
  let query = insforge.database
    .from('projects')
    .select('*, client:client_id(*)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (page !== undefined && itemsPerPage !== undefined) {
    const start = (page - 1) * itemsPerPage;
    query = query.range(start, start + itemsPerPage - 1);
  }

  const { data, error, count } = await query;
  assertNoDatabaseError(error, 'Unable to load projects.');
  return { projects: data ?? [], count: count ?? 0 };
}

export async function getProject(id: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('projects')
    .select('*, client:client_id(*)')
    .eq('id', id)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load project.');
  return data;
}

export async function addProject(
  projectData: {
    name: string;
    client_id: string;
    user_id: string;
    currency?: string;
    start_date?: string;
    end_date?: string;
    deal_status?: string;
    billable?: boolean;
    note?: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('projects')
    .insert([projectData])
    .select();

  assertNoDatabaseError(error, 'Unable to create project.');
  return data?.[0] ?? null;
}

export async function updateProject(
  id: string,
  projectData: Record<string, unknown>,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('projects')
    .update(projectData)
    .eq('id', id)
    .select();

  assertNoDatabaseError(error, 'Unable to update project.');
  return data?.[0] ?? null;
}

// ============================================================
// Native CRM Feature Requests
// ============================================================

export async function getChangeRequests(accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('change_requests')
    .select('*')
    .order('created_at', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load change requests.');
  return data ?? [];
}

export async function getChangeRequest(id: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('change_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load change request.');
  return data;
}

export async function getCompanyAccountForEmail(
  email: string,
  accessToken?: string | null,
) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const insforge = getInsforge(accessToken);
  const { data: members, error: memberError } = await insforge.database
    .from('company_account_members')
    .select('company_account_id')
    .eq('email', normalizedEmail)
    .range(0, 0);

  assertNoDatabaseError(memberError, 'Unable to load company membership.');
  const companyAccountId = Array.isArray(members)
    ? (members[0] as { company_account_id?: string } | undefined)?.company_account_id
    : null;

  if (!companyAccountId) return null;

  const { data: account, error: accountError } = await insforge.database
    .from('company_accounts')
    .select('*')
    .eq('id', companyAccountId)
    .maybeSingle();

  assertNoDatabaseError(accountError, 'Unable to load company account.');
  return account as CompanyAccount | null;
}

export async function createChangeRequest(
  input: {
    title: string;
    company: CompanyAccount;
    requesterEmail: string;
    description: string;
    userId: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('change_requests')
    .insert([{
      title: input.title,
      customer_name: input.company.name,
      customer_email: input.requesterEmail,
      company_account_id: input.company.id,
      description: input.description,
      status: 'requested',
      user_id: input.userId,
    }])
    .select('*');

  assertNoDatabaseError(error, 'Unable to create feature request.');
  return (data?.[0] ?? null) as ChangeRequest | null;
}

export async function deleteChangeRequest(
  id: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { error } = await insforge.database
    .from('change_requests')
    .delete()
    .eq('id', id);

  assertNoDatabaseError(error, 'Unable to delete feature request.');
}

export async function getAgentRunsForRequest(
  changeRequestId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('agent_runs')
    .select('*')
    .eq('change_request_id', changeRequestId)
    .order('started_at', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load agent runs.');
  return data ?? [];
}

export async function getAgentRun(id: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('agent_runs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load agent run.');
  return data;
}

export async function listUserNotifications(
  accessToken?: string | null,
  options?: { includeArchived?: boolean; limit?: number },
) {
  const insforge = getInsforge(accessToken);
  let query = insforge.database
    .from('user_notifications')
    .select('*')
    .order('created_at', { ascending: false });

  if (!options?.includeArchived) {
    query = query.neq('status', 'archived');
  }

  if (options?.limit) {
    query = query.range(0, options.limit - 1);
  }

  const { data, error } = await query;
  if (isMissingNotificationsTable(error)) return [];
  assertNoDatabaseError(error, 'Unable to load notifications.');
  return (data ?? []) as UserNotification[];
}

export async function getUnreadNotificationCount(accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('user_notifications')
    .select('id')
    .eq('status', 'unread');

  if (isMissingNotificationsTable(error)) return 0;
  assertNoDatabaseError(error, 'Unable to load unread notification count.');
  return (data ?? []).length;
}

export async function createUserNotification(
  input: {
    title: string;
    body?: string;
    kind?: UserNotificationKind;
    sourceType?: UserNotificationSourceType;
    source_type?: UserNotificationSourceType;
    actionLabel?: string | null;
    action_label?: string | null;
    actionHref?: string | null;
    action_href?: string | null;
    scheduledTaskId?: string | null;
    scheduled_task_id?: string | null;
    scheduledExecutionId?: string | null;
    scheduled_execution_id?: string | null;
    changeRequestId?: string | null;
    change_request_id?: string | null;
    planId?: string | null;
    plan_id?: string | null;
    agentRunId?: string | null;
    agent_run_id?: string | null;
    metadata?: Record<string, unknown>;
    userId: string;
    user_id?: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('user_notifications')
    .insert([{
      title: input.title,
      body: input.body ?? '',
      kind: input.kind ?? 'info',
      source_type: input.sourceType ?? input.source_type ?? 'system',
      action_label: input.actionLabel ?? input.action_label ?? null,
      action_href: input.actionHref ?? input.action_href ?? null,
      scheduled_task_id: input.scheduledTaskId ?? input.scheduled_task_id ?? null,
      scheduled_execution_id: input.scheduledExecutionId ?? input.scheduled_execution_id ?? null,
      change_request_id: input.changeRequestId ?? input.change_request_id ?? null,
      plan_id: input.planId ?? input.plan_id ?? null,
      agent_run_id: input.agentRunId ?? input.agent_run_id ?? null,
      metadata: input.metadata ?? {},
      user_id: input.userId ?? input.user_id,
    }])
    .select('*');

  if (isMissingNotificationsTable(error)) return null;
  assertNoDatabaseError(error, 'Unable to create notification.');
  return (data?.[0] ?? null) as UserNotification | null;
}

export async function markNotificationRead(
  id: string,
  accessToken?: string | null,
) {
  const now = new Date().toISOString();
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('user_notifications')
    .update({
      status: 'read',
      read_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .select('*');

  if (isMissingNotificationsTable(error)) return null;
  assertNoDatabaseError(error, 'Unable to mark notification read.');
  return (data?.[0] ?? null) as UserNotification | null;
}

export async function archiveNotification(
  id: string,
  accessToken?: string | null,
) {
  const now = new Date().toISOString();
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('user_notifications')
    .update({
      status: 'archived',
      archived_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .select('*');

  if (isMissingNotificationsTable(error)) return null;
  assertNoDatabaseError(error, 'Unable to archive notification.');
  return (data?.[0] ?? null) as UserNotification | null;
}

export async function getAgentSteps(runId: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('agent_steps')
    .select('*')
    .eq('run_id', runId)
    .order('order_index', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load agent steps.');
  return data ?? [];
}

export async function getAgentRunEvents(runId: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('agent_run_events')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });

  if (error && /agent_run_events/i.test(error.message ?? '')) return [];
  assertNoDatabaseError(error, 'Unable to load agent run output.');
  return data ?? [];
}

export async function getBranchPreview(runId: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('branch_previews')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: false })
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load branch preview.');
  return data;
}

export async function getTestResults(runId: string, accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('test_results')
    .select('*')
    .eq('run_id', runId)
    .order('completed_at', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load test results.');
  return data ?? [];
}

export async function getCustomerFeatureFlags(accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('customer_feature_flags')
    .select('*')
    .order('customer_email', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load feature flags.');
  return data ?? [];
}

// ============================================================
// Feature planning chat
// ============================================================

export async function getPlanningMessages(
  changeRequestId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('change_request_planning_messages')
    .select('*')
    .eq('change_request_id', changeRequestId)
    .order('sort_order', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load planning messages.');
  return (data ?? []) as ChangeRequestPlanningMessage[];
}

export async function addPlanningMessages(
  changeRequestId: string,
  messages: Array<{
    role: PlanningMessageRole;
    content: string;
    metadata?: Record<string, unknown>;
  }>,
  userId: string,
  accessToken?: string | null,
) {
  if (messages.length === 0) return [];

  const insforge = getInsforge(accessToken);
  const { data: latestRows, error: latestError } = await insforge.database
    .from('change_request_planning_messages')
    .select('sort_order')
    .eq('change_request_id', changeRequestId)
    .order('sort_order', { ascending: false })
    .range(0, 0);

  assertNoDatabaseError(latestError, 'Unable to prepare planning message.');

  const latestSort = Array.isArray(latestRows) && latestRows[0]
    ? Number((latestRows[0] as { sort_order?: number }).sort_order ?? -1)
    : -1;

  const records = messages.map((message, index) => ({
    change_request_id: changeRequestId,
    role: message.role,
    content: message.content,
    sort_order: latestSort + index + 1,
    metadata: message.metadata ?? {},
    user_id: userId,
  }));

  const { data, error } = await insforge.database
    .from('change_request_planning_messages')
    .insert(records)
    .select('*');

  assertNoDatabaseError(error, 'Unable to save planning messages.');
  return (data ?? []) as ChangeRequestPlanningMessage[];
}

export async function getLatestChangeRequestPlan(
  changeRequestId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('change_request_plans')
    .select('*')
    .eq('change_request_id', changeRequestId)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load change request plan.');
  return data as ChangeRequestPlan | null;
}

export async function saveChangeRequestPlan(
  input: {
    changeRequestId: string;
    status: ChangeRequestPlan['status'];
    summary: string;
    implementationPlan: string;
    acceptanceCriteria: string[];
    codingAgentPrompt: string;
    contextBundle: Record<string, unknown>;
    userId: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const existing = await getLatestChangeRequestPlan(input.changeRequestId, accessToken);
  const record = {
    change_request_id: input.changeRequestId,
    status: input.status,
    summary: input.summary,
    implementation_plan: input.implementationPlan,
    acceptance_criteria: input.acceptanceCriteria,
    coding_agent_prompt: input.codingAgentPrompt,
    context_bundle: input.contextBundle,
    finalized_at: input.status === 'draft' ? null : new Date().toISOString(),
    user_id: input.userId,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await insforge.database
      .from('change_request_plans')
      .update(record)
      .eq('id', existing.id)
      .select('*');

    assertNoDatabaseError(error, 'Unable to update change request plan.');
    return (data?.[0] ?? null) as ChangeRequestPlan | null;
  }

  const { data, error } = await insforge.database
    .from('change_request_plans')
    .insert([record])
    .select('*');

  assertNoDatabaseError(error, 'Unable to save change request plan.');
  return (data?.[0] ?? null) as ChangeRequestPlan | null;
}

// ============================================================
// Scheduled agent tasks
// ============================================================

export async function listScheduledAgentTasks(accessToken?: string | null) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('scheduled_agent_tasks')
    .select('*')
    .order('next_run_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load scheduled agent tasks.');
  return (data ?? []) as ScheduledAgentTask[];
}

export const getScheduledAgentTasks = listScheduledAgentTasks;

export async function getScheduledAgentTask(
  id: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('scheduled_agent_tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load scheduled agent task.');
  return data as ScheduledAgentTask | null;
}

export async function getScheduledAgentMessages(
  taskId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('scheduled_agent_messages')
    .select('*')
    .eq('task_id', taskId)
    .order('sort_order', { ascending: true });

  assertNoDatabaseError(error, 'Unable to load scheduled agent messages.');
  return (data ?? []) as ScheduledAgentMessage[];
}

export async function getScheduledAgentExecutions(
  taskId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('scheduled_agent_executions')
    .select('*')
    .eq('task_id', taskId)
    .order('scheduled_for', { ascending: false });

  assertNoDatabaseError(error, 'Unable to load scheduled agent executions.');
  return (data ?? []) as ScheduledAgentExecution[];
}

export async function getScheduledAgentExecution(
  id: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('scheduled_agent_executions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  assertNoDatabaseError(error, 'Unable to load scheduled agent execution.');
  return data as ScheduledAgentExecution | null;
}

export async function createScheduledAgentTask(
  input: {
    title: string;
    name?: string;
    description?: string;
    instructions?: string;
    prompt?: string;
    customerName?: string;
    customer_name?: string;
    customerEmail?: string;
    customer_email?: string;
    taskType?: ScheduledAgentTaskType;
    task_type?: ScheduledAgentTaskType;
    featureKey?: string | null;
    feature_key?: string | null;
    status?: ScheduledAgentTaskStatus | string;
    scheduleType?: ScheduledAgentScheduleType;
    schedule_type?: ScheduledAgentScheduleType;
    schedule?: string | null;
    schedule_label?: string | null;
    rrule?: string | null;
    cron_expression?: string | null;
    cronExpression?: string | null;
    timezone?: string;
    changeRequestId?: string | null;
    change_request_id?: string | null;
    planId?: string | null;
    plan_id?: string | null;
    nextRunAt?: string | null;
    next_run_at?: string | null;
    metadata?: Record<string, unknown>;
    contextSnapshot?: Record<string, unknown>;
    context_snapshot?: Record<string, unknown>;
    userId?: string;
    user_id?: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('scheduled_agent_tasks')
    .insert([{
      title: input.title,
      name: input.name ?? input.title,
      description: input.description ?? '',
      instructions: input.instructions ?? null,
      prompt: input.prompt ?? null,
      customer_name: input.customerName ?? input.customer_name ?? '',
      customer_email: input.customerEmail ?? input.customer_email ?? '',
      task_type: input.taskType ?? input.task_type ?? 'monitor_context',
      feature_key: input.featureKey ?? input.feature_key ?? null,
      status: input.status ?? 'active',
      schedule_type: input.scheduleType ?? input.schedule_type ?? 'manual',
      schedule: input.schedule ?? null,
      schedule_label: input.schedule_label ?? null,
      rrule: input.rrule ?? null,
      cron_expression: input.cronExpression ?? input.cron_expression ?? null,
      timezone: input.timezone ?? 'UTC',
      change_request_id: input.changeRequestId ?? input.change_request_id ?? null,
      plan_id: input.planId ?? input.plan_id ?? null,
      next_run_at: input.nextRunAt ?? input.next_run_at ?? null,
      metadata: input.metadata ?? {},
      context_snapshot: input.contextSnapshot ?? input.context_snapshot ?? {},
      user_id: input.userId ?? input.user_id,
    }])
    .select('*');

  assertNoDatabaseError(error, 'Unable to create scheduled agent task.');
  return (data?.[0] ?? null) as ScheduledAgentTask | null;
}

export async function updateScheduledAgentTask(
  id: string,
  updates: {
    title?: string;
    name?: string;
    description?: string;
    instructions?: string;
    prompt?: string;
    customerName?: string;
    customer_name?: string;
    customerEmail?: string;
    customer_email?: string;
    taskType?: ScheduledAgentTaskType;
    task_type?: ScheduledAgentTaskType;
    featureKey?: string | null;
    feature_key?: string | null;
    status?: ScheduledAgentTaskStatus | string;
    scheduleType?: ScheduledAgentScheduleType;
    schedule_type?: ScheduledAgentScheduleType;
    schedule?: string | null;
    schedule_label?: string | null;
    rrule?: string | null;
    cron_expression?: string | null;
    cronExpression?: string | null;
    timezone?: string;
    changeRequestId?: string | null;
    change_request_id?: string | null;
    planId?: string | null;
    plan_id?: string | null;
    nextRunAt?: string | null;
    next_run_at?: string | null;
    lastRunAt?: string | null;
    last_run_at?: string | null;
    activated_at?: string | null;
    paused_at?: string | null;
    draft_prompt?: string | null;
    metadata?: Record<string, unknown>;
    contextSnapshot?: Record<string, unknown>;
    context_snapshot?: Record<string, unknown>;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const record: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) record.title = updates.title;
  if (updates.name !== undefined) record.name = updates.name;
  if (updates.description !== undefined) record.description = updates.description;
  if (updates.instructions !== undefined) record.instructions = updates.instructions;
  if (updates.prompt !== undefined) record.prompt = updates.prompt;
  if (updates.customerName !== undefined) record.customer_name = updates.customerName;
  if (updates.customer_name !== undefined) record.customer_name = updates.customer_name;
  if (updates.customerEmail !== undefined) record.customer_email = updates.customerEmail;
  if (updates.customer_email !== undefined) record.customer_email = updates.customer_email;
  if (updates.taskType !== undefined) record.task_type = updates.taskType;
  if (updates.task_type !== undefined) record.task_type = updates.task_type;
  if (updates.featureKey !== undefined) record.feature_key = updates.featureKey;
  if (updates.feature_key !== undefined) record.feature_key = updates.feature_key;
  if (updates.status !== undefined) record.status = updates.status;
  if (updates.scheduleType !== undefined) record.schedule_type = updates.scheduleType;
  if (updates.schedule_type !== undefined) record.schedule_type = updates.schedule_type;
  if (updates.schedule !== undefined) record.schedule = updates.schedule;
  if (updates.schedule_label !== undefined) record.schedule_label = updates.schedule_label;
  if (updates.rrule !== undefined) record.rrule = updates.rrule;
  if (updates.cronExpression !== undefined) record.cron_expression = updates.cronExpression;
  if (updates.cron_expression !== undefined) record.cron_expression = updates.cron_expression;
  if (updates.timezone !== undefined) record.timezone = updates.timezone;
  if (updates.changeRequestId !== undefined) record.change_request_id = updates.changeRequestId;
  if (updates.change_request_id !== undefined) record.change_request_id = updates.change_request_id;
  if (updates.planId !== undefined) record.plan_id = updates.planId;
  if (updates.plan_id !== undefined) record.plan_id = updates.plan_id;
  if (updates.nextRunAt !== undefined) record.next_run_at = updates.nextRunAt;
  if (updates.next_run_at !== undefined) record.next_run_at = updates.next_run_at;
  if (updates.lastRunAt !== undefined) record.last_run_at = updates.lastRunAt;
  if (updates.last_run_at !== undefined) record.last_run_at = updates.last_run_at;
  if (updates.activated_at !== undefined) record.activated_at = updates.activated_at;
  if (updates.paused_at !== undefined) record.paused_at = updates.paused_at;
  if (updates.draft_prompt !== undefined) record.draft_prompt = updates.draft_prompt;
  if (updates.metadata !== undefined) record.metadata = updates.metadata;
  if (updates.contextSnapshot !== undefined) record.context_snapshot = updates.contextSnapshot;
  if (updates.context_snapshot !== undefined) record.context_snapshot = updates.context_snapshot;

  const { data, error } = await insforge.database
    .from('scheduled_agent_tasks')
    .update(record)
    .eq('id', id)
    .select('*');

  assertNoDatabaseError(error, 'Unable to update scheduled agent task.');
  return (data?.[0] ?? null) as ScheduledAgentTask | null;
}

export async function deleteScheduledAgentTask(
  id: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { error } = await insforge.database
    .from('scheduled_agent_tasks')
    .delete()
    .eq('id', id);

  assertNoDatabaseError(error, 'Unable to delete scheduled agent task.');
}

export async function addScheduledAgentMessages(
  taskId: string,
  messages: Array<{
    role: PlanningMessageRole | string;
    content: string;
    user_id?: string;
    metadata?: Record<string, unknown>;
  }>,
  userIdOrAccessToken?: string | null,
  accessToken?: string | null,
) {
  if (messages.length === 0) return [];

  const userId = accessToken === undefined
    ? messages.find((message) => typeof message.user_id === 'string')?.user_id
    : userIdOrAccessToken;
  const token = accessToken === undefined ? userIdOrAccessToken : accessToken;
  if (!userId) throw new Error('Unable to save scheduled agent messages without a user.');

  const insforge = getInsforge(token);
  const { data: latestRows, error: latestError } = await insforge.database
    .from('scheduled_agent_messages')
    .select('sort_order')
    .eq('task_id', taskId)
    .order('sort_order', { ascending: false })
    .range(0, 0);

  assertNoDatabaseError(latestError, 'Unable to prepare scheduled agent message.');

  const latestSort = Array.isArray(latestRows) && latestRows[0]
    ? Number((latestRows[0] as { sort_order?: number }).sort_order ?? -1)
    : -1;

  const records = messages.map((message, index) => ({
    task_id: taskId,
    role: message.role,
    content: message.content,
    sort_order: latestSort + index + 1,
    metadata: message.metadata ?? {},
    user_id: message.user_id ?? userId,
  }));

  const { data, error } = await insforge.database
    .from('scheduled_agent_messages')
    .insert(records)
    .select('*');

  assertNoDatabaseError(error, 'Unable to save scheduled agent messages.');
  return (data ?? []) as ScheduledAgentMessage[];
}

export async function createScheduledAgentExecution(
  input: {
    taskId: string;
    changeRequestId?: string | null;
    planId?: string | null;
    status?: ScheduledAgentExecution['status'];
    scheduledFor?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    runnerId?: string | null;
    resultSummary?: string | null;
    errorMessage?: string | null;
    error?: string | null;
    metadata?: Record<string, unknown>;
    contextSnapshot?: Record<string, unknown>;
    userId: string;
  },
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data, error } = await insforge.database
    .from('scheduled_agent_executions')
    .insert([{
      task_id: input.taskId,
      change_request_id: input.changeRequestId ?? null,
      plan_id: input.planId ?? null,
      status: input.status ?? 'queued',
      scheduled_for: input.scheduledFor ?? new Date().toISOString(),
      started_at: input.startedAt ?? null,
      finished_at: input.finishedAt ?? null,
      runner_id: input.runnerId ?? null,
      result_summary: input.resultSummary ?? null,
      error_message: input.errorMessage ?? null,
      error: input.error ?? null,
      metadata: input.metadata ?? {},
      context_snapshot: input.contextSnapshot ?? {},
      user_id: input.userId,
    }])
    .select('*');

  assertNoDatabaseError(error, 'Unable to create scheduled agent execution.');
  return (data?.[0] ?? null) as ScheduledAgentExecution | null;
}

function slugifyBranchPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'custom-feature';
}

export async function createQueuedAgentRunFromPlan(
  request: ChangeRequest,
  plan: ChangeRequestPlan,
  userId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const { data: activeRuns, error: activeRunError } = await insforge.database
    .from('agent_runs')
    .select('*')
    .eq('change_request_id', request.id)
    .in('status', ['queued', 'running'])
    .order('started_at', { ascending: false })
    .range(0, 0);

  assertNoDatabaseError(activeRunError, 'Unable to check existing coding agent runs.');
  const activeRun = (activeRuns?.[0] ?? null) as AgentRun | null;
  if (activeRun) return activeRun;

  const plannedFeatureKey = typeof plan.context_bundle.feature_key === 'string'
    ? plan.context_bundle.feature_key
    : null;
  const branchPart = slugifyBranchPart(
    plannedFeatureKey || request.feature_key || request.title,
  );
  const planSnapshot = {
    summary: plan.summary,
    implementation_plan: plan.implementation_plan,
    acceptance_criteria: plan.acceptance_criteria,
    coding_agent_prompt: plan.coding_agent_prompt,
    context_bundle: plan.context_bundle,
  };

  const { data, error } = await insforge.database
    .from('agent_runs')
    .insert([{
      change_request_id: request.id,
      status: 'queued',
      plan_id: plan.id,
      plan_snapshot: planSnapshot,
      git_branch: `feat/${branchPart}`,
      backend_branch: branchPart,
      user_id: userId,
    }])
    .select('*');

  assertNoDatabaseError(error, 'Unable to queue coding agent run.');
  const run = (data?.[0] ?? null) as AgentRun | null;
  if (!run) throw new Error('The coding agent run was not created.');

  try {
    const { error: planError } = await insforge.database
      .from('change_request_plans')
      .update({
        status: 'sent_to_agent',
        sent_to_agent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', plan.id);

    assertNoDatabaseError(planError, 'Unable to mark plan as sent.');
  } catch (error) {
    await insforge.database.from('agent_runs').delete().eq('id', run.id);
    throw error;
  }

  return run;
}

export async function createQueuedAgentRunFromScheduledExecution(
  taskId: string,
  executionId: string,
  userId: string,
  accessToken?: string | null,
) {
  const insforge = getInsforge(accessToken);
  const [task, execution] = await Promise.all([
    getScheduledAgentTask(taskId, accessToken),
    getScheduledAgentExecution(executionId, accessToken),
  ]);

  if (!task) throw new Error('Scheduled agent task was not found.');
  if (!execution) throw new Error('Scheduled agent execution was not found.');
  if (execution.task_id !== task.id) {
    throw new Error('Scheduled agent execution does not belong to the task.');
  }

  const changeRequestId = execution.change_request_id ?? task.change_request_id;
  if (!changeRequestId) {
    throw new Error('Scheduled agent task has no change request to run.');
  }

  const { data: request, error: requestError } = await insforge.database
    .from('change_requests')
    .select('*')
    .eq('id', changeRequestId)
    .maybeSingle();

  assertNoDatabaseError(requestError, 'Unable to load scheduled change request.');
  if (!request) throw new Error('Scheduled change request was not found.');

  let planQuery = insforge.database
    .from('change_request_plans')
    .select('*')
    .eq('change_request_id', changeRequestId);

  const planId = execution.plan_id ?? task.plan_id;
  if (planId) {
    planQuery = planQuery.eq('id', planId);
  } else {
    planQuery = planQuery.in('status', ['finalized', 'sent_to_agent']);
  }

  const { data: planRows, error: planError } = await planQuery
    .order('updated_at', { ascending: false })
    .range(0, 0);

  assertNoDatabaseError(planError, 'Unable to load scheduled change request plan.');
  const plan = (planRows?.[0] ?? null) as ChangeRequestPlan | null;
  if (!plan) {
    throw new Error('Scheduled agent task needs a finalized change request plan.');
  }

  const plannedFeatureKey = typeof plan.context_bundle.feature_key === 'string'
    ? plan.context_bundle.feature_key
    : null;
  const branchPart = slugifyBranchPart(
    plannedFeatureKey || request.feature_key || request.title,
  );
  const planSnapshot = {
    summary: plan.summary,
    implementation_plan: plan.implementation_plan,
    acceptance_criteria: plan.acceptance_criteria,
    coding_agent_prompt: plan.coding_agent_prompt,
    context_bundle: plan.context_bundle,
    scheduled_task: {
      id: task.id,
      title: task.title,
      schedule_type: task.schedule_type,
      context_snapshot: task.context_snapshot,
    },
    scheduled_execution: {
      id: execution.id,
      scheduled_for: execution.scheduled_for,
      context_snapshot: execution.context_snapshot,
    },
  };

  const { data, error } = await insforge.database
    .from('agent_runs')
    .insert([{
      change_request_id: request.id,
      status: 'queued',
      plan_id: plan.id,
      plan_snapshot: planSnapshot,
      trigger_type: 'scheduled',
      scheduled_task_id: task.id,
      scheduled_execution_id: execution.id,
      git_branch: `feat/${branchPart}`,
      backend_branch: branchPart,
      user_id: userId,
    }])
    .select('*');

  assertNoDatabaseError(error, 'Unable to queue scheduled coding agent run.');
  const run = (data?.[0] ?? null) as AgentRun | null;
  if (!run) throw new Error('The scheduled coding agent run was not created.');

  try {
    const now = new Date().toISOString();
    const { error: executionError } = await insforge.database
      .from('scheduled_agent_executions')
      .update({
        agent_run_id: run.id,
        change_request_id: request.id,
        plan_id: plan.id,
        status: 'running',
        started_at: now,
        updated_at: now,
      })
      .eq('id', execution.id);

    assertNoDatabaseError(executionError, 'Unable to link scheduled execution.');

    const { error: taskError } = await insforge.database
      .from('scheduled_agent_tasks')
      .update({
        last_run_at: now,
        updated_at: now,
      })
      .eq('id', task.id);

    assertNoDatabaseError(taskError, 'Unable to update scheduled agent task.');
  } catch (error) {
    await insforge.database.from('agent_runs').delete().eq('id', run.id);
    throw error;
  }

  return run;
}
