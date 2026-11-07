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
RESET ROLE;
INSERT INTO public.slack_kitchen_members_v1(slack_team_id,slack_user_id,client_id,user_id) VALUES ('T123','U123','completion-a','aaaaaaaa-0000-0000-0000-000000000002');
SET ROLE service_role;
DO $$ DECLARE answer jsonb; BEGIN
 answer := public.slack_complete_task_v1('T123','U123','123.123','cabij_task_complete_v1','completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',1,'task-1','completed');
 IF answer->>'status'<>'completed' THEN RAISE EXCEPTION 'FAIL completion'; END IF;
 answer := public.slack_complete_task_v1('T123','U123','123.123','cabij_task_complete_v1','completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',1,'task-1','completed');
 IF answer->>'duplicate'<>'true' THEN RAISE EXCEPTION 'FAIL duplicate'; END IF;
 BEGIN
  PERFORM public.slack_complete_task_v1('T123','U999','124.123','cabij_task_complete_v1','completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',1,'task-1','completed');
  RAISE EXCEPTION 'FAIL unlinked Slack user';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.slack_complete_task_v1('T123','U123','125.123','cabij_task_complete_v1','completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',2,'task-1','completed');
  RAISE EXCEPTION 'FAIL foreign revision';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.operations_task_completion_v1 WHERE task_id='task-1' AND updated_by='aaaaaaaa-0000-0000-0000-000000000002' AND status='completed') THEN RAISE EXCEPTION 'FAIL linked actor'; END IF;
END $$;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.slack_complete_task_v1('T123','U123','126.123','cabij_task_complete_v1','completion-a','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',1,'task-1','completed');
  RAISE EXCEPTION 'FAIL client RPC access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'Slack task identity, replay and authority passed' AS result;
