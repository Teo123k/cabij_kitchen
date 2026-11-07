-- 009_create_chef_knowledge_tables.sql

-- 1) chef_method_templates
-- Used for the "Standard Method Matrix" to provide missing instructions deterministically
CREATE TABLE IF NOT EXISTS public.chef_method_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_style TEXT NOT NULL UNIQUE,
    cuisine TEXT,
    template_name TEXT NOT NULL,
    method_steps JSONB NOT NULL, -- Array of strings with placeholders like [PROTEIN], [AROMATICS]
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) chef_task_templates
-- Holds the production rates for specific tasks (e.g. "slice onion", "6kg/hour")
CREATE TABLE IF NOT EXISTS public.chef_task_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL, -- e.g. 'PREP', 'COOK', 'FINISH'
    base_rate_kg_per_hour NUMERIC NOT NULL,
    default_equipment TEXT,
    skill_level TEXT DEFAULT 'commis',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) chef_cooking_rules
-- Holds overarching rules (e.g. "braise minimum 60 minutes", "chicken minimum internal temp 74C")
CREATE TABLE IF NOT EXISTS public.chef_cooking_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT NOT NULL UNIQUE,
    applies_to_category TEXT, -- e.g. 'protein', 'vegetable'
    applies_to_ingredient TEXT, -- optional specificity
    rule_type TEXT NOT NULL, -- e.g. 'duration_min', 'temp_min', 'temp_max'
    rule_value NUMERIC NOT NULL,
    unit TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4) kitchen_profiles
-- Represents physical limitations of a specific kitchen (equipment, staffing)
CREATE TABLE IF NOT EXISTS public.chef_kitchen_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_name TEXT NOT NULL UNIQUE,
    equipment_inventory JSONB DEFAULT '[]',
    staff_capacity JSONB DEFAULT '{}',
    scale_type TEXT NOT NULL, -- 'home', 'restaurant', 'volume', 'manufacturing'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5) learning_overrides
-- Captures human edits to override the deterministic engine in future runs
CREATE TABLE IF NOT EXISTS public.chef_learning_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    override_type TEXT NOT NULL, -- 'task_rate', 'method_step', 'recipe_duration'
    target_recipe_id TEXT, -- If specific to a recipe
    target_task_name TEXT, -- If specific to a task
    context_kitchen_id UUID REFERENCES public.chef_kitchen_profiles(id),
    original_value JSONB,
    new_value JSONB NOT NULL,
    approved_by UUID, -- references auth user who made edit
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6) knowledge_documents
-- Stores raw Markdown ingested from Telegram (PDFs, URLs, texts)
CREATE TABLE IF NOT EXISTS public.chef_knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    source_type TEXT NOT NULL, -- 'pdf', 'url', 'interview', 'text'
    source_reference TEXT,
    markdown_content TEXT NOT NULL,
    status TEXT DEFAULT 'pending_extraction',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7) knowledge_review_queue
-- Holds AI-extracted rules waiting for human approval before going to active tables
CREATE TABLE IF NOT EXISTS public.chef_knowledge_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_document_id UUID REFERENCES public.chef_knowledge_documents(id),
    target_table TEXT NOT NULL, -- 'chef_task_templates', 'chef_cooking_rules', etc
    proposed_payload JSONB NOT NULL,
    ai_confidence NUMERIC,
    status TEXT DEFAULT 'pending_review', -- 'pending_review', 'approved', 'rejected'
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8) generated_snapshots
-- (Optional) stores historical outputs of the engine for rollback/comparison
CREATE TABLE IF NOT EXISTS public.chef_generated_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id TEXT NOT NULL,
    schema_version TEXT,
    board_payload JSONB,
    presentation_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
