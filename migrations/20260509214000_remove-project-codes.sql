ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_code_not_blank;

ALTER TABLE public.projects
  DROP COLUMN IF EXISTS code;
