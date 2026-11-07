\set ON_ERROR_STOP on
-- Disposable bootstrap only; the test rolls back its fixtures.
BEGIN;
INSERT INTO auth.users(id) VALUES
('dddddddd-dddd-dddd-dddd-dddddddddddd'), ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
('ffffffff-ffff-ffff-ffff-ffffffffffff'), ('99999999-9999-9999-9999-999999999999'),
('88888888-8888-8888-8888-888888888888');
INSERT INTO public.kitchen_memberships(user_id,client_id,role) VALUES
('dddddddd-dddd-dddd-dddd-dddddddddddd','calc-alpha','manager'),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','calc-alpha','chef'),
('ffffffff-ffff-ffff-ffff-ffffffffffff','calc-alpha','staff'),
('99999999-9999-9999-9999-999999999999','calc-beta','owner'),
('88888888-8888-8888-8888-888888888888','calc-alpha','owner');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-dddd-dddd-dddddddddddd',true);
INSERT INTO public.operations_projects_v1(id,client_id,document) VALUES
('10000000-0000-0000-0000-000000000001','calc-alpha','{"name":"Blocked fixture"}'),
('10000000-0000-0000-0000-000000000002','calc-alpha','{"name":"Manager fixture"}'),
('10000000-0000-0000-0000-000000000003','calc-alpha','{"name":"Owner fixture"}'),
('10000000-0000-0000-0000-000000000004','calc-alpha','{"name":"Stale fixture"}');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_calculation_jobs_v1(client_id,project_id,project_revision,idempotency_key,requested_by)
    VALUES ('calc-alpha','10000000-0000-0000-0000-000000000001',1,'browser',auth.uid());
    RAISE EXCEPTION 'FAIL browser created a job';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.operations_calculation_runs_v1(job_id,client_id,project_id,project_revision,engine_version,snapshot)
    VALUES (gen_random_uuid(),'calc-alpha','10000000-0000-0000-0000-000000000001',1,'3','{"ready":true,"cost":0,"schedule":[]}');
    RAISE EXCEPTION 'FAIL browser forged a completed run';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.operations_calculation_jobs_v1(id,client_id,project_id,project_revision,idempotency_key,requested_by)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,'calc-alpha',('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,1,'fixture','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid FROM generate_series(1,4) n;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_calculation_jobs_v1(client_id,project_id,project_revision,idempotency_key,requested_by)
    VALUES ('calc-alpha','10000000-0000-0000-0000-000000000001',1,'fixture','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
    RAISE EXCEPTION 'FAIL duplicate job';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.operations_calculation_jobs_v1(client_id,project_id,project_revision,idempotency_key,requested_by)
    VALUES ('calc-beta','10000000-0000-0000-0000-000000000001',1,'foreign','99999999-9999-9999-9999-999999999999');
    RAISE EXCEPTION 'FAIL mixed tenant job';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.operations_calculation_jobs_v1(client_id,project_id,project_revision,idempotency_key,requested_by)
    VALUES ('calc-alpha','10000000-0000-0000-0000-000000000001',1,'staff','ffffffff-ffff-ffff-ffff-ffffffffffff');
    RAISE EXCEPTION 'FAIL staff requested job';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
INSERT INTO public.operations_calculation_runs_v1(id,job_id,client_id,project_id,project_revision,engine_version,snapshot)
SELECT ('30000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,j.id,j.client_id,j.project_id,j.project_revision,'3',
jsonb_build_object('clientId',j.client_id,'project',p.document,'engineVersion',3,'ready',n<>1,'recipes','[]'::jsonb,'cost',17.5,'schedule','[{"start":540,"end":600}]'::jsonb)
FROM generate_series(1,3) n JOIN public.operations_calculation_jobs_v1 j ON j.id=('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
JOIN public.operations_projects_v1 p ON p.id=j.project_id;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.operations_calculation_jobs_v1 WHERE status='completed' AND finished_at IS NOT NULL) <> 3 THEN RAISE EXCEPTION 'FAIL atomic completion'; END IF;
  BEGIN
    UPDATE public.operations_calculation_jobs_v1 SET status='running' WHERE id='20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'FAIL reopened completed job';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.operations_calculation_runs_v1 SET snapshot='{}';
    RAISE EXCEPTION 'FAIL worker modified completed output';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Even an owner of the table cannot accidentally rewrite retained completed evidence.
DO $$ BEGIN
  BEGIN
    UPDATE public.operations_calculation_runs_v1 SET snapshot='{}';
    RAISE EXCEPTION 'FAIL immutable completed run';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.operations_calculation_runs_v1;
    RAISE EXCEPTION 'FAIL deleted completed run';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-ffff-ffff-ffffffffffff',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.operations_calculation_runs_v1) <> 3 OR (SELECT count(*) FROM public.operations_calculation_jobs_v1) <> 4 THEN RAISE EXCEPTION 'FAIL member status access'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.operations_calculation_runs_v1) OR EXISTS(SELECT 1 FROM public.operations_calculation_jobs_v1) THEN RAISE EXCEPTION 'FAIL cross-kitchen status'; END IF;
  BEGIN
    INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision,calculation_run_id)
    VALUES ('calc-beta','10000000-0000-0000-0000-000000000002',1,'30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL cross-kitchen approval';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',true);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision,calculation_run_id)
    VALUES ('calc-alpha','10000000-0000-0000-0000-000000000002',1,'30000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL chef approval authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-dddd-dddd-dddddddddddd',true);
DO $$ DECLARE fake jsonb; BEGIN
  BEGIN
    INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision,calculation_run_id)
    VALUES ('calc-alpha','10000000-0000-0000-0000-000000000001',1,'30000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL blocked run approved';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  FOREACH fake IN ARRAY ARRAY['{"ready":true}'::jsonb,'{"cost":0}'::jsonb,'{"schedule":[]}'::jsonb] LOOP
    BEGIN
      INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision,calculation_run_id,snapshot)
      VALUES ('calc-alpha','10000000-0000-0000-0000-000000000002',1,'30000000-0000-0000-0000-000000000002',fake);
      RAISE EXCEPTION 'FAIL forged browser output';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  END LOOP;
  BEGIN
    INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision) VALUES ('calc-alpha','10000000-0000-0000-0000-000000000002',1);
    RAISE EXCEPTION 'FAIL approval without run';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision,calculation_run_id)
