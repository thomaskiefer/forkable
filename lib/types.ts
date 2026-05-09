export interface AuthViewer {
  isAuthenticated: boolean;
  id: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified';
export type ActivityType = 'email' | 'call' | 'meeting' | 'note' | 'task';
export type FollowUpPriority = 'low' | 'medium' | 'high';
export type FollowUpStatus = 'pending' | 'completed' | 'overdue';

export interface Client {
  id: string;
  name: string;
  client_code: string;
  address?: string;
  postal_code?: string;
  country_code?: string;
  is_active: boolean;
  is_deleted: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  user_id: string;
}

export interface LeadStage {
  id: string;
  name: string;
  description?: string;
  order_index: number;
  is_active: boolean;
  user_id: string;
}

export interface Lead {
  id: string;
  company_name: string;
  industry?: string;
  website?: string;
  contact_name: string;
  contact_title?: string;
  contact_email?: string;
  contact_phone?: string;
  source_id: string;
  current_stage_id: string;
  status: LeadStatus;
  score: number;
  deal_value: number;
  notes?: string;
  tags?: string[];
  is_converted: boolean;
  converted_to_client_id?: string;
  converted_at?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  source?: { name: string };
  current_stage?: { name: string };
}

export interface LeadStageHistory {
  id: string;
  lead_id: string;
  from_stage_id?: string;
  to_stage_id: string;
  changed_by: string;
  changed_at: string;
  time_in_previous_stage?: string;
  notes?: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  type: ActivityType;
  subject: string;
  description?: string;
  activity_date: string;
  duration_minutes?: number;
  status?: string;
  user_id: string;
  created_at: string;
}

export interface LeadDocument {
  id: string;
  lead_id: string;
  name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  user_id: string;
  created_at: string;
}

export interface LeadFollowUp {
  id: string;
  lead_id: string;
  due_date: string;
  priority: FollowUpPriority;
  status: FollowUpStatus;
  description: string;
  completed_at?: string;
  user_id: string;
  created_at: string;
}

export interface DealApprovalRequest {
  id: string;
  lead_id: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  amount?: number;
  reason?: string;
  created_at: string;
  approved_at?: string;
  user_id: string;
}

export interface DealApprovalAuditEvent {
  id: string;
  approval_request_id?: string;
  lead_id: string;
  event_type: string;
  actor_id: string;
  metadata: Record<string, unknown>;
  user_id: string;
  created_at: string;
}

export interface LeadConversion {
  id: string;
  lead_id: string;
  client_id: string;
  converted_at: string;
  converted_by: string;
  deal_value?: number;
  conversion_notes?: string;
  user_id: string;
}

export interface Project {
  id: string;
  name: string;
  client_id: string;
  currency?: string;
  start_date?: string;
  end_date?: string;
  deal_status: string;
  billable: boolean;
  note?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  client?: Client;
}

export interface ChangeRequest {
  id: string;
  title: string;
  customer_name: string;
  customer_email: string;
  description: string;
  status: string;
  feature_key?: string;
  company_account_id?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyAccount {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  website?: string;
  industry?: string;
  segment?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  change_request_id: string;
  status: string;
  plan_id?: string;
  plan_snapshot?: Record<string, unknown>;
  trigger_type?: 'manual' | 'scheduled';
  scheduled_task_id?: string;
  scheduled_execution_id?: string;
  git_branch?: string;
  backend_branch?: string;
  preview_url?: string;
  runner_mode?: string;
  runner_id?: string;
  runner_job_id?: string;
  runner_started_at?: string;
  runner_finished_at?: string;
  runner_error?: string;
  output_summary?: string;
  pull_request_url?: string;
  commit_sha?: string;
  started_at: string;
  finished_at?: string;
  user_id: string;
}

export interface AgentStep {
  id: string;
  run_id: string;
  order_index: number;
  label: string;
  status: string;
  details?: string;
  completed_at?: string;
  user_id: string;
}

export interface BranchPreview {
  id: string;
  run_id: string;
  app_url: string;
  backend_branch?: string;
  deployment_id?: string;
  status: string;
  created_at: string;
  user_id: string;
}

export interface TestResult {
  id: string;
  run_id: string;
  name: string;
  status: string;
  details?: string;
  completed_at: string;
  user_id: string;
}

export interface CustomerFeatureFlag {
  id: string;
  customer_email: string;
  feature_key: string;
  enabled: boolean;
  user_id: string;
  created_at: string;
}

export type PlanningMessageRole = 'system' | 'user' | 'assistant';

export interface ChangeRequestPlanningMessage {
  id: string;
  change_request_id: string;
  role: PlanningMessageRole;
  content: string;
  sort_order: number;
  metadata: Record<string, unknown>;
  user_id: string;
  created_at: string;
}

export type ChangeRequestPlanStatus = 'draft' | 'finalized' | 'sent_to_agent';

export interface ChangeRequestPlan {
  id: string;
  change_request_id: string;
  status: ChangeRequestPlanStatus;
  summary: string;
  implementation_plan: string;
  acceptance_criteria: string[];
  coding_agent_prompt: string;
  context_bundle: Record<string, unknown>;
  finalized_at?: string;
  sent_to_agent_at?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export type ScheduledAgentTaskStatus = 'draft' | 'active' | 'paused' | 'archived';
export type ScheduledAgentScheduleType =
  | 'manual'
  | 'once'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'cron';
export type ScheduledAgentTaskType =
  | 'monitor_context'
  | 'queue_agent'
  | 'report_only';
export type ScheduledAgentExecutionStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ScheduledAgentTask {
  id: string;
  title: string;
  name?: string;
  description: string;
  instructions?: string;
  prompt?: string;
  customer_name: string;
  customer_email: string;
  task_type: ScheduledAgentTaskType;
  feature_key?: string;
  status: ScheduledAgentTaskStatus;
  schedule_type: ScheduledAgentScheduleType;
  schedule?: string;
  schedule_label?: string;
  rrule?: string;
  cron_expression?: string;
  timezone: string;
  change_request_id?: string;
  plan_id?: string;
  next_run_at?: string;
  last_run_at?: string;
  activated_at?: string;
  paused_at?: string;
  draft_prompt?: string;
  metadata: Record<string, unknown>;
  context_snapshot: Record<string, unknown>;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduledAgentMessage {
  id: string;
  task_id: string;
  role: PlanningMessageRole;
  content: string;
  sort_order: number;
  metadata: Record<string, unknown>;
  user_id: string;
  created_at: string;
}

export interface ScheduledAgentExecution {
  id: string;
  task_id: string;
  change_request_id?: string;
  plan_id?: string;
  agent_run_id?: string;
  status: ScheduledAgentExecutionStatus;
  scheduled_for: string;
  started_at?: string;
  finished_at?: string;
  runner_id?: string;
  result_summary?: string;
  error_message?: string;
  error?: string;
  metadata: Record<string, unknown>;
  context_snapshot: Record<string, unknown>;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export type FeaturePlanningStreamEvent =
  | { type: 'delta'; content: string }
  | {
      type: 'done';
      payload: {
        userMessage: ChangeRequestPlanningMessage;
        assistantMessage: ChangeRequestPlanningMessage;
      };
    }
  | { type: 'warning'; message: string }
  | { type: 'error'; error: string };
