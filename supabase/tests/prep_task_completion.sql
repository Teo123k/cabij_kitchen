\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001'),('aaaaaaaa-0000-0000-0000-000000000002'),('aaaaaaaa-0000-0000-0000-000000000003');
INSERT INTO public.kitchen_memberships(user_id,client_id,role) VALUES
('aaaaaaaa-0000-0000-0000-000000000001','completion-a','owner'),
('aaaaaaaa-0000-0000-0000-000000000002','completion-a','chef'),
('aaaaaaaa-0000-0000-0000-000000000003','completion-b','owner');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
INSERT INTO public.operations_projects_v1(id,client_id,document) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','completion-a','{"name":"Test"}');
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.operations_calculation_jobs_v1(id,client_id,project_id,project_revision,idempotency_key,requested_by) VALUES ('cccccccc-0000-0000-0000-000000000001','completion-a','bbbbbbbb-0000-0000-0000-000000000001',1,'fixture','aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO public.operations_calculation_runs_v1(id,job_id,client_id,project_id,project_revision,engine_version,snapshot) VALUES ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','completion-a','bbbbbbbb-0000-0000-0000-000000000001',1,'3','{"clientId":"completion-a","project":{"name":"Test"},"engineVersion":3,"ready":true,"recipes":[],"tasks":[{"id":"task-1"}],"calculationInputs":{"pricingPolicy":"reviewed-evidence-v1","prices":[]}}');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
INSERT INTO public.operations_packages_v1(id,client_id,project_id,project_revision,calculation_run_id) VALUES ('eeeeeeee-0000-0000-0000-000000000001','completion-a','bbbbbbbb-0000-0000-0000-000000000001',1,'dddddddd-0000-0000-0000-000000000001');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',true);
INSERT INTO public.operations_task_completion_v1(client_id,project_id,package_id,task_id,status,updated_by) VALUES ('completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','task-1','completed','aaaaaaaa-0000-0000-0000-000000000001');
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.operations_task_completion_v1 WHERE task_id='task-1' AND status='completed' AND updated_by=auth.uid() AND completed_by=auth.uid() AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL actor or completion'; END IF;
 BEGIN
  INSERT INTO public.operations_task_completion_v1(client_id,project_id,package_id,task_id,status) VALUES ('completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','fake','completed');
  RAISE EXCEPTION 'FAIL unapproved task';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
INSERT INTO public.operations_task_completion_v1(client_id,project_id,package_id,task_id,status) VALUES ('completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','task-1','pending') ON CONFLICT (package_id,task_id) DO UPDATE SET status=EXCLUDED.status;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.operations_task_completion_v1 WHERE task_id='task-1' AND status='pending' AND completed_by IS NULL AND completed_at IS NULL) THEN RAISE EXCEPTION 'FAIL reopen'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000003',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.operations_task_completion_v1) THEN RAISE EXCEPTION 'FAIL foreign read'; END IF;
 BEGIN
  INSERT INTO public.operations_task_completion_v1(client_id,project_id,package_id,task_id,status) VALUES ('completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','task-1','completed');
  RAISE EXCEPTION 'FAIL foreign write';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
UPDATE public.operations_projects_v1 SET revision=2 WHERE id='bbbbbbbb-0000-0000-0000-000000000001';
DO $$ BEGIN
 BEGIN
  UPDATE public.operations_task_completion_v1 SET status='completed' WHERE task_id='task-1';
  RAISE EXCEPTION 'FAIL stale update';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
SELECT 'task completion security and lifecycle passed' AS result;