VALUES ('calc-alpha','10000000-0000-0000-0000-000000000002',1,'30000000-0000-0000-0000-000000000002');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.operations_packages_v1 WHERE project_id='10000000-0000-0000-0000-000000000002' AND approved_by=auth.uid() AND snapshot->>'cost'='17.5' AND snapshot->>'status'='approved') THEN RAISE EXCEPTION 'FAIL manager approval linked output'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',true);
INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision,calculation_run_id)
VALUES ('calc-alpha','10000000-0000-0000-0000-000000000003',1,'30000000-0000-0000-0000-000000000003');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.operations_packages_v1 WHERE project_id='10000000-0000-0000-0000-000000000003' AND approved_by=auth.uid()) THEN RAISE EXCEPTION 'FAIL owner authority'; END IF;
END $$;
UPDATE public.operations_projects_v1 SET revision=2 WHERE id IN ('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_packages_v1(client_id,project_id,project_revision,calculation_run_id)
    VALUES ('calc-alpha','10000000-0000-0000-0000-000000000003',2,'30000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'FAIL stale run approval';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_calculation_jobs_v1(client_id,project_id,project_revision,idempotency_key,requested_by)
    VALUES ('calc-alpha','10000000-0000-0000-0000-000000000004',1,'stale','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
    RAISE EXCEPTION 'FAIL stale job revision';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.operations_calculation_runs_v1(job_id,client_id,project_id,project_revision,engine_version,snapshot)
    VALUES ('20000000-0000-0000-0000-000000000004','calc-alpha','10000000-0000-0000-0000-000000000004',1,'3','{"clientId":"calc-alpha","project":{"name":"Stale fixture"},"engineVersion":3,"ready":true,"recipes":[]}');
    RAISE EXCEPTION 'FAIL stale run completion';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.operations_calculation_runs_v1; RAISE EXCEPTION 'FAIL anonymous run access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'trusted calculation tenant, authority, idempotency, immutability, stale revision and browser forgery checks passed' AS result;
