-- Completed outputs are written only by the trusted worker, never by browser sessions.
ALTER TABLE public.operations_projects_v1 ADD CONSTRAINT operations_projects_tenant_key UNIQUE (id, client_id);
CREATE TABLE public.operations_calculation_jobs_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  project_id uuid NOT NULL,
  project_revision integer NOT NULL CHECK (project_revision > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (project_id, client_id) REFERENCES public.operations_projects_v1(id, client_id),
  UNIQUE (client_id, project_id, project_revision, idempotency_key),
  UNIQUE (id, client_id, project_id, project_revision)
);
CREATE TABLE public.operations_calculation_runs_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE,
  client_id text NOT NULL,
  project_id uuid NOT NULL,
  project_revision integer NOT NULL,
  engine_version text NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  completed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, client_id, project_id, project_revision)
    REFERENCES public.operations_calculation_jobs_v1(id, client_id, project_id, project_revision),
  UNIQUE (id, client_id, project_id, project_revision)
);
-- Nullable for history created before this boundary; the insert guard requires it for new approvals.
ALTER TABLE public.operations_packages_v1 ADD COLUMN calculation_run_id uuid;
ALTER TABLE public.operations_packages_v1 ADD CONSTRAINT operations_package_calculation_run
  FOREIGN KEY (calculation_run_id, client_id, project_id, project_revision)
  REFERENCES public.operations_calculation_runs_v1(id, client_id, project_id, project_revision);
CREATE INDEX calculation_job_project ON public.operations_calculation_jobs_v1(project_id, client_id);
CREATE INDEX calculation_job_requester ON public.operations_calculation_jobs_v1(requested_by);
CREATE INDEX calculation_run_tenant_project ON public.operations_calculation_runs_v1(client_id, project_id);
CREATE INDEX package_calculation_run ON public.operations_packages_v1(calculation_run_id, client_id, project_id, project_revision);
ALTER TABLE public.operations_calculation_jobs_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operations_calculation_runs_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operations_calculation_jobs_v1, public.operations_calculation_runs_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.operations_calculation_jobs_v1, public.operations_calculation_runs_v1 TO authenticated;
GRANT SELECT, INSERT ON public.operations_calculation_jobs_v1, public.operations_calculation_runs_v1 TO service_role;
GRANT UPDATE (status, error) ON public.operations_calculation_jobs_v1 TO service_role;
-- The worker must also resolve the existing guarded source tables using its server identity.
GRANT SELECT ON public.operations_projects_v1, public.recipe_versions_v1, public.kitchen_memberships TO service_role;
-- Row locks require an UPDATE privilege, although the worker never edits source revisions.
GRANT UPDATE (revision) ON public.operations_projects_v1 TO service_role;
CREATE POLICY calculation_job_read ON public.operations_calculation_jobs_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_calculation_jobs_v1.client_id AND m.user_id = (select auth.uid())));
CREATE POLICY calculation_run_read ON public.operations_calculation_runs_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_calculation_runs_v1.client_id AND m.user_id = (select auth.uid())));

CREATE FUNCTION public.guard_operations_calculation_job_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.operations_projects_v1;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Calculation jobs are retained'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'running' OR NEW.status NOT IN ('completed','failed')
       OR (to_jsonb(NEW) - ARRAY['status','error','finished_at']) IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status','error','finished_at']) THEN
      RAISE EXCEPTION 'Calculation job transition is not allowed';
    END IF;
    IF NEW.status = 'completed' AND NOT EXISTS (SELECT 1 FROM public.operations_calculation_runs_v1 r WHERE r.job_id = OLD.id) THEN
      RAISE EXCEPTION 'A completed calculation run is required';
    END IF;
    NEW.finished_at := now();
    RETURN NEW;
  END IF;
  SELECT * INTO p FROM public.operations_projects_v1 WHERE id = NEW.project_id AND client_id = NEW.client_id FOR SHARE;
  IF p.id IS NULL OR p.revision IS DISTINCT FROM NEW.project_revision THEN RAISE EXCEPTION 'Save and regenerate the current project revision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id = NEW.requested_by AND m.client_id = NEW.client_id AND m.role IN ('chef','manager','owner')) THEN
    RAISE EXCEPTION 'A chef or manager membership is required';
  END IF;
  IF NEW.status <> 'running' OR NEW.error IS NOT NULL OR NEW.finished_at IS NOT NULL THEN RAISE EXCEPTION 'Jobs must start running'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calculation_job_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operations_calculation_jobs_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_operations_calculation_job_v1();

