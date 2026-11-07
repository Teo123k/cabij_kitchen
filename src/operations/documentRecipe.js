const fractionMap = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const unitMap = { kilograms: 'kg', kilogram: 'kg', kilos: 'kg', kilo: 'kg', grams: 'g', gram: 'g', litres: 'l', liters: 'l', litre: 'l', liter: 'l', millilitres: 'ml', milliliters: 'ml', millilitre: 'ml', milliliter: 'ml', pieces: 'each', piece: 'each', pcs: 'each', cups: 'cup', tablespoons: 'tbsp', tablespoon: 'tbsp', teaspoons: 'tsp', teaspoon: 'tsp' };
const allergenRules = [['milk', /\b(?:milk|cream|butter|cheese|yogurt|yoghurt|whey)\b/i], ['egg', /\b(?:egg|eggs|mayonnaise)\b/i], ['wheat/gluten', /\b(?:wheat|flour|bread|pasta|soy sauce)\b/i], ['soy', /\b(?:soy|soya|tofu|miso|tamari)\b/i], ['sesame', /\b(?:sesame|tahini)\b/i], ['peanut', /\bpeanut\b/i], ['tree nuts', /\b(?:almond|cashew|walnut|hazelnut|pistachio|nut)\b/i], ['fish', /\b(?:fish|anchovy|tuna|salmon)\b/i], ['shellfish', /\b(?:prawn|shrimp|crab|lobster|mussel)\b/i], ['mustard', /\bmustard\b/i], ['celery', /\bcelery\b/i]];
const header = line => line.match(/^(ingredients?|ingredient list|재료|method|preparation|instructions?|directions?|조리법|만드는 법)\s*:?\s*(.*)$/i);
const number = token => {
  const value = String(token || '').trim().replace(',', '.');
  if (/^\d+\s+\d+\/\d+$/.test(value)) { const [whole, fraction] = value.split(/\s+/); const [a, b] = fraction.split('/').map(Number); return Number(whole) + a / b; }
  if (/^\d+\/\d+$/.test(value)) { const [a, b] = value.split('/').map(Number); return b ? a / b : null; }
  if (fractionMap[value] !== undefined) return fractionMap[value];
  return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
};
const amount = line => {
  const cleaned = line.replace(/^[-•*☐]\s*/, '').trim();
  const ambiguous = /\d\s*(?:[-–—]|to)\s*\d|\d+\/\d+\s*(?:-|to)\s*\d+\/\d+/.test(cleaned);
  if (ambiguous) return { name: cleaned, quantity: null, unit: '', display_quantity_text: cleaned, amount_kind: 'range', quantity_confidence: 'review_required' };
  const unitPattern = '(kg|g|ml|l|each|pcs?|tbsp|tsp|cups?|kilograms?|grams?|lit(?:re|er)s?|millilit(?:re|er)s?|pieces?|tablespoons?|teaspoons?)';
  const tokenPattern = '(\\d+(?:[.,]\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\/\\d+|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])';
  const first = cleaned.match(new RegExp(`^${tokenPattern}\\s*${unitPattern}\\b\\s*[:–-]?\\s+(.+)$`, 'i'));
  const last = cleaned.match(new RegExp(`^(.+?)\\s*[:|\\t]?\\s+${tokenPattern}\\s*${unitPattern}\\s*$`, 'i'));
  const match = first || last;
  if (!match) {
    const quantityOnly = cleaned.match(new RegExp(`^${tokenPattern}\\s*${unitPattern}\\s*$`, 'i'));
    if (quantityOnly) {
      const rawQuantity = quantityOnly[1]; const rawUnit = quantityOnly[2]; const quantity = number(rawQuantity); const unit = unitMap[rawUnit.toLowerCase()] || rawUnit.toLowerCase();
      return { name: '', quantity: quantity === null ? null : /^\d+[.,]\d+$/.test(rawQuantity) ? rawQuantity.replace(',', '.') : String(quantity), unit, display_quantity_text: `${rawQuantity} ${rawUnit}`, amount_kind: 'missing_name', quantity_confidence: 'review_required', needs_review: true };
    }
    return { name: cleaned, quantity: null, unit: '', display_quantity_text: cleaned, amount_kind: 'missing', quantity_confidence: 'review_required' };
  }
  const quantity = number(first ? match[1] : match[2]);
  const rawQuantity = first ? match[1] : match[2];
  const rawUnit = first ? match[2] : match[3];
  const unit = unitMap[rawUnit.toLowerCase()] || rawUnit.toLowerCase();
  const name = first ? match[3] : match[1];
  const preservedQuantity = quantity === null ? null : /^\d+[.,]\d+$/.test(rawQuantity) ? rawQuantity.replace(',', '.') : String(quantity);
  const household = ['cup', 'tbsp', 'tsp'].includes(unit);
  return { name: name.trim(), quantity: preservedQuantity, unit, display_quantity_text: `${rawQuantity} ${rawUnit}`, amount_kind: 'explicit', quantity_confidence: quantity === null || household ? 'review_required' : 'explicit', needs_review: household };
};

