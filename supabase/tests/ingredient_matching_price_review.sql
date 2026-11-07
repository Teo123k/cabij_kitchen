\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES ('e0000000-0000-0000-0000-000000000001'),('e0000000-0000-0000-0000-000000000002'),('e0000000-0000-0000-0000-000000000003'),('e0000000-0000-0000-0000-000000000004');
INSERT INTO public.kitchen_memberships(user_id,client_id,role) VALUES
('e0000000-0000-0000-0000-000000000001','evidence-alpha','manager'),
('e0000000-0000-0000-0000-000000000002','evidence-alpha','chef'),
('e0000000-0000-0000-0000-000000000003','evidence-beta','manager'),
('e0000000-0000-0000-0000-000000000004','evidence-alpha','owner');
INSERT INTO public.canonical_ingredients_v1(id,canonical_id,canonical_name) VALUES
('c0000000-0000-0000-0000-000000000001','white-sesame-fixture','White roasted sesame seeds'),
('c0000000-0000-0000-0000-000000000002','ground-spice-fixture','Ground spice fixture');
INSERT INTO public.canonical_ingredient_aliases_v1(canonical_ingredient_id,alias,product_form,approved_by,approved_at) VALUES
('c0000000-0000-0000-0000-000000000001','global sesame','whole','e0000000-0000-0000-0000-000000000001',now()),
('c0000000-0000-0000-0000-000000000001','unreviewed sesame','whole',NULL,NULL);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
INSERT INTO public.kitchen_ingredient_aliases_v1(id,client_id,canonical_ingredient_id,alias,product_form,source_ref) VALUES
('a0000000-0000-0000-0000-000000000001','evidence-alpha','c0000000-0000-0000-0000-000000000001','white sesame','whole','Chef-reviewed source'),
('a0000000-0000-0000-0000-000000000002','evidence-alpha','c0000000-0000-0000-0000-000000000001','pending sesame','whole','Unreviewed source');
DO $$ BEGIN
  UPDATE public.kitchen_ingredient_aliases_v1 SET status='approved' WHERE id='a0000000-0000-0000-0000-000000000001';
  IF FOUND THEN RAISE EXCEPTION 'FAIL chef alias approval'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-alpha','','pending sesame','whole')->>'status' <> 'INGREDIENT REVIEW REQUIRED' THEN RAISE EXCEPTION 'FAIL pending alias matched'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-alpha','','unreviewed sesame','whole')->>'status' <> 'INGREDIENT REVIEW REQUIRED' THEN RAISE EXCEPTION 'FAIL unreviewed global alias matched'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);
UPDATE public.kitchen_ingredient_aliases_v1 SET status='approved' WHERE id='a0000000-0000-0000-0000-000000000001';
DO $$ DECLARE match jsonb; recipe jsonb; BEGIN
  match:=public.resolve_ingredient_identity_v1('evidence-alpha','',' WHITE SESAME ',' whole ');
  IF match->>'status'<>'matched' OR match->'canonical_match'->>'alias_scope'<>'kitchen' OR match->'canonical_match'->>'product_form'<>'whole' THEN RAISE EXCEPTION 'FAIL exact reviewed alias/form'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-alpha','white-sesame-fixture','Unrelated label','whole')->'canonical_match'->>'kind'<>'canonical_id' THEN RAISE EXCEPTION 'FAIL exact ID'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-alpha','unknown-id','White roasted sesame seeds','whole')->>'status'<>'INGREDIENT REVIEW REQUIRED' THEN RAISE EXCEPTION 'FAIL unknown ID fallback'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-alpha','','White roasted sesame seeds','whole')->'canonical_match'->>'kind'<>'canonical_name' THEN RAISE EXCEPTION 'FAIL exact canonical name'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-alpha','','global sesame','whole')->'canonical_match'->>'alias_scope'<>'global' THEN RAISE EXCEPTION 'FAIL reviewed global alias'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-alpha','','white sesame','ground')->>'status'<>'INGREDIENT REVIEW REQUIRED'
    OR public.resolve_ingredient_identity_v1('evidence-alpha','','white sesam','whole')->>'status'<>'INGREDIENT REVIEW REQUIRED' THEN RAISE EXCEPTION 'FAIL semantic or product form inference'; END IF;
  recipe:=jsonb_build_object('client_id','evidence-alpha','recipe_ref_id','matched-recipe','canonical_id','matched-recipe','title','Matched recipe','yield','{"quantity":1,"unit":"kg","basis":"finished"}'::jsonb,'ingredients',jsonb_build_array(jsonb_build_object('canonical_id',match->>'canonical_id','canonical_name',match->>'canonical_name','canonical_match',match->'canonical_match','clean_name','white sesame','quantity',1,'unit','kg','product_form','whole')));
  INSERT INTO public.recipe_versions_v1(client_id,recipe_ref_id,canonical_id,version_number,title,yield_quantity,yield_unit,yield_basis,recipe_json,content_fingerprint,created_by)
  VALUES('evidence-alpha','matched-recipe','matched-recipe',1,'Matched recipe',1,'kg','finished',recipe,'match-valid',auth.uid());
  BEGIN
    INSERT INTO public.recipe_versions_v1(client_id,recipe_ref_id,canonical_id,version_number,title,yield_quantity,yield_unit,yield_basis,recipe_json,content_fingerprint,created_by)
    VALUES('evidence-alpha','forged-recipe','forged-recipe',1,'Forged recipe',1,'kg','finished',jsonb_set(recipe,'{ingredients,0,canonical_match,alias_id}','"fake"'),'match-forged',auth.uid());
    RAISE EXCEPTION 'FAIL forged match provenance';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
