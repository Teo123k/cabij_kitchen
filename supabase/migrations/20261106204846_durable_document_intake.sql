-- Small-volume private originals stay transactional with their provenance (8 MiB maximum).
CREATE SCHEMA IF NOT EXISTS cabij_private;
REVOKE ALL ON SCHEMA cabij_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA cabij_private TO service_role;
CREATE TABLE public.recipe_documents_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  extension text NOT NULL CHECK (extension IN ('pdf','docx','txt','md')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, sha256, extension),
  UNIQUE (id, client_id)
);
CREATE TABLE cabij_private.recipe_document_originals_v1 (
  document_id uuid PRIMARY KEY REFERENCES public.recipe_documents_v1(id),
  original_bytes bytea NOT NULL CHECK (octet_length(original_bytes) BETWEEN 1 AND 8388608)
);
CREATE TABLE public.recipe_document_candidates_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  client_id text NOT NULL,
  extractor_version text NOT NULL CHECK (length(extractor_version) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','extracted','incomplete','failed')),
  extracted_text text NOT NULL DEFAULT '' CHECK (length(extracted_text) <= 150000),
  source_recipe jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source_recipe) = 'object'),
  warnings jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(warnings) = 'array'),
  error text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (document_id, client_id) REFERENCES public.recipe_documents_v1(id, client_id),
  UNIQUE (document_id, extractor_version),
  UNIQUE (id, document_id, client_id)
);
ALTER TABLE public.recipe_documents_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_document_candidates_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabij_private.recipe_document_originals_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_documents_v1, public.recipe_document_candidates_v1, cabij_private.recipe_document_originals_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.recipe_documents_v1, public.recipe_document_candidates_v1 TO authenticated;
GRANT SELECT, INSERT ON public.recipe_documents_v1, public.recipe_document_candidates_v1, cabij_private.recipe_document_originals_v1 TO service_role;
GRANT UPDATE (status, extracted_text, source_recipe, warnings, error) ON public.recipe_document_candidates_v1 TO service_role;
CREATE POLICY document_member_read ON public.recipe_documents_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=recipe_documents_v1.client_id AND m.user_id=(select auth.uid())));
CREATE POLICY candidate_member_read ON public.recipe_document_candidates_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=recipe_document_candidates_v1.client_id AND m.user_id=(select auth.uid())));
CREATE INDEX document_creator ON public.recipe_documents_v1(created_by);
CREATE INDEX candidate_tenant_document ON public.recipe_document_candidates_v1(client_id, document_id);
CREATE INDEX candidate_creator ON public.recipe_document_candidates_v1(created_by);

CREATE FUNCTION public.guard_recipe_document_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Archived document evidence is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=NEW.client_id AND m.user_id=NEW.created_by AND m.role IN ('owner','manager','chef')) THEN
    RAISE EXCEPTION 'A chef or manager membership is required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recipe_document_guard BEFORE INSERT OR UPDATE OR DELETE ON public.recipe_documents_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_recipe_document_v1();
CREATE FUNCTION public.guard_recipe_document_original_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.recipe_documents_v1;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Original document bytes are immutable'; END IF;
  SELECT * INTO d FROM public.recipe_documents_v1 WHERE id=NEW.document_id;
  IF d.byte_length IS DISTINCT FROM octet_length(NEW.original_bytes)
    OR d.sha256 IS DISTINCT FROM encode(sha256(NEW.original_bytes),'hex') THEN RAISE EXCEPTION 'Document checksum or length mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recipe_document_original_guard BEFORE INSERT OR UPDATE OR DELETE ON cabij_private.recipe_document_originals_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_recipe_document_original_v1();
