-- CABIJ Kitchen V1: immutable recipe truth, canonical ingredient identity, and price evidence.
-- Review in a Supabase staging project before applying. This script does not migrate existing
-- public.recipes rows; the importer must create a reviewed recipe version explicitly.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.kitchen_memberships (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'chef', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, client_id)
);

ALTER TABLE public.kitchen_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read their kitchen membership" ON public.kitchen_memberships;
CREATE POLICY "Members can read their kitchen membership"
ON public.kitchen_memberships FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.canonical_ingredients_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  ingredient_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.canonical_ingredient_aliases_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_ingredient_id UUID NOT NULL REFERENCES public.canonical_ingredients_v1(id) ON DELETE RESTRICT,
  alias TEXT NOT NULL,
  product_form TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  UNIQUE (alias, product_form)
);

ALTER TABLE public.canonical_ingredients_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_ingredient_aliases_v1 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read canonical ingredients"
ON public.canonical_ingredients_v1 FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read canonical ingredient aliases"
ON public.canonical_ingredient_aliases_v1 FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.recipe_versions_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  recipe_ref_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'retired')),
  yield_quantity NUMERIC NOT NULL CHECK (yield_quantity > 0),
  yield_unit TEXT NOT NULL CHECK (yield_unit IN ('g', 'kg', 'ml', 'l', 'each', 'pcs', 'portion')),
  yield_basis TEXT NOT NULL CHECK (yield_basis IN ('finished', 'raw', 'purchased')),
  recipe_json JSONB NOT NULL,
  source_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_fingerprint TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  UNIQUE (client_id, recipe_ref_id, version_number),
  UNIQUE (client_id, recipe_ref_id, content_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_recipe_versions_v1_client_recipe
  ON public.recipe_versions_v1 (client_id, recipe_ref_id, version_number DESC);

CREATE TABLE IF NOT EXISTS public.recipe_version_ingredients_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_version_id UUID NOT NULL REFERENCES public.recipe_versions_v1(id) ON DELETE CASCADE,
  canonical_ingredient_id UUID NOT NULL REFERENCES public.canonical_ingredients_v1(id) ON DELETE RESTRICT,
  source_name TEXT NOT NULL,
  product_form TEXT NOT NULL DEFAULT '',
  prep_state TEXT NOT NULL DEFAULT 'as_purchased',
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('g', 'kg', 'ml', 'l', 'each', 'pcs', 'portion')),
  supplier_sku TEXT,
  UNIQUE (recipe_version_id, canonical_ingredient_id, product_form, prep_state)
);

CREATE TABLE IF NOT EXISTS public.ingredient_price_evidence_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  canonical_ingredient_id UUID NOT NULL REFERENCES public.canonical_ingredients_v1(id) ON DELETE RESTRICT,
  supplier_name TEXT NOT NULL,
  supplier_sku TEXT,
  source_document_ref TEXT NOT NULL,
  source_date DATE NOT NULL,
  pack_quantity NUMERIC NOT NULL CHECK (pack_quantity > 0),
  pack_unit TEXT NOT NULL CHECK (pack_unit IN ('g', 'kg', 'ml', 'l', 'each', 'pcs', 'portion')),
  pack_price NUMERIC NOT NULL CHECK (pack_price >= 0),
  currency TEXT NOT NULL CHECK (char_length(currency) = 3),
  match_status TEXT NOT NULL DEFAULT 'review' CHECK (match_status IN ('review', 'matched', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recipe_versions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_version_ingredients_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_price_evidence_v1 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Kitchen members can read recipe versions"
ON public.recipe_versions_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id = (select auth.uid()) AND m.client_id = recipe_versions_v1.client_id));

CREATE POLICY "Managers can create recipe versions"
ON public.recipe_versions_v1 FOR INSERT TO authenticated
WITH CHECK (status = 'draft' AND created_by = (select auth.uid()) AND approved_by IS NULL AND approved_at IS NULL AND EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id = (select auth.uid()) AND m.client_id = recipe_versions_v1.client_id AND m.role IN ('owner', 'manager', 'chef')));

CREATE POLICY "Kitchen reviewers can transition recipe versions"
ON public.recipe_versions_v1 FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id = (select auth.uid()) AND m.client_id = recipe_versions_v1.client_id AND m.role IN ('owner', 'manager', 'chef')))
WITH CHECK (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id = (select auth.uid()) AND m.client_id = recipe_versions_v1.client_id AND m.role IN ('owner', 'manager', 'chef')));