INSERT INTO public.ingredient_price_evidence_v1(id,client_id,canonical_ingredient_id,product_form,supplier_name,source_document_ref,source_date,pack_quantity,pack_unit,pack_price,currency)
VALUES('b0000000-0000-0000-0000-000000000001','evidence-alpha','c0000000-0000-0000-0000-000000000001','whole','Fixture supplier','invoice:fixture','2026-11-05',2,'kg',12,'GBP');
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
  UPDATE public.ingredient_price_evidence_v1 SET match_status='matched' WHERE id='b0000000-0000-0000-0000-000000000001';
  IF FOUND THEN RAISE EXCEPTION 'FAIL chef price approval'; END IF;
  BEGIN
    INSERT INTO public.ingredient_price_evidence_v1(client_id,canonical_ingredient_id,supplier_name,source_document_ref,source_date,pack_quantity,pack_unit,pack_price,currency)
    VALUES('evidence-alpha','c0000000-0000-0000-0000-000000000001','Supplier','fixture','2026-11-05',1,'kg',1,'GBP');
    RAISE EXCEPTION 'FAIL chef price creation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);
UPDATE public.ingredient_price_evidence_v1 SET match_status='matched' WHERE id='b0000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.ingredient_price_evidence_v1 WHERE id='b0000000-0000-0000-0000-000000000001' AND reviewed_by=auth.uid() AND reviewed_at IS NOT NULL AND created_by=auth.uid()) THEN RAISE EXCEPTION 'FAIL manager price attribution'; END IF;
  BEGIN
    INSERT INTO public.ingredient_price_evidence_v1(client_id,canonical_ingredient_id,supplier_name,source_document_ref,source_date,pack_quantity,pack_unit,pack_price,currency,match_status,reviewed_by,reviewed_at)
    VALUES('evidence-alpha','c0000000-0000-0000-0000-000000000001','Supplier','fixture','2026-11-05',1,'kg',1,'GBP','matched',auth.uid(),now());
    RAISE EXCEPTION 'FAIL direct matched price insertion';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000004',true);
