\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
INSERT INTO public.operations_projects_v1(id,client_id,document) VALUES ('11111111-1111-1111-1111-111111111111','alpha','{"name":"Private client event"}');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_projects_v1(client_id,document) VALUES ('beta','{}');
    RAISE EXCEPTION 'FAIL cross-client insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.operations_projects_v1 SET revision=5 WHERE id='11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'FAIL revision bypass';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
UPDATE public.operations_projects_v1 SET revision=2 WHERE id='11111111-1111-1111-1111-111111111111' AND revision=1;
DO $$ BEGIN
  UPDATE public.operations_projects_v1 SET revision=2 WHERE id='11111111-1111-1111-1111-111111111111' AND revision=1;
  IF FOUND THEN RAISE EXCEPTION 'FAIL stale write'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.operations_projects_v1) THEN RAISE EXCEPTION 'FAIL project isolation'; END IF;
  UPDATE public.operations_projects_v1 SET revision=3 WHERE id='11111111-1111-1111-1111-111111111111';
  IF FOUND THEN RAISE EXCEPTION 'FAIL foreign update'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_packages_v1(project_id,client_id,project_revision,snapshot)
    SELECT '11111111-1111-1111-1111-111111111111','alpha',2,jsonb_build_object('clientId','alpha','ready',true,'status','approved','project','{"name":"Private client event"}'::jsonb,'recipes',jsonb_agg(to_jsonb(v))) FROM public.recipe_versions_v1 v WHERE status='approved';
    RAISE EXCEPTION 'FAIL chef package approval';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.operations_packages_v1(project_id,client_id,project_revision,snapshot) VALUES ('11111111-1111-1111-1111-111111111111','alpha',2,'{"clientId":"alpha","ready":true,"status":"approved","project":{"name":"Tampered"},"recipes":[]}');
    RAISE EXCEPTION 'FAIL altered source';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.operations_packages_v1(project_id,client_id,project_revision,snapshot) VALUES ('11111111-1111-1111-1111-111111111111','alpha',2,'{"clientId":"alpha","ready":true,"status":"approved","project":{"name":"Private client event"},"recipes":[{"id":"fake","recipe_json":{}}]}');
    RAISE EXCEPTION 'FAIL unapproved recipe';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
INSERT INTO public.operations_packages_v1(project_id,client_id,project_revision,snapshot)
SELECT '11111111-1111-1111-1111-111111111111','alpha',2,jsonb_build_object('clientId','alpha','ready',true,'status','approved','project','{"name":"Private client event"}'::jsonb,'recipes',jsonb_agg(to_jsonb(v))) FROM public.recipe_versions_v1 v WHERE status='approved';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.operations_packages_v1 WHERE approved_by=auth.uid()) THEN RAISE EXCEPTION 'FAIL manager approval'; END IF;
  BEGIN
    UPDATE public.operations_packages_v1 SET snapshot='{}';
    RAISE EXCEPTION 'FAIL package mutation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.operations_packages_v1;
    RAISE EXCEPTION 'FAIL package deletion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.operations_packages_v1) THEN RAISE EXCEPTION 'FAIL package isolation'; END IF; END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.operations_projects_v1; RAISE EXCEPTION 'FAIL anonymous read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'operations isolation, revision conflicts, manager approval and immutable packages passed' AS result;
