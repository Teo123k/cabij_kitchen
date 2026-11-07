\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), ('cccccccc-cccc-cccc-cccc-cccccccccccc');
INSERT INTO public.kitchen_memberships(user_id, client_id, role) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','alpha','manager'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','beta','manager'),
('cccccccc-cccc-cccc-cccc-cccccccccccc','alpha','chef');
INSERT INTO public.canonical_ingredients_v1 (canonical_id, canonical_name) VALUES ('c1','carrot');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
INSERT INTO public.recipe_versions_v1(client_id, recipe_ref_id, canonical_id, version_number, title, yield_quantity, yield_unit, yield_basis, recipe_json, content_fingerprint, created_by)
VALUES ('alpha','r1','canon1',1,'Test recipe',1,'kg','finished','{"client_id":"alpha","recipe_ref_id":"r1","canonical_id":"canon1","title":"Test recipe","yield":{"quantity":1,"unit":"kg","basis":"finished"},"ingredients":[{"canonical_id":"c1","canonical_name":"carrot","clean_name":"carrot","quantity":1,"unit":"kg"}]}','hash-1',auth.uid());
DO $$ BEGIN
  BEGIN
    INSERT INTO public.recipe_versions_v1(client_id, recipe_ref_id, canonical_id, version_number, title, status, yield_quantity, yield_unit, yield_basis, recipe_json, content_fingerprint, created_by)
    VALUES ('alpha','r2','canon2',1,'Bypass','approved',1,'kg','finished','{}','hash-2',auth.uid());
    RAISE EXCEPTION 'FAIL direct approved insertion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.recipe_versions_v1 SET status='review' WHERE recipe_ref_id='r1';
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);
DO $$ BEGIN
  BEGIN
    UPDATE public.recipe_versions_v1 SET status='approved' WHERE recipe_ref_id='r1';
    RAISE EXCEPTION 'FAIL chef approval';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'FAIL chef approval' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.recipe_versions_v1) <> 0 THEN RAISE EXCEPTION 'FAIL cross-client read'; END IF;
  UPDATE public.recipe_versions_v1 SET status='approved' WHERE recipe_ref_id='r1';
  IF FOUND THEN RAISE EXCEPTION 'FAIL cross-client update'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
UPDATE public.recipe_versions_v1 SET status='approved' WHERE recipe_ref_id='r1';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recipe_versions_v1 WHERE status='approved' AND approved_by=auth.uid() AND approved_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL manager approval'; END IF;
  BEGIN
    UPDATE public.recipe_versions_v1 SET title='Changed' WHERE recipe_ref_id='r1';
    RAISE EXCEPTION 'FAIL immutable recipe';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'FAIL immutable recipe' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT 'tenant and approval checks passed' AS result;
