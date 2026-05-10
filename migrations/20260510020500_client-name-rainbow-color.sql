INSERT INTO public.feature_flags (key, name, description)
VALUES (
  'client_name_rainbow_color',
  'Client name rainbow color',
  'Render client names on the clients page with a static rainbow text treatment.'
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
  'client_name_rainbow_color',
  true,
  'production',
  'Enabled for request 4e620f6b-1cd3-4b29-a9bf-49f0e8bd830a.',
  '717ac12a-df48-4742-accc-708e4507ba5b'
)
ON CONFLICT (company_account_id, feature_key, user_id)
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  rollout_stage = EXCLUDED.rollout_stage,
  notes = EXCLUDED.notes,
  updated_at = now();

UPDATE public.change_requests
SET feature_key = 'client_name_rainbow_color',
    updated_at = now()
WHERE id = '4e620f6b-1cd3-4b29-a9bf-49f0e8bd830a';
