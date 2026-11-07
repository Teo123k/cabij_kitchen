-- Completion is operational state; the approved calculation snapshot stays immutable.
CREATE TABLE public.operations_task_completion_v1 (
  client_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES public.operations_projects_v1(id),
  package_id uuid NOT NULL REFERENCES public.operations_packages_v1(id),
  task_id text NOT NULL CHECK (length(task_id) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('pending', 'completed')),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  PRIMARY KEY (package_id, task_id)
);
CREATE INDEX task_completion_tenant_project ON public.operations_task_completion_v1(client_id, project_id);
ALTER TABLE public.operations_task_completion_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operations_task_completion_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.operations_task_completion_v1 TO authenticated;
CREATE POLICY task_completion_read ON public.operations_task_completion_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_task_completion_v1.client_id AND m.user_id = (select auth.uid())));
CREATE POLICY task_completion_insert ON public.operations_task_completion_v1 FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_task_completion_v1.client_id AND m.user_id = (select auth.uid())));
CREATE POLICY task_completion_update ON public.operations_task_completion_v1 FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_task_completion_v1.client_id AND m.user_id = (select auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_task_completion_v1.client_id AND m.user_id = (select auth.uid())));

CREATE FUNCTION public.guard_task_completion_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.operations_packages_v1; project public.operations_projects_v1;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.client_id, NEW.project_id, NEW.package_id, NEW.task_id) IS DISTINCT FROM (OLD.client_id, OLD.project_id, OLD.package_id, OLD.task_id) THEN
    RAISE EXCEPTION 'Task completion identity is immutable';
  END IF;
  IF (select auth.uid()) IS NULL OR NOT EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = NEW.client_id AND m.user_id = (select auth.uid())) THEN
    RAISE EXCEPTION 'Kitchen membership is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.operations_packages_v1 WHERE id = NEW.package_id AND client_id = NEW.client_id AND project_id = NEW.project_id;
  SELECT * INTO project FROM public.operations_projects_v1 WHERE id = NEW.project_id AND client_id = NEW.client_id;
  IF p.id IS NULL OR project.id IS NULL OR p.calculation_run_id IS NULL OR p.project_revision IS DISTINCT FROM project.revision
      OR p.snapshot->>'status' IS DISTINCT FROM 'approved' OR p.snapshot->>'ready' IS DISTINCT FROM 'true'
      OR p.snapshot->'project'->>'sample' = 'true' THEN
    RAISE EXCEPTION 'A current approved trusted package is required';
  END IF;
  IF jsonb_typeof(p.snapshot->'tasks') IS DISTINCT FROM 'array' OR NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(p.snapshot->'tasks') t WHERE t->>'id' = NEW.task_id) THEN
    RAISE EXCEPTION 'Task is not in the approved package';
  END IF;
  NEW.updated_by := (select auth.uid()); NEW.updated_at := now();
  IF NEW.status = 'completed' THEN NEW.completed_by := NEW.updated_by; NEW.completed_at := NEW.updated_at;
  ELSE NEW.completed_by := NULL; NEW.completed_at := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_completion_guard BEFORE INSERT OR UPDATE ON public.operations_task_completion_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_task_completion_v1();
REVOKE ALL ON FUNCTION public.guard_task_completion_v1() FROM PUBLIC, anon, authenticated;