const parseYieldLine = line => {
  const match = line.match(/^(?:yield|serves|portions|makes|produces|分량)\s*:?\s*(.+)$/i);
  if (!match) return null;
  const value = match[1].trim();
  if (/\b(?:about|approximately|approx\.?|around|up to)\b|\d\s*(?:[-–—]|to)\s*\d/i.test(value)) return { ambiguous: true, evidence: value };
  const quantityMatch = value.match(/^(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*(portions?|servings?|people|kg|g|ml|l|each|trays?|loaves?)?\s*$/i);
  if (!quantityMatch) return { ambiguous: true, evidence: value };
  const quantity = number(quantityMatch[1]);
  if (quantity === null) return { ambiguous: true, evidence: value };
  const rawUnit = (quantityMatch[2] || '').toLowerCase();
  const unit = unitMap[rawUnit] || (/^(kg|g|ml|l|each)$/.test(rawUnit) ? rawUnit : 'portion');
  return { quantity, unit, evidence: value };
};

// Keep source lines when their structure is uncertain rather than inventing recipe facts.
export function documentRecipe(text, filename) {
  if (!text?.trim()) throw new Error('This document has no readable recipe text.');
  const lines = text.split(/\r?\n/).map((s, index) => ({ text: s.trim(), lineNumber: index + 1 })).filter(row => row.text);
  const source = { title: '', ingredients: [], instructions_raw: '', original_file_url: filename, source_text: text, source_kind: 'document_upload', allergen_candidates: [], validation_flags: { instructions_generated: false, warnings: [], inferred_fields: [] }, standardisation: { parser_version: 'document-recipe-v2', title_evidence: null, yield_evidence: null, issues: [], unclassified_lines: [], handling_prompts: [] } };
  const methods = [], unclassified = [];
  let section = '';
  for (const row of lines) {
    const rawLine = row.text;
    const matchedHeader = header(rawLine);
    const line = matchedHeader ? matchedHeader[2].trim() : rawLine;
    if (matchedHeader && /^(ingredients?|ingredient list|재료)$/i.test(matchedHeader[1])) { section = 'ingredients'; if (!line) continue; }
    else if (matchedHeader && /^(method|preparation|instructions?|directions?|조리법|만드는 법)$/i.test(matchedHeader[1])) { section = 'method'; if (!line) continue; }
    const parsedYield = parseYieldLine(line);
    if (parsedYield) {
      source.standardisation.yield_evidence = { line_number: row.lineNumber, source_text: rawLine };
      if (parsedYield.ambiguous) { source.standardisation.issues.push({ code: 'YIELD_REQUIRES_REVIEW', line_number: row.lineNumber, source_text: rawLine }); source.validation_flags.warnings.push('Yield is ambiguous. Confirm the exact source batch yield before scaling.'); }
      else source.yield = { quantity: parsedYield.quantity, unit: parsedYield.unit, basis: 'finished' };
      continue;
    }
    if (!source.title) { source.title = line.replace(/^#+\s*/, '').replace(/^(?:recipe|title)\s*:\s*/i, ''); source.standardisation.title_evidence = { line_number: row.lineNumber, source_text: rawLine }; continue; }
    if (section === 'method') {
      methods.push(line);
      if (/\b(?:chill|cool|refrigerat|freeze|store|keep|serve cold|hot-hold|hold hot)\b/i.test(line)) source.standardisation.handling_prompts.push({ line_number: row.lineNumber, source_text: rawLine, prompt: 'Confirm storage, holding and service controls from the source procedure.' });
      continue;
    }
    if (section !== 'ingredients' && /^\d+[.)]\s+/.test(line)) {
      section = 'method';
      methods.push(line);
      if (/\b(?:chill|cool|refrigerat|freeze|store|keep|serve cold|hot-hold|hold hot)\b/i.test(line)) source.standardisation.handling_prompts.push({ line_number: row.lineNumber, source_text: rawLine, prompt: 'Confirm storage, holding and service controls from the source procedure.' });
      continue;
    }
    const parsed = amount(line);
    const looksLikeIngredient = section === 'ingredients' || parsed.quantity !== null || parsed.amount_kind === 'range' || /^(?:[-•*]\s*)/.test(rawLine);
    if (looksLikeIngredient) {
      const inferred = section !== 'ingredients';
      const ingredient = { ...parsed, source_line: rawLine, source_line_number: row.lineNumber, section_basis: inferred ? 'inferred' : 'heading', needs_review: Boolean(parsed.needs_review || inferred || parsed.amount_kind === 'range' || parsed.quantity === null) };
      source.ingredients.push(ingredient);
      if (inferred) source.standardisation.issues.push({ code: 'SECTION_INFERRED', line_number: row.lineNumber, source_text: rawLine });
      if (parsed.amount_kind === 'range') source.standardisation.issues.push({ code: 'RANGE_REQUIRES_REVIEW', line_number: row.lineNumber, source_text: rawLine });
      if (parsed.needs_review) source.standardisation.issues.push({ code: 'UNIT_CONVERSION_REQUIRED', line_number: row.lineNumber, source_text: rawLine });
    } else if (section !== 'ingredients') { unclassified.push({ line_number: row.lineNumber, source_text: rawLine }); }
  }
  source.instructions_raw = methods.join('\n');
  // PDF table extraction can place the ingredient label and amount on adjacent lines.
  // Rejoin only those explicit quantity/name pairs; never infer a label from prose.
  for (let index = 0; index < source.ingredients.length; index += 1) {
    const row = source.ingredients[index];
    if (row.amount_kind !== 'missing_name') continue;
    const previous = source.ingredients[index - 1];
    const next = source.ingredients[index + 1];
    if (previous && previous.amount_kind === 'missing' && previous.quantity === null) {
      previous.quantity = row.quantity; previous.unit = row.unit; previous.display_quantity_text = row.display_quantity_text; previous.amount_kind = 'explicit'; previous.quantity_confidence = 'explicit'; previous.needs_review = true; source.ingredients.splice(index, 1); index -= 1; continue;
    }
    if (next && next.amount_kind === 'missing' && next.quantity === null && next.name) {
      row.name = next.name; row.amount_kind = 'explicit'; row.quantity_confidence = 'explicit'; row.needs_review = true; source.ingredients.splice(index + 1, 1);
    }
  }
  for (const ingredient of source.ingredients) for (const [allergen, rule] of allergenRules) if (rule.test(ingredient.name)) source.allergen_candidates.push({ allergen, evidence: ingredient.name, source_line_number: ingredient.source_line_number, review_required: true });
  source.allergen_candidates = [...new Map(source.allergen_candidates.map(row => [`${row.allergen}:${row.evidence.toLowerCase()}`, row])).values()];
  source.standardisation.unclassified_lines = unclassified;
  if (unclassified.length) { source.standardisation.issues.push({ code: 'UNCLASSIFIED_SOURCE_TEXT', line_numbers: unclassified.map(row => row.line_number) }); source.validation_flags.warnings.push('Some source text could not be assigned to a recipe section. Review the original text below.'); }
  if (!source.ingredients.length || !methods.length) source.validation_flags.warnings.push('Some recipe structure was not recognised. Review ingredients and method against the original.');
  if (!source.yield) source.validation_flags.warnings.push('Batch yield was not recognised. Confirm it from the original document before scaling.');
  source.standardisation.needs_review = Boolean(source.standardisation.issues.length || !source.yield || !source.ingredients.length || !methods.length);
  source.standardisation.allergen_candidates = source.allergen_candidates;
  source.validation_flags.warnings.push('Document extraction is provisional. Check rows, quantities, allergens and method against the original before use.');
  return source;
}

export function preparationSteps(method) {
  const lines=String(method||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const marker=/^(?:\d+[.)]|[-•])\s+/;
  const descriptions=[];
  if(lines.some(line=>marker.test(line))) for(const line of lines){if(marker.test(line)||!descriptions.length)descriptions.push(line);else descriptions[descriptions.length-1]+='\n'+line;}
  else if(lines.length) descriptions.push(lines.join('\n'));
  return descriptions.map(description=>({description,role:'',active:'',passive:'',capacity:1,reviewed:false,timing_basis:'',timing_source:''}));
}
