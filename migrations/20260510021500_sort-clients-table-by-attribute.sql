INSERT INTO public.feature_flags (key, name, description)
VALUES (
  'sort_clients_table_by_attribute',
  'Sort clients table by attribute',
  'Allow the Clients table to sort by company name, deal value, last activity, and ARR.'
)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO public.company_feature_flags (
  company_account_id,
  feature_key,
  enabled,
  rollout_stage,
  notes,
  user_id
)
VALUES (
  '48561cc0-3f29-49d9-a191-6291b1e90d0c',
  'sort_clients_table_by_attribute',
  true,
  'production',
  'Enabled for request 85800b56-6e2a-4c90-8b01-158da075cf4c.',
  '717ac12a-df48-4742-accc-708e4507ba5b'
)
ON CONFLICT (company_account_id, feature_key, user_id)
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  rollout_stage = EXCLUDED.rollout_stage,
  notes = EXCLUDED.notes,
  updated_at = now();

UPDATE public.change_requests
SET feature_key = 'sort_clients_table_by_attribute',
    updated_at = now()
WHERE id = '85800b56-6e2a-4c90-8b01-158da075cf4c';
