-- 010_seed_method_templates.sql

-- Insert baseline method templates for the Instruction Normalizer
INSERT INTO public.chef_method_templates (dish_style, cuisine, template_name, method_steps, description)
VALUES 
(
    'stir_fried', 
    'Asian', 
    'Standard Wok Stir Fry', 
    '[
        "Prepare mise en place: Ensure all ingredients are chopped uniformly and sauces are mixed before igniting the wok.",
        "Heat the wok until lightly smoking. Add oil and swirl to coat the surface.",
        "Aromatize the oil by briefly stir-frying [AROMATICS] until fragrant (about 15-30 seconds).",
        "Add [PROTEIN] and stir-fry briskly over high heat until browned and mostly cooked through. Remove from wok if necessary to prevent overcooking.",
        "Add [VEGETABLE] to the wok and stir-fry until crisp-tender.",
        "Return the [PROTEIN] to the wok. Pour the [SAUCE] around the edges of the wok so it sizzles and caramelizes.",
        "Toss everything together rapidly for 30-60 seconds until the sauce thickens and coats the ingredients evenly.",
        "Garnish with [GARNISH] and serve immediately to preserve the ''wok hei''."
    ]'::jsonb,
    'High-heat, rapid cooking method requiring all ingredients to be prepped in advance.'
),
(
    'stewed', 
    'Global', 
    'Standard Braise / Stew', 
    '[
        "Heat a heavy-bottomed pot or Dutch oven over medium-high heat. Add a small amount of oil.",
        "Season the [PROTEIN] generously and sear on all sides until deep brown. Remove and set aside.",
        "Reduce heat to medium. Add [AROMATICS] and sweat until softened.",
        "Stir in [SPICES] and [PASTE] and cook for 1-2 minutes until fragrant and slightly darkened.",
        "Deglaze the pan with [LIQUID], scraping up any browned bits from the bottom.",
        "Return the [PROTEIN] to the pot along with the remaining [LIQUID]. Bring to a gentle simmer.",
        "Add [VEGETABLE_FIRM]. Cover, reduce heat to low, and simmer gently until the protein is fork-tender.",
        "Stir in [VEGETABLE_SOFT] and [SAUCE_FINISH] during the last 15-20 minutes of cooking.",
        "Adjust seasoning with [SEASONING] before serving."
    ]'::jsonb,
    'Low and slow cooking method in liquid, ideal for breaking down tougher cuts of meat and developing deep flavors.'
),
(
    'raw', 
    'Global', 
    'Standard Salad / Cold Prep', 
    '[
        "Ensure all produce is thoroughly washed, dried, and chilled before beginning.",
        "In a large mixing bowl, prepare the base by combining [VEGETABLE_LEAFY] and [VEGETABLE].",
        "Prepare the dressing by whisking together [SAUCE] and [SEASONING].",
        "Add [PROTEIN_COLD] and [FRUIT_NUTS] to the bowl.",
        "Just before serving, drizzle the dressing over the ingredients. Toss gently but thoroughly to coat evenly.",
        "Transfer to an chilled serving plate and garnish with [GARNISH]."
    ]'::jsonb,
    'Cold preparation focusing on freshness, texture contrasts, and immediate service after dressing.'
),
(
    'roasted', 
    'Global', 
    'Standard Oven Roast', 
    '[
        "Preheat the oven to the specified temperature. Ensure racks are positioned correctly.",
        "In a large bowl, toss the [PROTEIN] and [VEGETABLE] with oil and [SEASONING] until evenly coated.",
        "Arrange the ingredients on a baking sheet in a single, even layer. Do not overcrowd.",
        "Roast in the preheated oven. Rotate the pan halfway through the cooking time for even browning.",
        "If using a sauce or glaze, brush the [SAUCE] over the ingredients during the last 10 minutes of roasting.",
        "Remove from the oven when the [PROTEIN] reaches the target internal temperature and vegetables are tender and caramelized.",
        "Allow the [PROTEIN] to rest for at least 5-10 minutes before slicing."
    ]'::jsonb,
    'Dry-heat cooking method that caramelizes exteriors while concentrating interior flavors.'
),
(
    'fried', 
    'Global', 
    'Standard Deep / Shallow Fry', 
    '[
        "Heat oil in a deep fryer or heavy pot to the target temperature (typically 170°C - 180°C).",
        "Prepare the dredging station: coat the [PROTEIN] or [VEGETABLE] in the [BATTER] or breading mixture.",
        "Carefully lower the coated ingredients into the hot oil. Fry in small batches to maintain oil temperature.",
        "Fry until golden brown and crisp, turning occasionally for even coloring.",
        "Use a spider or slotted spoon to remove the items from the oil. Transfer immediately to a wire rack set over a baking sheet.",
        "Season immediately with [SEASONING] while still hot so the seasoning adheres.",
        "Serve promptly or hold uncovered in a warm oven. Never cover fried items."
    ]'::jsonb,
    'High-heat oil cooking for a crisp exterior. Moisture control and immediate seasoning are critical.'
)
ON CONFLICT (dish_style) DO UPDATE 
SET method_steps = EXCLUDED.method_steps, 
    template_name = EXCLUDED.template_name,
    description = EXCLUDED.description;
