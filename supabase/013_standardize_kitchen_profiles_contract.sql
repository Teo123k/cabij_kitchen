-- 013_standardize_kitchen_profiles_contract.sql
-- Phase A shared-settings anchor.
-- This migration is additive and does not reshape WF1 / WF2 / WF3 outputs.

ALTER TABLE public.kitchen_profiles
  ADD COLUMN IF NOT EXISTS service_style TEXT,
  ADD COLUMN IF NOT EXISTS kitchen_type TEXT,
  ADD COLUMN IF NOT EXISTS capacity_notes TEXT,
  ADD COLUMN IF NOT EXISTS supports_offline_media BOOLEAN;

UPDATE public.kitchen_profiles
SET
  service_style = COALESCE(
    NULLIF(service_style, ''),
    NULLIF(prep_rules->>'default_service_style', ''),
    NULLIF(prep_rules->>'service_style', ''),
    'daily_service'
  ),
  kitchen_type = COALESCE(
    NULLIF(kitchen_type, ''),
    NULLIF(prep_rules->>'kitchen_type', ''),
    'restaurant'
  ),
  capacity_notes = COALESCE(
    NULLIF(capacity_notes, ''),
    NULLIF(prep_rules->>'capacity_notes', '')
  ),
  supports_offline_media = COALESCE(
    CASE
      WHEN LOWER(COALESCE(prep_rules->>'supports_offline_media', '')) = 'true' THEN TRUE
      WHEN LOWER(COALESCE(prep_rules->>'supports_offline_media', '')) = 'false' THEN FALSE
      ELSE NULL
    END,
    supports_offline_media,
    FALSE
  );

ALTER TABLE public.kitchen_profiles
  ALTER COLUMN supports_offline_media SET DEFAULT FALSE;

UPDATE public.kitchen_profiles
SET supports_offline_media = FALSE
WHERE supports_offline_media IS NULL;

ALTER TABLE public.kitchen_profiles
  ALTER COLUMN supports_offline_media SET NOT NULL;

COMMENT ON TABLE public.kitchen_profiles IS
  'Shared client kitchen settings anchor. Frontend settings and later n8n enhancement reads should attach here without reshaping WF1/WF2/WF3 outputs.';

COMMENT ON COLUMN public.kitchen_profiles.equipment_inventory IS
  'JSONB array of equipment rows. Preferred shape: [{ "key": "fryer", "label": "Deep Fryer", "available": true, "qty": 2, "capacity_note": "2 x 18L", "station": "Fry Station", "note": "Optional free text" }].';

COMMENT ON COLUMN public.kitchen_profiles.portion_rules IS
  'JSONB kitchen-wide portion defaults only. Example keys: main_g, starter_g, side_g, sauce_g.';

COMMENT ON COLUMN public.kitchen_profiles.prep_rules IS
  'JSONB kitchen-wide prep context only. Example keys: large_scale_threshold_portions, default_service_style, supports_offline_media.';

COMMENT ON COLUMN public.kitchen_profiles.service_style IS
  'Optional plain-language service style summary for the kitchen profile. Example: daily_service, banquet, fast_casual.';

COMMENT ON COLUMN public.kitchen_profiles.kitchen_type IS
  'Optional kitchen type summary for the profile. Example: restaurant, volume, central_kitchen.';

COMMENT ON COLUMN public.kitchen_profiles.capacity_notes IS
  'Short free-text operational capacity note captured during onboarding or settings review.';

COMMENT ON COLUMN public.kitchen_profiles.supports_offline_media IS
  'Whether this client kitchen is expected to support selective offline SOP/training media later.';
