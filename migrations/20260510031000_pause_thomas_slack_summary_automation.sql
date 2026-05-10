UPDATE public.scheduled_agent_tasks
SET status = 'paused',
    next_run_at = NULL,
    paused_at = COALESCE(paused_at, now()),
    updated_at = now(),
    metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'stopped_by_scheduled_request', true,
        'stopped_change_request_id', 'eeab8ae2-0d9f-4adc-b3f1-adb97e952aba',
        'stopped_at', now()
      )
WHERE id = 'b26a4324-7310-4b55-a2fd-78f72ad8a405'
  AND company_account_id = '48561cc0-3f29-49d9-a191-6291b1e90d0c'
  AND status = 'active';
