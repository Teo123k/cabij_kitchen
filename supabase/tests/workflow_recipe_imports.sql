BEGIN;
INSERT INTO auth.users(id) VALUES ('f0000000-0000-4000-8000-000000000001'),('f0000000-0000-4000-8000-000000000002');
INSERT INTO public.kitchen_memberships(user_id,client_id,role) VALUES ('f0000000-0000-4000-8000-000000000001','wf-test-alpha','owner'),('f0000000-0000-4000-8000-000000000002','wf-test-beta','owner');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
INSERT INTO public.recipe_workflow_imports_v1(client_id,workflow_id,execution_id,recipe_index,source_recipe,source_fingerprint) VALUES ('wf-test-alpha','wf1','123',0,'{"client_id":"wf-test-alpha","title":"Test source"}','fingerprint');
DO $$ BEGIN
 BEGIN INSERT INTO public.recipe_workflow_imports_v1(client_id,workflow_id,execution_id,recipe_index,source_recipe,source_fingerprint) VALUES ('wf-test-alpha','wf1','124',0,'{"title":"No tenant"}','fingerprint'); RAISE EXCEPTION 'FAIL missing source tenant'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO public.recipe_workflow_imports_v1(client_id,workflow_id,execution_id,recipe_index,source_recipe,source_fingerprint) VALUES ('wf-test-alpha','wf1','125',0,'{"client_id":"wf-test-beta"}','fingerprint'); RAISE EXCEPTION 'FAIL source tenant mismatch'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.recipe_workflow_imports_v1 SET source_recipe='{}'; RAISE EXCEPTION 'FAIL source mutation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.recipe_workflow_imports_v1; RAISE EXCEPTION 'FAIL source deletion'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.recipe_workflow_imports_v1) THEN RAISE EXCEPTION 'FAIL cross-kitchen read'; END IF;
 BEGIN INSERT INTO public.recipe_workflow_imports_v1(client_id,workflow_id,execution_id,recipe_index,source_recipe,source_fingerprint) VALUES ('wf-test-alpha','wf1','126',0,'{"client_id":"wf-test-alpha"}','fingerprint'); RAISE EXCEPTION 'FAIL cross-kitchen insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM * FROM public.recipe_workflow_imports_v1; RAISE EXCEPTION 'FAIL anonymous source read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Workflow source immutability, tenant matching, isolation and anonymous denial passed' AS verification;
