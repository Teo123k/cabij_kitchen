-- 016_backfill_recipe_identity_columns.sql
-- One-time repair for recipe rows where canonical identity exists only inside JSON payloads.

UPDATE public.recipes
SET
  recipe_ref_id = COALESCE(
    NULLIF(recipe_ref_id, ''),
    NULLIF(structured_recipe->'recipe'->>'recipe_ref_id', ''),
    NULLIF(recipe_json->'recipe'->>'recipe_ref_id', ''),
    NULLIF(recipe_json->>'recipe_ref_id', ''),
    NULLIF(recipe_code, ''),
    id::text
  ),
  canonical_id = COALESCE(
    NULLIF(canonical_id, ''),
    NULLIF(structured_recipe->'recipe'->>'canonical_id', ''),
    NULLIF(recipe_json->'recipe'->>'canonical_id', ''),
    NULLIF(recipe_json->>'canonical_id', ''),
    NULLIF(recipe_code, ''),
    id::text
  ),
  recipe_code = COALESCE(
    NULLIF(recipe_code, ''),
    NULLIF(structured_recipe->'recipe'->>'recipe_code', ''),
    NULLIF(recipe_json->'recipe'->>'recipe_code', ''),
    NULLIF(recipe_json->>'recipe_code', '')
  )
WHERE
  recipe_ref_id IS NULL
  OR canonical_id IS NULL
  OR recipe_code IS NULL;
