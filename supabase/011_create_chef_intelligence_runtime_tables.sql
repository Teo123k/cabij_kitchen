-- 011_create_chef_intelligence_runtime_tables.sql
-- Additive schema for Workflow 2 and Workflow 3.
-- Workflow 1 remains the owner of public.recipes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Minimal additive linking columns for the current recipes table.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS recipe_ref_id TEXT,
  ADD COLUMN IF NOT EXISTS canonical_id TEXT,
  ADD COLUMN IF NOT EXISTS recipe_type TEXT,
  ADD COLUMN IF NOT EXISTS is_sub_recipe BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parent_recipe_refs JSONB DEFAULT '[]'::jsonb;

UPDATE public.recipes
SET
  recipe_ref_id = COALESCE(
    recipe_ref_id,
    NULLIF(structured_recipe->'recipe'->>'recipe_ref_id', ''),
    NULLIF(recipe_json->'recipe'->>'recipe_ref_id', ''),
    NULLIF(recipe_code, ''),
    id::text
  ),
  canonical_id = COALESCE(
    canonical_id,
    NULLIF(structured_recipe->'recipe'->>'canonical_id', ''),
    NULLIF(recipe_json->'recipe'->>'canonical_id', ''),
    NULLIF(recipe_code, ''),
    id::text
  )
WHERE recipe_ref_id IS NULL OR canonical_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_recipes_recipe_ref_id ON public.recipes(recipe_ref_id);
CREATE INDEX IF NOT EXISTS idx_recipes_canonical_id ON public.recipes(canonical_id);

-- Workflow 2 output: operational prep intelligence.
CREATE TABLE IF NOT EXISTS public.recipe_prep_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_ref_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  knowledge_source TEXT,
  knowledge_source_version TEXT,
  generated_by TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  regen_reason TEXT,
  prep_intelligence JSONB NOT NULL DEFAULT '{}'::jsonb,
  scale_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  regular_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  large_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage JSONB NOT NULL DEFAULT '{}'::jsonb,
  food_safety_ccp JSONB NOT NULL DEFAULT '[]'::jsonb,
  critical_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_finish JSONB NOT NULL DEFAULT '[]'::jsonb,
  training_outline JSONB NOT NULL DEFAULT '{}'::jsonb,
  training_key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  ui_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  manager_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  source_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (recipe_ref_id, client_id, profile_version)
);

CREATE INDEX IF NOT EXISTS idx_recipe_prep_profiles_recipe_ref
  ON public.recipe_prep_profiles (recipe_ref_id);

CREATE INDEX IF NOT EXISTS idx_recipe_prep_profiles_client
  ON public.recipe_prep_profiles (client_id);

-- App-facing site capability settings.
CREATE TABLE IF NOT EXISTS public.kitchen_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  equipment_inventory JSONB NOT NULL DEFAULT '[]'::jsonb,
  portion_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  prep_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kitchen_profiles_client
  ON public.kitchen_profiles (client_id);

-- Approved operational planning rules.
CREATE TABLE IF NOT EXISTS public.chef_operational_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL UNIQUE,
  applies_to_recipe_type TEXT,
  applies_to_dish_style TEXT,
  applies_to_cuisine TEXT,
  applies_to_service_type TEXT,
  applies_to_scale_bucket TEXT,
  rule_category TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  priority INTEGER DEFAULT 50,
  confidence NUMERIC DEFAULT 0.80,
  source_type TEXT,
  source_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reusable prep planning and execution patterns.
CREATE TABLE IF NOT EXISTS public.chef_prep_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_name TEXT NOT NULL UNIQUE,
  recipe_type TEXT,
  dish_style TEXT,
  cuisine TEXT,
  service_type TEXT,
  scale_bucket TEXT,
  planning_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reusable SOP training and CCP patterns.
CREATE TABLE IF NOT EXISTS public.chef_training_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL UNIQUE,
  recipe_type TEXT,
  dish_style TEXT,
  cuisine TEXT,
  training_outline JSONB NOT NULL DEFAULT '{}'::jsonb,
  critical_mistakes JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ccp_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw evidence captured from chefs, service notes, event plans, and SOP docs.
CREATE TABLE IF NOT EXISTS public.chef_source_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  raw_text TEXT,
  structured_notes JSONB DEFAULT '{}'::jsonb,
  kitchen_id TEXT,
  service_type TEXT,
  source_date DATE,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Links evidence to approved rule/template rows.
CREATE TABLE IF NOT EXISTS public.chef_rule_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES public.chef_source_evidence(id) ON DELETE CASCADE,
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  relevance_score NUMERIC DEFAULT 0.80,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow 3 output: optional enrichment layer.
CREATE TABLE IF NOT EXISTS public.recipe_extended_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_ref_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  extension_type TEXT NOT NULL,
  dependency_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  container_label_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  oversold_recovery JSONB NOT NULL DEFAULT '{}'::jsonb,
  kitchen_adaptation JSONB NOT NULL DEFAULT '{}'::jsonb,
  manager_review_reason TEXT,
  generated_by TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipe_extended_profiles_recipe_ref
  ON public.recipe_extended_profiles (recipe_ref_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_extended_profiles_recipe_client_extension
  ON public.recipe_extended_profiles (recipe_ref_id, client_id, extension_type);
