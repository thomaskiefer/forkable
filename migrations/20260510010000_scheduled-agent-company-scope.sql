ALTER TABLE public.scheduled_agent_tasks
  ADD COLUMN IF NOT EXISTS company_account_id uuid
    REFERENCES public.company_accounts(id)
    ON DELETE SET NULL;

UPDATE public.scheduled_agent_tasks task
SET company_account_id = member.company_account_id,
    updated_at = now()
FROM public.company_account_members member
WHERE task.company_account_id IS NULL
  AND task.user_id = member.user_id
  AND lower(task.customer_email) = lower(member.email);

CREATE INDEX IF NOT EXISTS scheduled_agent_tasks_company_idx
  ON public.scheduled_agent_tasks (company_account_id, status, next_run_at);
