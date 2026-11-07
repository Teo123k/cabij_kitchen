-- Exact matching never promotes an unreviewed alias or a semantic guess.
CREATE FUNCTION public.ingredient_match_key_v1(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT lower(btrim(COALESCE(value,''))) $$;
CREATE TABLE public.kitchen_ingredient_aliases_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL,
  canonical_ingredient_id uuid NOT NULL REFERENCES public.canonical_ingredients_v1(id),
  alias text NOT NULL CHECK (btrim(alias)<>''), product_form text NOT NULL DEFAULT '',
  source_ref text NOT NULL CHECK (btrim(source_ref)<>''),
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review','approved','rejected')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz
);
CREATE UNIQUE INDEX kitchen_alias_approved_key ON public.kitchen_ingredient_aliases_v1(client_id,public.ingredient_match_key_v1(alias),public.ingredient_match_key_v1(product_form)) WHERE status='approved';
CREATE INDEX kitchen_alias_tenant ON public.kitchen_ingredient_aliases_v1(client_id);
CREATE INDEX kitchen_alias_canonical ON public.kitchen_ingredient_aliases_v1(canonical_ingredient_id);
CREATE INDEX kitchen_alias_creator ON public.kitchen_ingredient_aliases_v1(created_by);
CREATE INDEX kitchen_alias_reviewer ON public.kitchen_ingredient_aliases_v1(reviewed_by);
ALTER TABLE public.kitchen_ingredient_aliases_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_ingredient_aliases_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.kitchen_ingredient_aliases_v1 TO authenticated;
GRANT UPDATE(status) ON public.kitchen_ingredient_aliases_v1 TO authenticated;
CREATE POLICY kitchen_alias_read ON public.kitchen_ingredient_aliases_v1 FOR SELECT TO authenticated
USING(EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=kitchen_ingredient_aliases_v1.client_id AND m.user_id=(select auth.uid())));
CREATE POLICY kitchen_alias_create ON public.kitchen_ingredient_aliases_v1 FOR INSERT TO authenticated
WITH CHECK(status='review' AND created_by=(select auth.uid()) AND reviewed_by IS NULL AND reviewed_at IS NULL AND EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=kitchen_ingredient_aliases_v1.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','manager','chef')));
CREATE POLICY kitchen_alias_review ON public.kitchen_ingredient_aliases_v1 FOR UPDATE TO authenticated
USING(EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=kitchen_ingredient_aliases_v1.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','manager')))
WITH CHECK(EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=kitchen_ingredient_aliases_v1.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','manager')));
CREATE FUNCTION public.guard_kitchen_alias_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Alias evidence is retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'review' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'Aliases must begin in review'; END IF;
    NEW.created_by:=auth.uid(); RETURN NEW;
  END IF;
  IF OLD.status<>'review' OR NEW.status NOT IN ('approved','rejected') OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at'])
     OR NOT EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=OLD.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('manager','owner')) THEN RAISE EXCEPTION 'Manager review is required; reviewed aliases are immutable'; END IF;
  NEW.reviewed_by:=auth.uid(); NEW.reviewed_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER kitchen_alias_guard BEFORE INSERT OR UPDATE OR DELETE ON public.kitchen_ingredient_aliases_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_kitchen_alias_v1();
CREATE FUNCTION public.guard_global_alias_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.approved_at IS NOT NULL OR OLD.approved_by IS NOT NULL THEN RAISE EXCEPTION 'Approved global aliases are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER global_alias_guard BEFORE UPDATE OR DELETE ON public.canonical_ingredient_aliases_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_global_alias_v1();

CREATE FUNCTION public.resolve_ingredient_identity_v1(p_client_id text,p_canonical_id text,p_source_name text,p_product_form text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE matches jsonb; chosen jsonb; total integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=p_client_id AND m.user_id=(select auth.uid())) THEN RAISE EXCEPTION 'Kitchen membership is required' USING ERRCODE='42501'; END IF;
  IF COALESCE(btrim(p_canonical_id),'')<>'' THEN
    SELECT jsonb_build_object('kind','canonical_id','canonical_ingredient_id',c.id,'canonical_id',c.canonical_id,'canonical_name',c.canonical_name) INTO chosen FROM public.canonical_ingredients_v1 c WHERE c.canonical_id=btrim(p_canonical_id);
  ELSE
    SELECT jsonb_agg(x),count(DISTINCT x->>'canonical_id') INTO matches,total FROM (
      SELECT jsonb_build_object('kind','canonical_name','canonical_ingredient_id',c.id,'canonical_id',c.canonical_id,'canonical_name',c.canonical_name) x FROM public.canonical_ingredients_v1 c WHERE public.ingredient_match_key_v1(c.canonical_name)=public.ingredient_match_key_v1(p_source_name)
      UNION ALL
      SELECT jsonb_build_object('kind','approved_alias','alias_scope','global','alias_id',a.id,'reviewed_by',a.approved_by,'reviewed_at',a.approved_at,'canonical_ingredient_id',c.id,'canonical_id',c.canonical_id,'canonical_name',c.canonical_name) FROM public.canonical_ingredient_aliases_v1 a JOIN public.canonical_ingredients_v1 c ON c.id=a.canonical_ingredient_id WHERE a.approved_by IS NOT NULL AND a.approved_at IS NOT NULL AND public.ingredient_match_key_v1(a.alias)=public.ingredient_match_key_v1(p_source_name) AND public.ingredient_match_key_v1(a.product_form)=public.ingredient_match_key_v1(p_product_form)
      UNION ALL
      SELECT jsonb_build_object('kind','approved_alias','alias_scope','kitchen','alias_id',a.id,'reviewed_by',a.reviewed_by,'reviewed_at',a.reviewed_at,'canonical_ingredient_id',c.id,'canonical_id',c.canonical_id,'canonical_name',c.canonical_name) FROM public.kitchen_ingredient_aliases_v1 a JOIN public.canonical_ingredients_v1 c ON c.id=a.canonical_ingredient_id WHERE a.client_id=p_client_id AND a.status='approved' AND a.reviewed_by IS NOT NULL AND a.reviewed_at IS NOT NULL AND public.ingredient_match_key_v1(a.alias)=public.ingredient_match_key_v1(p_source_name) AND public.ingredient_match_key_v1(a.product_form)=public.ingredient_match_key_v1(p_product_form)
    ) resolved;
    IF total=1 THEN SELECT value INTO chosen FROM jsonb_array_elements(matches) ORDER BY (value->>'kind'='canonical_name') DESC,(value->>'alias_scope'='kitchen') DESC,value->>'alias_id' LIMIT 1; END IF;
  END IF;
  IF chosen IS NULL THEN RETURN jsonb_build_object('status','INGREDIENT REVIEW REQUIRED','reason',CASE WHEN total>1 THEN 'Ambiguous exact name or alias' ELSE 'No exact canonical identity or approved alias for this product form' END); END IF;
  chosen:=chosen||jsonb_build_object('source_name',COALESCE(p_source_name,''),'input_canonical_id',COALESCE(btrim(p_canonical_id),''),'product_form',btrim(COALESCE(p_product_form,'')));
  RETURN jsonb_build_object('status','matched','canonical_id',chosen->>'canonical_id','canonical_name',chosen->>'canonical_name','canonical_match',chosen);
END $$;
REVOKE ALL ON FUNCTION public.resolve_ingredient_identity_v1(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_ingredient_identity_v1(text,text,text,text),public.ingredient_match_key_v1(text) TO authenticated;
CREATE FUNCTION public.guard_recipe_match_provenance_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ingredient jsonb; expected jsonb;
BEGIN
  FOR ingredient IN SELECT value FROM jsonb_array_elements(NEW.recipe_json->'ingredients') LOOP
    IF ingredient ? 'canonical_match' THEN
      expected:=public.resolve_ingredient_identity_v1(NEW.client_id,ingredient->'canonical_match'->>'input_canonical_id',ingredient->'canonical_match'->>'source_name',ingredient->>'product_form');
      IF expected->>'status' IS DISTINCT FROM 'matched' OR expected->'canonical_match' IS DISTINCT FROM ingredient->'canonical_match' OR expected->>'canonical_id' IS DISTINCT FROM ingredient->>'canonical_id' OR expected->>'canonical_name' IS DISTINCT FROM ingredient->>'canonical_name' THEN RAISE EXCEPTION 'Canonical match provenance must reference exact reviewed source evidence'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER recipe_match_provenance_guard BEFORE INSERT ON public.recipe_versions_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_recipe_match_provenance_v1();

ALTER TABLE public.ingredient_price_evidence_v1 ADD COLUMN product_form text NOT NULL DEFAULT '';
ALTER TABLE public.ingredient_price_evidence_v1 ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id);
ALTER TABLE public.ingredient_price_evidence_v1 ADD COLUMN source_document_id uuid;
ALTER TABLE public.ingredient_price_evidence_v1 ADD CONSTRAINT price_source_document_tenant FOREIGN KEY(source_document_id,client_id) REFERENCES public.recipe_documents_v1(id,client_id);
CREATE INDEX price_source_document ON public.ingredient_price_evidence_v1(source_document_id,client_id);
CREATE INDEX price_creator ON public.ingredient_price_evidence_v1(created_by);
CREATE INDEX price_tenant_reviewed ON public.ingredient_price_evidence_v1(client_id,match_status,canonical_ingredient_id,product_form,source_date);
GRANT UPDATE(match_status) ON public.ingredient_price_evidence_v1 TO authenticated;
CREATE POLICY price_manager_review ON public.ingredient_price_evidence_v1 FOR UPDATE TO authenticated
USING(EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=ingredient_price_evidence_v1.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','manager')))
WITH CHECK(EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=ingredient_price_evidence_v1.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('owner','manager')));
CREATE FUNCTION public.guard_price_evidence_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Price evidence is retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.match_status<>'review' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR btrim(NEW.supplier_name)='' OR btrim(NEW.source_document_ref)='' OR NEW.currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Complete price evidence must begin in review'; END IF;
    NEW.created_by:=auth.uid(); RETURN NEW;
  END IF;
  IF OLD.match_status<>'review' OR NEW.match_status NOT IN ('matched','rejected') OR (to_jsonb(NEW)-ARRAY['match_status','reviewed_by','reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['match_status','reviewed_by','reviewed_at'])
     OR NOT EXISTS(SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=OLD.client_id AND m.user_id=(select auth.uid()) AND m.role IN ('manager','owner')) THEN RAISE EXCEPTION 'Manager review is required; reviewed prices are immutable'; END IF;
  NEW.reviewed_by:=auth.uid(); NEW.reviewed_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER price_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ingredient_price_evidence_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_price_evidence_v1();
CREATE FUNCTION public.guard_calculation_price_provenance_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE price jsonb;
BEGIN
  IF NEW.snapshot->'calculationInputs'->>'pricingPolicy' IS DISTINCT FROM 'reviewed-evidence-v1' OR jsonb_typeof(NEW.snapshot->'calculationInputs'->'prices') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Reviewed price calculation inputs are required'; END IF;
  FOR price IN SELECT value FROM jsonb_array_elements(NEW.snapshot->'calculationInputs'->'prices') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.ingredient_price_evidence_v1 e WHERE e.id::text=price->>'evidenceId' AND e.client_id=NEW.client_id AND e.match_status='matched' AND e.reviewed_by IS NOT NULL AND e.reviewed_at IS NOT NULL AND to_jsonb(e)=price->'evidence') THEN RAISE EXCEPTION 'Calculation price evidence is not reviewed for this kitchen'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER calculation_price_provenance_guard BEFORE INSERT ON public.operations_calculation_runs_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_calculation_price_provenance_v1();
CREATE FUNCTION public.guard_package_price_policy_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.operations_calculation_runs_v1 r WHERE r.id=NEW.calculation_run_id AND r.client_id=NEW.client_id AND r.snapshot->'calculationInputs'->>'pricingPolicy'='reviewed-evidence-v1') THEN RAISE EXCEPTION 'Regenerate this project with reviewed price evidence before approval'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_price_policy_guard BEFORE INSERT ON public.operations_packages_v1 FOR EACH ROW EXECUTE FUNCTION public.guard_package_price_policy_v1();
GRANT SELECT ON public.ingredient_price_evidence_v1,public.canonical_ingredients_v1 TO service_role;
REVOKE ALL ON FUNCTION public.guard_kitchen_alias_v1(),public.guard_global_alias_v1(),public.guard_recipe_match_provenance_v1(),public.guard_price_evidence_v1(),public.guard_calculation_price_provenance_v1(),public.guard_package_price_policy_v1() FROM PUBLIC,anon,authenticated;
