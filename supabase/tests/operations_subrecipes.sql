\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
INSERT INTO public.recipe_versions_v1(client_id,recipe_ref_id,canonical_id,version_number,title,yield_quantity,yield_unit,yield_basis,recipe_json,content_fingerprint,created_by)
SELECT 'alpha','parent','parent',1,'Parent',1,'kg','finished',jsonb_build_object('client_id','alpha','recipe_ref_id','parent','canonical_id','parent','title','Parent','yield','{"quantity":1,"unit":"kg","basis":"finished"}'::jsonb,'ingredients',jsonb_build_array(jsonb_build_object('recipe_version_id',id::text,'canonical_id',canonical_id,'canonical_name',title,'clean_name',title,'quantity',1,'unit','kg'))),'parent-fingerprint',auth.uid() FROM public.recipe_versions_v1 WHERE recipe_ref_id='r1';
UPDATE public.recipe_versions_v1 SET status='review' WHERE recipe_ref_id='parent';
UPDATE public.recipe_versions_v1 SET status='approved' WHERE recipe_ref_id='parent';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.recipe_versions_v1 WHERE recipe_ref_id='parent' AND status='approved') THEN RAISE EXCEPTION 'FAIL approved child reference'; END IF; END $$;
RESET ROLE;
INSERT INTO public.recipe_versions_v1(client_id,recipe_ref_id,canonical_id,version_number,title,yield_quantity,yield_unit,yield_basis,recipe_json,content_fingerprint,created_by)
SELECT 'beta','foreign-parent','foreign-parent',1,'Foreign parent',1,'kg','finished',jsonb_build_object('client_id','beta','recipe_ref_id','foreign-parent','canonical_id','foreign-parent','title','Foreign parent','yield','{"quantity":1,"unit":"kg","basis":"finished"}'::jsonb,'ingredients',jsonb_build_array(jsonb_build_object('recipe_version_id',id::text,'canonical_id',canonical_id,'canonical_name',title,'clean_name',title,'quantity',1,'unit','kg'))),'foreign-parent-fingerprint','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' FROM public.recipe_versions_v1 WHERE recipe_ref_id='r1';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
UPDATE public.recipe_versions_v1 SET status='review' WHERE recipe_ref_id='foreign-parent';
DO $$ BEGIN
  BEGIN UPDATE public.recipe_versions_v1 SET status='approved' WHERE recipe_ref_id='foreign-parent'; RAISE EXCEPTION 'FAIL cross-client subrecipe';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT 'approved subrecipe pinning and foreign-child rejection passed' AS result;
