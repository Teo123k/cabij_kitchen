CREATE TABLE public.recipe_workflow_imports_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  workflow_id text NOT NULL,
  execution_id text NOT NULL,
  recipe_index integer NOT NULL CHECK (recipe_index >= 0),
  source_recipe jsonb NOT NULL CHECK (jsonb_typeof(source_recipe) = 'object' AND (source_recipe->>'client_id') IS NOT DISTINCT FROM client_id),
  source_fingerprint text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id,workflow_id,execution_id,recipe_index)
);
ALTER TABLE public.recipe_workflow_imports_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_workflow_imports_v1 FROM anon, authenticated;
GRANT SELECT, INSERT ON public.recipe_workflow_imports_v1 TO authenticated;
CREATE POLICY workflow_import_read ON public.recipe_workflow_imports_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=recipe_workflow_imports_v1.client_id AND m.user_id=(select auth.uid())));
CREATE POLICY workflow_import_create ON public.recipe_workflow_imports_v1 FOR INSERT TO authenticated
WITH CHECK (created_by=(select auth.uid()) AND EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=recipe_workflow_imports_v1.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','manager','chef')));
CREATE INDEX workflow_import_creator ON public.recipe_workflow_imports_v1(created_by);