INSERT INTO public.ingredient_price_evidence_v1(id,client_id,canonical_ingredient_id,supplier_name,source_document_ref,source_date,pack_quantity,pack_unit,pack_price,currency)
VALUES('b0000000-0000-0000-0000-000000000002','evidence-alpha','c0000000-0000-0000-0000-000000000001','Supplier','explicit free fixture','2026-11-05',1,'kg',0,'GBP');
UPDATE public.ingredient_price_evidence_v1 SET match_status='matched' WHERE id='b0000000-0000-0000-0000-000000000002';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.ingredient_price_evidence_v1 WHERE id='b0000000-0000-0000-0000-000000000002' AND reviewed_by=auth.uid() AND pack_price=0) THEN RAISE EXCEPTION 'FAIL owner price review or explicit zero'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.kitchen_ingredient_aliases_v1 WHERE client_id='evidence-alpha') OR EXISTS(SELECT 1 FROM public.ingredient_price_evidence_v1 WHERE client_id='evidence-alpha') THEN RAISE EXCEPTION 'FAIL tenant alias/price read'; END IF;
  IF public.resolve_ingredient_identity_v1('evidence-beta','','white sesame','whole')->>'status'<>'INGREDIENT REVIEW REQUIRED' THEN RAISE EXCEPTION 'FAIL foreign alias promoted'; END IF;
  BEGIN PERFORM public.resolve_ingredient_identity_v1('evidence-alpha','','white sesame','whole'); RAISE EXCEPTION 'FAIL foreign resolver context'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN UPDATE public.kitchen_ingredient_aliases_v1 SET alias='Changed'; RAISE EXCEPTION 'FAIL reviewed alias rewrite'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.canonical_ingredient_aliases_v1 SET alias='Changed' WHERE approved_by IS NOT NULL; RAISE EXCEPTION 'FAIL global approved alias rewrite'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.ingredient_price_evidence_v1 SET pack_price=0; RAISE EXCEPTION 'FAIL reviewed price rewrite'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.ingredient_price_evidence_v1; RAISE EXCEPTION 'FAIL price deletion'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
-- Conflicting exact names remain unresolved instead of choosing one canonical identity.
INSERT INTO public.canonical_ingredient_aliases_v1(canonical_ingredient_id,alias,product_form,approved_by,approved_at) VALUES('c0000000-0000-0000-0000-000000000002','white sesame','whole','e0000000-0000-0000-0000-000000000001',now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN IF public.resolve_ingredient_identity_v1('evidence-alpha','','white sesame','whole')->>'status'<>'INGREDIENT REVIEW REQUIRED' THEN RAISE EXCEPTION 'FAIL ambiguous alias'; END IF; END $$;
INSERT INTO public.operations_projects_v1(id,client_id,document) VALUES('f0000000-0000-0000-0000-000000000001','evidence-alpha','{"name":"Evidence fixture"}');
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.operations_calculation_jobs_v1(id,client_id,project_id,project_revision,idempotency_key,requested_by) VALUES('f0000000-0000-0000-0000-000000000002','evidence-alpha','f0000000-0000-0000-0000-000000000001',1,'evidence-fixture','e0000000-0000-0000-0000-000000000001');
DO $$ DECLARE snapshot jsonb; price jsonb; BEGIN
  SELECT jsonb_build_object('evidenceId',e.id,'evidence',to_jsonb(e)) INTO price FROM public.ingredient_price_evidence_v1 e WHERE id='b0000000-0000-0000-0000-000000000001';
  snapshot:=jsonb_build_object('clientId','evidence-alpha','project','{"name":"Evidence fixture"}'::jsonb,'engineVersion',3,'ready',false,'recipes','[]'::jsonb);
  BEGIN
    INSERT INTO public.operations_calculation_runs_v1(job_id,client_id,project_id,project_revision,engine_version,snapshot) VALUES('f0000000-0000-0000-0000-000000000002','evidence-alpha','f0000000-0000-0000-0000-000000000001',1,'3',snapshot);
    RAISE EXCEPTION 'FAIL unpinned pricing policy';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  snapshot:=snapshot||jsonb_build_object('calculationInputs',jsonb_build_object('pricingPolicy','reviewed-evidence-v1','prices',jsonb_build_array(jsonb_set(price,'{evidence,pack_price}','0'))));
  BEGIN
    INSERT INTO public.operations_calculation_runs_v1(job_id,client_id,project_id,project_revision,engine_version,snapshot) VALUES('f0000000-0000-0000-0000-000000000002','evidence-alpha','f0000000-0000-0000-0000-000000000001',1,'3',snapshot);
    RAISE EXCEPTION 'FAIL forged price provenance';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  snapshot:=jsonb_set(snapshot,'{calculationInputs,prices}',jsonb_build_array(price));
  INSERT INTO public.operations_calculation_runs_v1(job_id,client_id,project_id,project_revision,engine_version,snapshot) VALUES('f0000000-0000-0000-0000-000000000002','evidence-alpha','f0000000-0000-0000-0000-000000000001',1,'3',snapshot);
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.resolve_ingredient_identity_v1('evidence-alpha','','white sesame','whole'); RAISE EXCEPTION 'FAIL anonymous resolver'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
ROLLBACK;
SELECT 'exact canonical/approved alias matching, form boundaries, review authority, tenant isolation and pinned price evidence passed' AS result;