-- All content is fixed on insert; review and approval only change status and actor fields.
CREATE OR REPLACE FUNCTION public.guard_recipe_version_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actor_role text;
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','approved_by','approved_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','approved_by','approved_at']) THEN
    RAISE EXCEPTION 'Recipe version content is immutable';
  END IF;
  SELECT m.role INTO actor_role FROM public.kitchen_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.client_id = OLD.client_id;
  IF OLD.status = 'draft' AND NEW.status = 'review' AND actor_role IN ('owner','manager','chef') THEN
    NEW.approved_by := NULL; NEW.approved_at := NULL;
  ELSIF OLD.status = 'review' AND NEW.status = 'approved' AND actor_role IN ('owner','manager') THEN
    IF jsonb_typeof(NEW.recipe_json->'ingredients') IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.recipe_json->'ingredients') = 0
       OR NEW.recipe_json->>'client_id' IS DISTINCT FROM NEW.client_id
       OR NEW.recipe_json->>'recipe_ref_id' IS DISTINCT FROM NEW.recipe_ref_id
       OR NEW.recipe_json->>'canonical_id' IS DISTINCT FROM NEW.canonical_id
       OR NEW.recipe_json->>'title' IS DISTINCT FROM NEW.title
       OR (NEW.recipe_json->'yield'->>'quantity')::numeric IS DISTINCT FROM NEW.yield_quantity
       OR NEW.recipe_json->'yield'->>'unit' IS DISTINCT FROM NEW.yield_unit
       OR NEW.recipe_json->'yield'->>'basis' IS DISTINCT FROM NEW.yield_basis
       OR COALESCE((NEW.recipe_json->>'manager_review_required')::boolean, false)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.recipe_json->'ingredients') i
                  WHERE COALESCE(i->>'canonical_id','') = '' OR COALESCE(i->>'canonical_name','') = ''
                     OR COALESCE(i->>'clean_name','') = ''
                     OR COALESCE((i->>'quantity')::numeric, 0) <= 0
                     OR COALESCE(i->>'unit','') NOT IN ('g','kg','ml','l','each','pcs','portion')
                     OR COALESCE((i->>'needs_review')::boolean, false)
                     OR NOT EXISTS (SELECT 1 FROM public.canonical_ingredients_v1 c
                                    WHERE c.canonical_id = i->>'canonical_id' AND c.canonical_name = i->>'canonical_name')) THEN
      RAISE EXCEPTION 'Recipe needs ingredient or manager review';
    END IF;
    NEW.approved_by := (select auth.uid()); NEW.approved_at := now();
  ELSE
    RAISE EXCEPTION 'Recipe status transition is not allowed';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_recipe_version_v1 ON public.recipe_versions_v1;
CREATE TRIGGER guard_recipe_version_v1 BEFORE UPDATE ON public.recipe_versions_v1
FOR EACH ROW EXECUTE FUNCTION public.guard_recipe_version_v1();

CREATE POLICY "Kitchen members can read version ingredients"
ON public.recipe_version_ingredients_v1 FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.recipe_versions_v1 r
  JOIN public.kitchen_memberships m ON m.client_id = r.client_id
  WHERE r.id = recipe_version_ingredients_v1.recipe_version_id
    AND m.user_id = (select auth.uid())
));

CREATE POLICY "Kitchen members can read price evidence"
ON public.ingredient_price_evidence_v1 FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id = (select auth.uid()) AND m.client_id = ingredient_price_evidence_v1.client_id));

CREATE POLICY "Managers can create price evidence"
ON public.ingredient_price_evidence_v1 FOR INSERT TO authenticated
WITH CHECK (match_status = 'review' AND reviewed_by IS NULL AND reviewed_at IS NULL AND EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id = (select auth.uid()) AND m.client_id = ingredient_price_evidence_v1.client_id AND m.role IN ('owner', 'manager')));

-- Approved recipes and matched prices are immutable evidence. Create a new version or price
-- row to correct them; do not rewrite history from the browser.
REVOKE ALL ON public.kitchen_memberships, public.canonical_ingredients_v1, public.canonical_ingredient_aliases_v1, public.recipe_versions_v1, public.recipe_version_ingredients_v1, public.ingredient_price_evidence_v1 FROM anon, authenticated;
GRANT SELECT ON public.kitchen_memberships, public.canonical_ingredients_v1, public.canonical_ingredient_aliases_v1, public.recipe_versions_v1, public.recipe_version_ingredients_v1, public.ingredient_price_evidence_v1 TO authenticated;
GRANT INSERT, UPDATE ON public.recipe_versions_v1 TO authenticated;
GRANT INSERT ON public.ingredient_price_evidence_v1 TO authenticated;
