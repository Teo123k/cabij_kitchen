\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES ('d0000000-0000-0000-0000-000000000001'),('d0000000-0000-0000-0000-000000000002'),('d0000000-0000-0000-0000-000000000003');
INSERT INTO public.kitchen_memberships(user_id,client_id,role) VALUES
('d0000000-0000-0000-0000-000000000001','document-alpha','chef'),
('d0000000-0000-0000-0000-000000000002','document-alpha','staff'),
('d0000000-0000-0000-0000-000000000003','document-beta','owner');
SET ROLE service_role;
DO $$ DECLARE receipt jsonb; repeated jsonb; d uuid; c uuid; bytes bytea:=convert_to('Sauce: unknown yield and quantities','UTF8'); BEGIN
  receipt:=public.archive_recipe_document_v1('document-alpha','source.txt','txt',encode(bytes,'base64'),'d0000000-0000-0000-0000-000000000001','python-document-v1');
  d:=(receipt->'document'->>'id')::uuid; c:=(receipt->'candidate'->>'id')::uuid;
  PERFORM set_config('test.document_id',d::text,true); PERFORM set_config('test.candidate_id',c::text,true);
  IF receipt->'document'->>'sha256' IS DISTINCT FROM encode(sha256(bytes),'hex')
     OR (receipt->'document'->>'byte_length')::integer <> octet_length(bytes)
     OR receipt->'document'->>'created_by' <> 'd0000000-0000-0000-0000-000000000001'
     OR receipt->'candidate'->>'status' <> 'pending'
     OR decode(public.read_recipe_document_original_v1(d),'base64') IS DISTINCT FROM bytes THEN RAISE EXCEPTION 'FAIL archive receipt, checksum, provenance or bytes'; END IF;
  repeated:=public.archive_recipe_document_v1('document-alpha','renamed.txt','txt',encode(bytes,'base64'),'d0000000-0000-0000-0000-000000000001','python-document-v1');
  IF repeated->>'duplicate' <> 'true' OR repeated->'document'->>'id' <> d::text OR repeated->'candidate'->>'id' <> c::text OR repeated->'document'->>'filename' <> 'source.txt' THEN RAISE EXCEPTION 'FAIL duplicate retention'; END IF;
  BEGIN
    UPDATE public.recipe_document_candidates_v1 SET status='incomplete',source_recipe='{"source_document_id":"forged"}' WHERE id=c;
    RAISE EXCEPTION 'FAIL forged candidate source';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  UPDATE public.recipe_document_candidates_v1 SET status='incomplete',extracted_text='unknown quantity',warnings='["Batch yield missing"]',
    source_recipe=jsonb_build_object('client_id','document-alpha','source_document_id',d,'source_candidate_id',c,'source_sha256',receipt->'document'->>'sha256','source_text','unknown quantity','ingredients','[{"quantity":null}]'::jsonb)
    WHERE id=c AND status='pending';
  IF NOT EXISTS(SELECT 1 FROM public.recipe_document_candidates_v1 WHERE id=c AND status='incomplete' AND completed_at IS NOT NULL AND source_recipe->'ingredients'->0->'quantity'='null'::jsonb) THEN RAISE EXCEPTION 'FAIL durable incomplete candidate'; END IF;
  BEGIN
    UPDATE public.recipe_document_candidates_v1 SET status='pending' WHERE id=c;
    RAISE EXCEPTION 'FAIL changed terminal extraction';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.archive_recipe_document_v1('document-alpha','staff.txt','txt',encode(bytes,'base64'),'d0000000-0000-0000-0000-000000000002','python-document-v1');
    RAISE EXCEPTION 'FAIL staff archive authority';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.archive_recipe_document_v1('document-beta','foreign.txt','txt',encode(bytes,'base64'),'d0000000-0000-0000-0000-000000000001','python-document-v1');
    RAISE EXCEPTION 'FAIL cross-kitchen uploader';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.archive_recipe_document_v1('document-alpha','large.txt','txt',encode(convert_to(repeat('x',8388609),'UTF8'),'base64'),'d0000000-0000-0000-0000-000000000001','python-document-v1');
    RAISE EXCEPTION 'FAIL archive size cap';
  EXCEPTION WHEN check_violation OR raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- Trigger protections also guard against accidental privileged changes.
DO $$ BEGIN
  BEGIN UPDATE cabij_private.recipe_document_originals_v1 SET original_bytes='changed'; RAISE EXCEPTION 'FAIL original rewrite';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM cabij_private.recipe_document_originals_v1; RAISE EXCEPTION 'FAIL original deletion';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.recipe_documents_v1 SET sha256=repeat('0',64); RAISE EXCEPTION 'FAIL checksum rewrite';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.recipe_documents_v1 WHERE id=current_setting('test.document_id')::uuid)
    OR NOT EXISTS(SELECT 1 FROM public.recipe_document_candidates_v1 WHERE id=current_setting('test.candidate_id')::uuid AND status='incomplete') THEN RAISE EXCEPTION 'FAIL member metadata/status'; END IF;
  BEGIN PERFORM * FROM cabij_private.recipe_document_originals_v1; RAISE EXCEPTION 'FAIL direct original access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.read_recipe_document_original_v1(current_setting('test.document_id')::uuid); RAISE EXCEPTION 'FAIL private reader execute';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.archive_recipe_document_v1('document-alpha','fake.txt','txt','YWJj',auth.uid(),'python-document-v1'); RAISE EXCEPTION 'FAIL direct browser archive';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.recipe_document_candidates_v1(document_id,client_id,extractor_version,created_by) VALUES(current_setting('test.document_id')::uuid,'document-alpha','browser',auth.uid()); RAISE EXCEPTION 'FAIL browser candidate';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.recipe_documents_v1 WHERE client_id='document-alpha') OR EXISTS(SELECT 1 FROM public.recipe_document_candidates_v1 WHERE client_id='document-alpha') THEN RAISE EXCEPTION 'FAIL cross-kitchen source read'; END IF;
  BEGIN
    INSERT INTO public.recipe_versions_v1(client_id,recipe_ref_id,canonical_id,version_number,title,yield_quantity,yield_unit,yield_basis,recipe_json,content_fingerprint,created_by,source_document_id,source_candidate_id)
    VALUES('document-beta','foreign-source','foreign-source',1,'Forbidden source',1,'kg','finished','{}','foreign-source',auth.uid(),current_setting('test.document_id')::uuid,current_setting('test.candidate_id')::uuid);
    RAISE EXCEPTION 'FAIL cross-kitchen recipe source linkage';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.recipe_documents_v1; RAISE EXCEPTION 'FAIL anonymous metadata'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.read_recipe_document_original_v1(current_setting('test.document_id')::uuid); RAISE EXCEPTION 'FAIL anonymous original'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'durable document bytes, checksum, provenance, incomplete extraction, immutability and tenant boundary passed' AS result;