CREATE FUNCTION public.guard_operations_calculation_run_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.operations_projects_v1; j public.operations_calculation_jobs_v1; r jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Completed calculation runs are immutable'; END IF;
  SELECT * INTO j FROM public.operations_calculation_jobs_v1 WHERE id = NEW.job_id FOR UPDATE;
  IF j.id IS NULL OR j.status <> 'running' OR j.client_id IS DISTINCT FROM NEW.client_id
    OR j.project_id IS DISTINCT FROM NEW.project_id OR j.project_revision IS DISTINCT FROM NEW.project_revision THEN
    RAISE EXCEPTION 'A running calculation job for this project is required';
  END IF;
  SELECT * INTO p FROM public.operations_projects_v1 WHERE id = NEW.project_id AND client_id = NEW.client_id FOR SHARE;
  IF p.id IS NULL OR p.revision IS DISTINCT FROM NEW.project_revision OR p.document IS DISTINCT FROM NEW.snapshot->'project' THEN
    RAISE EXCEPTION 'Save and regenerate the current project revision';
  END IF;
  IF NEW.snapshot->>'clientId' IS DISTINCT FROM NEW.client_id OR NEW.snapshot->>'engineVersion' IS DISTINCT FROM NEW.engine_version
     OR NEW.snapshot ? 'approvedBy' OR NEW.snapshot ? 'approvedAt' OR NEW.snapshot ? 'status'
     OR jsonb_typeof(NEW.snapshot->'ready') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(NEW.snapshot->'recipes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid trusted calculation output';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(NEW.snapshot->'recipes') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.recipe_versions_v1 v WHERE v.id::text = r->>'id' AND v.client_id = NEW.client_id AND v.status = 'approved' AND to_jsonb(v) = r) THEN
      RAISE EXCEPTION 'Calculation recipe source is not an approved kitchen version';
    END IF;
  END LOOP;
  NEW.completed_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER calculation_run_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operations_calculation_runs_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_operations_calculation_run_v1();
CREATE FUNCTION public.complete_operations_calculation_job_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.operations_calculation_jobs_v1 SET status = 'completed', error = NULL WHERE id = NEW.job_id;
  RETURN NEW;
END $$;
CREATE TRIGGER calculation_run_complete AFTER INSERT ON public.operations_calculation_runs_v1
FOR EACH ROW EXECUTE FUNCTION public.complete_operations_calculation_job_v1();

CREATE OR REPLACE FUNCTION public.guard_operations_package_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.operations_projects_v1; r public.operations_calculation_runs_v1;
BEGIN
  IF NEW.snapshot IS NOT NULL THEN RAISE EXCEPTION 'Browser calculation snapshots cannot be approved; supply a calculation run'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = NEW.client_id AND m.user_id = (select auth.uid()) AND m.role IN ('manager','owner')) THEN
    RAISE EXCEPTION 'Manager membership in this kitchen is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.operations_calculation_runs_v1 WHERE id = NEW.calculation_run_id AND client_id = NEW.client_id;
  SELECT * INTO p FROM public.operations_projects_v1 WHERE id = NEW.project_id AND client_id = NEW.client_id FOR SHARE;
  IF r.id IS NULL OR p.id IS NULL OR r.project_id IS DISTINCT FROM p.id OR r.project_revision IS DISTINCT FROM p.revision
     OR NEW.project_revision IS DISTINCT FROM p.revision OR r.snapshot->'project' IS DISTINCT FROM p.document THEN
    RAISE EXCEPTION 'A completed calculation run for the current project revision is required';
  END IF;
  IF r.snapshot->>'ready' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Resolve blocking exceptions before approval'; END IF;
  NEW.approved_by := auth.uid(); NEW.approved_at := now();
  NEW.snapshot := r.snapshot || jsonb_build_object('status','approved','approvedBy',NEW.approved_by,'approvedAt',NEW.approved_at);
  RETURN NEW;
END $$;
-- These are trigger internals, not callable Data API functions.
REVOKE ALL ON FUNCTION public.guard_operations_calculation_job_v1(), public.guard_operations_calculation_run_v1(), public.complete_operations_calculation_job_v1() FROM PUBLIC, anon, authenticated;
