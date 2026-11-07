-- 012_seed_chef_intelligence_examples.sql
-- Minimal high-value seed rows so Workflow 2 has real retrieval context immediately.

INSERT INTO public.chef_operational_rules (
  rule_name,
  applies_to_recipe_type,
  applies_to_dish_style,
  applies_to_service_type,
  applies_to_scale_bucket,
  rule_category,
  rule_text,
  priority,
  confidence,
  source_type,
  source_reference
) VALUES
(
  'fried_large_scale_stagger_breading',
  'main_recipe',
  'fried',
  'daily_service',
  'large',
  'planning',
  'For fried items above 80 portions, stagger breading in waves. Do not bread the full batch too early or the crumb softens before service.',
  90,
  0.96,
  'chef_rulebook',
  'initial_seed'
),
(
  'banquet_sauce_day_before_base',
  'sauce_base',
  'slow_cooked',
  'banquet',
  'event',
  'planning',
  'For banquet sauces, cook the stable base the day before, chill safely, then reheat and finish the final seasoning near service.',
  85,
  0.93,
  'chef_rulebook',
  'initial_seed'
),
(
  'pickle_label_and_use_by',
  'component',
  'pickled',
  'daily_service',
  'regular',
  'safety',
  'All pickled or marinated cold components must be container-labeled with prep date, time, and use-by before storage.',
  88,
  0.95,
  'chef_rulebook',
  'initial_seed'
)
ON CONFLICT (rule_name) DO UPDATE
SET
  rule_text = EXCLUDED.rule_text,
  priority = EXCLUDED.priority,
  confidence = EXCLUDED.confidence,
  updated_at = NOW();

INSERT INTO public.chef_prep_patterns (
  pattern_name,
  recipe_type,
  dish_style,
  cuisine,
  service_type,
  scale_bucket,
  planning_template,
  execution_template
) VALUES
(
  'large_scale_fried_protein',
  'main_recipe',
  'fried',
  NULL,
  'daily_service',
  'large',
  '{
    "lead_time": "Morning",
    "make_ahead": "Same day only",
    "large_scale_threshold_portions": 80,
    "planning_blocks": ["protein trim", "wave breading", "fry near service"]
  }'::jsonb,
  '{
    "stations": ["Fryer Station"],
    "parallel_groups": ["protein_prep"],
    "critical_checks": [
      "Keep raw protein below 5C",
      "Refresh crumb between waves",
      "Rack fried items, do not stack"
    ]
  }'::jsonb
),
(
  'event_sauce_base',
  'sauce_base',
  'slow_cooked',
  NULL,
  'banquet',
  'event',
  '{
    "lead_time": "Day before",
    "make_ahead": "Day before ok",
    "large_scale_threshold_portions": 100,
    "planning_blocks": ["base cook", "rapid cooling", "reheat and finish"]
  }'::jsonb,
  '{
    "stations": ["Sauce Station"],
    "parallel_groups": ["base_cook"],
    "critical_checks": [
      "Do not reduce below target volume",
      "Cool in shallow pans",
      "Final seasoning at service reheat"
    ]
  }'::jsonb
)
ON CONFLICT (pattern_name) DO UPDATE
SET
  planning_template = EXCLUDED.planning_template,
  execution_template = EXCLUDED.execution_template,
  updated_at = NOW();

INSERT INTO public.chef_training_templates (
  template_name,
  recipe_type,
  dish_style,
  cuisine,
  training_outline,
  critical_mistakes,
  quality_checks,
  ccp_points
) VALUES
(
  'fried_protein_training',
  'main_recipe',
  'fried',
  NULL,
  '{
    "lesson_title": "Fried Protein Prep and Finish",
    "sections": [
      "mise en place",
      "breading setup",
      "batch timing",
      "frying control",
      "hold and pass"
    ]
  }'::jsonb,
  '["breading too early", "overloading fryer", "stacking hot fried product"]'::jsonb,
  '["even crumb coat", "golden color", "core temp reached"]'::jsonb,
  '["raw protein cold hold", "cook temperature check", "hot hold window"]'::jsonb
),
(
  'slow_cooked_sauce_training',
  'sauce_base',
  'slow_cooked',
  NULL,
  '{
    "lesson_title": "Slow Cooked Sauce Base",
    "sections": [
      "base build",
      "reduction control",
      "cooling",
      "reheat and finish"
    ]
  }'::jsonb,
  '["over-reduction", "unsafe cooling", "final seasoning too early"]'::jsonb,
  '["body and shine", "stable texture", "balanced seasoning"]'::jsonb,
  '["cooling in shallow pans", "safe reheat temperature"]'::jsonb
)
ON CONFLICT (template_name) DO UPDATE
SET
  training_outline = EXCLUDED.training_outline,
  critical_mistakes = EXCLUDED.critical_mistakes,
  quality_checks = EXCLUDED.quality_checks,
  ccp_points = EXCLUDED.ccp_points,
  updated_at = NOW();

INSERT INTO public.kitchen_profiles (
  kitchen_id,
  client_id,
  name,
  equipment_inventory,
  portion_rules,
  prep_rules,
  updated_by
) VALUES
(
  'main_kitchen_default',
  'cabij.co@gmail.com',
  'Main Kitchen',
  '[
    {"key":"fryer","label":"Deep Fryer","available":true,"qty":2,"capacity_note":"2 x 18L"},
    {"key":"stock_pot","label":"Stock Pot","available":true,"qty":4},
    {"key":"speed_rack","label":"Speed Rack","available":true,"qty":1}
  ]'::jsonb,
  '{
    "main_g": 280,
    "starter_g": 160,
    "sauce_g": 70
  }'::jsonb,
  '{
    "large_scale_threshold_portions": 100
  }'::jsonb,
  'initial_seed'
)
ON CONFLICT (kitchen_id) DO UPDATE
SET
  equipment_inventory = EXCLUDED.equipment_inventory,
  portion_rules = EXCLUDED.portion_rules,
  prep_rules = EXCLUDED.prep_rules,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();
