-- Additive audit history table for recipe change, approval, sync, and retraining tracking.
-- The app also mirrors the same trail inside recipe_json.recipe_profile_change_log for offline-safe reads.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.recipe_profile_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  recipe_ref_id TEXT NOT NULL,
  canonical_id TEXT,
  event_type TEXT NOT NULL,
  field_path TEXT,
  field_label TEXT,
  changed_by TEXT,
  change_reason TEXT,
  retraining_required BOOLEAN NOT NULL DEFAULT FALSE,
  retraining_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  queue_entry_id TEXT,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  synced_at TIMESTAMPTZ,
  synced_by TEXT,
  before_value JSONB,
  after_value JSONB,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipe_profile_audit_log_client
  ON public.recipe_profile_audit_log (client_id);

CREATE INDEX IF NOT EXISTS idx_recipe_profile_audit_log_recipe_ref
  ON public.recipe_profile_audit_log (recipe_ref_id);

CREATE INDEX IF NOT EXISTS idx_recipe_profile_audit_log_event_type
  ON public.recipe_profile_audit_log (event_type);

COMMENT ON TABLE public.recipe_profile_audit_log IS
  'Recipe history trail for queue saves, manager approvals, sync confirmation, and retraining follow-up. Frontend mirrors the same trail in recipe_json.recipe_profile_change_log for offline-first reads.';