CREATE FUNCTION public.guard_recipe_document_candidate_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.recipe_documents_v1;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Extraction candidates are retained'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.source_recipe <> '{}'::jsonb OR NEW.extracted_text <> '' OR NEW.warnings <> '[]'::jsonb OR NEW.error IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Candidates must begin pending';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=NEW.client_id AND m.user_id=NEW.created_by AND m.role IN ('owner','manager','chef')) THEN RAISE EXCEPTION 'A chef or manager membership is required'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('extracted','incomplete','failed')
    OR (to_jsonb(NEW)-ARRAY['status','extracted_text','source_recipe','warnings','error','completed_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','extracted_text','source_recipe','warnings','error','completed_at']) THEN
    RAISE EXCEPTION 'Completed extraction evidence is immutable';
  END IF;
  SELECT * INTO d FROM public.recipe_documents_v1 WHERE id=NEW.document_id AND client_id=NEW.client_id;
  IF NEW.source_recipe->>'source_document_id' IS DISTINCT FROM d.id::text
    OR NEW.source_recipe->>'source_candidate_id' IS DISTINCT FROM NEW.id::text
    OR NEW.source_recipe->>'source_sha256' IS DISTINCT FROM d.sha256
    OR NEW.source_recipe->>'client_id' IS DISTINCT FROM NEW.client_id
    OR NEW.source_recipe->>'source_text' IS DISTINCT FROM NEW.extracted_text THEN
    RAISE EXCEPTION 'Candidate source evidence must match the archived document';
  END IF;
  IF NEW.status='failed' AND COALESCE(NEW.error,'')='' THEN RAISE EXCEPTION 'Failed extraction needs a reason'; END IF;
  NEW.completed_at := now(); RETURN NEW;
END $$;
CREATE TRIGGER recipe_document_candidate_guard BEFORE INSERT OR UPDATE OR DELETE ON public.recipe_document_candidates_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_recipe_document_candidate_v1();

-- These invoker functions are server APIs: no browser execute grant or definer bypass.
CREATE FUNCTION public.archive_recipe_document_v1(p_client_id text,p_filename text,p_extension text,p_content text,p_created_by uuid,p_extractor_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE bytes bytea; d public.recipe_documents_v1; c public.recipe_document_candidates_v1; duplicate boolean := false;
BEGIN
  IF length(p_content)>11184812 THEN RAISE EXCEPTION 'Choose a document no larger than 8 MiB'; END IF;
  bytes:=decode(p_content,'base64');
  INSERT INTO public.recipe_documents_v1(client_id,filename,extension,sha256,byte_length,created_by)
  VALUES (p_client_id,p_filename,p_extension,encode(sha256(bytes),'hex'),octet_length(bytes),p_created_by)
  ON CONFLICT (client_id,sha256,extension) DO NOTHING RETURNING * INTO d;
  IF d.id IS NULL THEN
    duplicate:=true;
    SELECT * INTO d FROM public.recipe_documents_v1 WHERE client_id=p_client_id AND sha256=encode(sha256(bytes),'hex') AND extension=p_extension;
  ELSE
    INSERT INTO cabij_private.recipe_document_originals_v1(document_id,original_bytes) VALUES(d.id,bytes);
  END IF;
  INSERT INTO public.recipe_document_candidates_v1(document_id,client_id,extractor_version,created_by)
  VALUES(d.id,d.client_id,p_extractor_version,p_created_by) ON CONFLICT (document_id,extractor_version) DO NOTHING;
  SELECT * INTO c FROM public.recipe_document_candidates_v1 WHERE document_id=d.id AND extractor_version=p_extractor_version;
  RETURN jsonb_build_object('document',to_jsonb(d),'candidate',to_jsonb(c),'duplicate',duplicate);
END $$;
CREATE FUNCTION public.read_recipe_document_original_v1(p_document_id uuid) RETURNS text
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT encode(original_bytes,'base64') FROM cabij_private.recipe_document_originals_v1 WHERE document_id=p_document_id
$$;
REVOKE ALL ON FUNCTION public.archive_recipe_document_v1(text,text,text,text,uuid,text), public.read_recipe_document_original_v1(uuid), public.guard_recipe_document_v1(), public.guard_recipe_document_original_v1(), public.guard_recipe_document_candidate_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_recipe_document_v1(text,text,text,text,uuid,text), public.read_recipe_document_original_v1(uuid) TO service_role;

ALTER TABLE public.recipe_versions_v1 ADD COLUMN source_document_id uuid;
ALTER TABLE public.recipe_versions_v1 ADD COLUMN source_candidate_id uuid;
ALTER TABLE public.recipe_versions_v1 ADD CONSTRAINT recipe_document_source_pair CHECK ((source_document_id IS NULL)=(source_candidate_id IS NULL));
ALTER TABLE public.recipe_versions_v1 ADD CONSTRAINT recipe_document_source_candidate FOREIGN KEY(source_candidate_id,source_document_id,client_id)
REFERENCES public.recipe_document_candidates_v1(id,document_id,client_id);
CREATE INDEX recipe_version_document_candidate ON public.recipe_versions_v1(source_candidate_id,source_document_id,client_id);
