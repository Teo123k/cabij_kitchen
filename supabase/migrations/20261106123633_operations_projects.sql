-- Apply after 017_v1_recipe_truth.sql. Client projects reference approved recipe versions.
CREATE TABLE public.operations_projects_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.operations_packages_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.operations_projects_v1(id),
  client_id text NOT NULL,
  project_revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  approved_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, project_revision)
);
ALTER TABLE public.operations_projects_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operations_packages_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operations_projects_v1, public.operations_packages_v1 FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.operations_projects_v1 TO authenticated;
GRANT SELECT, INSERT ON public.operations_packages_v1 TO authenticated;
CREATE POLICY project_read ON public.operations_projects_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = auth.uid()));
CREATE POLICY project_create ON public.operations_projects_v1 FOR INSERT TO authenticated
WITH CHECK (revision = 1 AND created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = auth.uid() AND m.role IN ('owner','manager','chef')));
CREATE POLICY project_edit ON public.operations_projects_v1 FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = auth.uid() AND m.role IN ('owner','manager','chef')))
WITH CHECK (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = auth.uid() AND m.role IN ('owner','manager','chef')));
CREATE POLICY package_read ON public.operations_packages_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_packages_v1.client_id AND m.user_id = auth.uid()));
CREATE POLICY package_create ON public.operations_packages_v1 FOR INSERT TO authenticated
WITH CHECK (approved_by = auth.uid() AND EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_packages_v1.client_id AND m.user_id = auth.uid() AND m.role IN ('owner','manager')));
CREATE FUNCTION public.guard_operations_project_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Project identity is immutable'; END IF;
  IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Project revision conflict'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER operations_project_guard BEFORE UPDATE ON public.operations_projects_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_operations_project_v1();
CREATE FUNCTION public.guard_operations_package_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.operations_projects_v1; r jsonb;
BEGIN
  SELECT * INTO p FROM public.operations_projects_v1 WHERE id = NEW.project_id FOR UPDATE;
  IF p.id IS NULL OR p.client_id IS DISTINCT FROM NEW.client_id OR p.revision IS DISTINCT FROM NEW.project_revision OR p.document IS DISTINCT FROM NEW.snapshot->'project' THEN RAISE EXCEPTION 'Save and regenerate the current project before approval'; END IF;
  IF NEW.snapshot->>'clientId' IS DISTINCT FROM NEW.client_id OR NEW.snapshot->>'ready' IS DISTINCT FROM 'true' OR NEW.snapshot->>'status' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'A reviewed complete plan is required'; END IF;
  IF jsonb_typeof(NEW.snapshot->'recipes') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.snapshot->'recipes') = 0 THEN RAISE EXCEPTION 'Approved recipe versions required'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(NEW.snapshot->'recipes') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.recipe_versions_v1 v WHERE v.id::text = r->>'id' AND v.client_id = NEW.client_id AND v.status = 'approved' AND v.recipe_json = r->'recipe_json') THEN RAISE EXCEPTION 'Recipe snapshot is not an approved version for this kitchen'; END IF;
  END LOOP;
  -- The operator approves the calculated package; the server fixes authorship and source revision.
  NEW.approved_by := auth.uid(); NEW.approved_at := now();
  NEW.snapshot := jsonb_set(jsonb_set(NEW.snapshot, '{approvedBy}', to_jsonb(NEW.approved_by::text)), '{approvedAt}', to_jsonb(NEW.approved_at));
  RETURN NEW;
END $$;
CREATE TRIGGER operations_package_guard BEFORE INSERT ON public.operations_packages_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_operations_package_v1();
CREATE INDEX operations_projects_client ON public.operations_projects_v1(client_id);
CREATE INDEX operations_packages_project ON public.operations_packages_v1(client_id, project_id);

-- Approved sub-recipes are resolved by immutable version ID, never a name match.
CREATE OR REPLACE FUNCTION public.guard_recipe_version_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actor_role text;
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','approved_by','approved_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','approved_by','approved_at']) THEN
    RAISE EXCEPTION 'Recipe version content is immutable';
  END IF;
  SELECT m.role INTO actor_role FROM public.kitchen_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.client_id = OLD.client_id;
  IF OLD.status = 'draft' AND NEW.status = 'review' AND actor_role IN ('owner','manager','chef') THEN
    NEW.approved_by := NULL; NEW.approved_at := NULL;
  ELSIF OLD.status = 'review' AND NEW.status = 'approved' AND actor_role IN ('owner','manager') THEN
    IF jsonb_typeof(NEW.recipe_json->'ingredients') IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.recipe_json->'ingredients') = 0
       OR NEW.recipe_json->>'client_id' IS DISTINCT FROM NEW.client_id
       OR NEW.recipe_json->>'recipe_ref_id' IS DISTINCT FROM NEW.recipe_ref_id
       OR NEW.recipe_json->>'canonical_id' IS DISTINCT FROM NEW.canonical_id
       OR NEW.recipe_json->>'title' IS DISTINCT FROM NEW.title
       OR (NEW.recipe_json->'yield'->>'quantity')::numeric IS DISTINCT FROM NEW.yield_quantity
       OR NEW.recipe_json->'yield'->>'unit' IS DISTINCT FROM NEW.yield_unit
       OR NEW.recipe_json->'yield'->>'basis' IS DISTINCT FROM NEW.yield_basis
       OR COALESCE((NEW.recipe_json->>'manager_review_required')::boolean, false)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.recipe_json->'ingredients') i
                  WHERE COALESCE(i->>'canonical_id','') = '' OR COALESCE(i->>'canonical_name','') = ''
                     OR COALESCE(i->>'clean_name','') = ''
                     OR COALESCE((i->>'quantity')::numeric, 0) <= 0
                     OR COALESCE(i->>'unit','') NOT IN ('g','kg','ml','l','each','pcs','portion')
                     OR COALESCE((i->>'needs_review')::boolean, false)
                     OR CASE WHEN COALESCE(i->>'recipe_version_id','') <> '' THEN
                       NOT EXISTS (SELECT 1 FROM public.recipe_versions_v1 child WHERE child.id::text = i->>'recipe_version_id' AND child.client_id = NEW.client_id AND child.status = 'approved' AND child.canonical_id = i->>'canonical_id' AND child.title = i->>'canonical_name')
                       ELSE NOT EXISTS (SELECT 1 FROM public.canonical_ingredients_v1 c WHERE c.canonical_id = i->>'canonical_id' AND c.canonical_name = i->>'canonical_name') END) THEN
      RAISE EXCEPTION 'Recipe needs ingredient or manager review';
    END IF;
    NEW.approved_by := (select auth.uid()); NEW.approved_at := now();
  ELSE
    RAISE EXCEPTION 'Recipe status transition is not allowed';
  END IF;
  RETURN NEW;
END; $$;

