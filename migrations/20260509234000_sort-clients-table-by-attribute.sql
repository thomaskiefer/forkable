INSERT INTO public.feature_flags (key, name, description)
VALUES (
  'sort_clients_table_by_attribute',
  'Sort Clients table by attribute',
  'Allow the Clients tab to sort by company name, deal value, last activity, and ARR.'
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
SELECT
  member.company_account_id,
  'sort_clients_table_by_attribute',
  true,
  'production',
  'Enabled for the company that requested Clients table sorting.',
  member.user_id
FROM public.company_account_members member
WHERE lower(member.email) = lower('thomaskieferonline@gmail.com')
ON CONFLICT (company_account_id, feature_key, user_id)
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  rollout_stage = EXCLUDED.rollout_stage,
  notes = EXCLUDED.notes,
  updated_at = now();
