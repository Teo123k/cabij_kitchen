import { jsPDF } from 'jspdf';
import { calculateYield, yieldLines } from './yield.js';
import { provenanceText } from './exportSource.js';
const text = value => String(value ?? '').replace(/[\u2010-\u2015]/g, '-').replace(/\u2192/g, 'to').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...').replace(/\u2022/g, '-');
const number = n => n !== '' && n != null && Number.isFinite(Number(n)) ? Number(Number(n).toFixed(3)) : 'not supplied';
export function standardRecipePdf(plan, recipeId = null, { fontData } = {}) {
  const records = recipeId ? plan.recipes.filter(r => r.id === recipeId) : plan.recipes;
  if (!records.length) throw new Error('Add an approved recipe to the menu before downloading recipe cards.');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  if (fontData) { pdf.addFileToVFS('NotoSansKR.ttf', fontData); pdf.addFont('NotoSansKR.ttf', 'Noto', 'normal'); pdf.addFont('NotoSansKR.ttf', 'Noto', 'bold'); }
  const family = fontData ? 'Noto' : 'helvetica';
  const margin = 17, width = 176, bottom = 276;
  let y = 18, title = '';
  const pageHeader = () => { pdf.setDrawColor(200, 210, 202); pdf.line(margin, 16, 193, 16); y = 23; };
  const nextPage = () => { pdf.addPage(); pageHeader(); };
  const line = (content, { size = 10, bold = false, indent = 0 } = {}) => {
    pdf.setFont(family, bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(24, 45, 35);
    for (const part of pdf.splitTextToSize(text(content), width - indent)) { if (y + size * 0.4 > bottom) { nextPage(); pdf.setFont(family, bold ? 'bold' : 'normal'); pdf.setFontSize(size); } pdf.text(part, margin + indent, y); y += size * 0.43 + 1; }
    y += 2;
  };
  const heading = content => { if (y > bottom - 20) nextPage(); y += 4; line(content, { size: 12, bold: true }); };
  const table = (headers, rows, widths) => {
    const drawRow = (row, isHeader = false) => {
      pdf.setFont(family, isHeader ? 'bold' : 'normal'); pdf.setFontSize(9);
      const cells = row.map((cell, i) => pdf.splitTextToSize(text(cell), widths[i] - 4));
      const height = Math.max(...cells.map(c => c.length)) * 4.2 + 5;
      if (height > bottom - 30) { row.forEach((cell, i) => line(`${headers[i]}: ${text(cell)}`)); return; }
      if (y + height > bottom) { nextPage(); if (!isHeader) drawRow(headers, true); pdf.setFont(family, isHeader ? 'bold' : 'normal'); pdf.setFontSize(9); }
      if (isHeader) { pdf.setFillColor(233, 239, 232); pdf.rect(margin, y - 3, width, height, 'F'); }
      let x = margin;
      cells.forEach((cell, i) => { pdf.text(cell, x + 2, y + 1); x += widths[i]; });
      pdf.setDrawColor(215, 223, 216); pdf.line(margin, y + height - 3, margin + width, y + height - 3); y += height;
    };
    drawRow(headers, true); rows.forEach(row => drawRow(row)); y += 3;
  };
  pageHeader();
  records.forEach((record, index) => {
    if (index) nextPage();
    const r = record.recipe_json;
    title = r.title;
    const target = plan.recipeTargets?.find(t => t.id === record.id) || { scale: 1, quantity: r.yield.quantity };
    const yieldReport = plan.yields?.find(t => t.versionId === record.id)?.report || calculateYield(r.yield_profile, target.scale, r.yield.unit === 'portion' ? target.quantity : null, plan.project.yieldActuals?.[record.id]);
    line(title, { size: 22, bold: true });
    line(`${plan.project.name} | service ${plan.project.serviceDate} ${plan.project.serviceTime} (${plan.project.timeZone || 'Europe/London'})`);
    line(plan.project.sample ? 'SYNTHETIC REHEARSAL - NOT FOR CLIENT DELIVERY' : plan.status === 'approved' ? `PACKAGE APPROVED ${plan.approvedAt}` : 'DRAFT - NOT APPROVED FOR DELIVERY', { bold: true });
    line(provenanceText(plan));
    line(`Recipe version: ${record.id} / v${record.version_number}`);
    line(`Source batch: ${number(r.yield.quantity)} ${r.yield.unit} (${r.yield.basis}). Event target: ${number(target.quantity)} ${r.yield.unit}. Scale: ${number(target.scale)}x.`);
    heading('Ingredients / source and planned quantities');
    table(['Ingredient / product form', 'Base', 'Event', 'Unit / state'], r.ingredients.map(i => [`${i.clean_name}${i.product_form ? ` / ${i.product_form}` : ''}${i.recipe_version_id ? ' (sub-recipe)' : ''}`, number(i.quantity), number(i.quantity === '' || i.quantity == null ? null : Number(i.quantity) * target.scale), `${i.unit} / ${i.prep_state || 'child recipe'}`]), [79, 24, 24, 49]);
    heading('Method & production sequence');
    if (r.method_text) line(r.method_text); 
    const method = r.production_steps || [];
    if (!method.length) line(r.method_text ? 'Production timings and roles require separate chef review.' : 'METHOD REVIEW REQUIRED');
    method.forEach((s, i) => { line(`${i + 1}. ${s.description}`, { bold: true }); line(`Role: ${s.role}. Active ${s.active} min; passive ${s.passive} min. Equipment: ${plan.project.equipment.find(e => e.id === s.equipmentId)?.name || (s.equipmentId ? 'See event equipment schedule' : 'none recorded')}.`, { indent: 4 }); });
    heading('Allergens, storage, handling & checkpoints');
    line(`Allergens: ${r.allergen_notes || 'REVIEW REQUIRED'}${r.allergen_reviewed ? ' (review recorded)' : ' (unverified)'}`);
    line(`Handling: ${r.handling_notes || 'REVIEW REQUIRED'}${r.handling_reviewed ? ' (review recorded)' : ' (unverified)'}`);
    heading('Evidence & approval');
    (r.source_evidence_ids || []).forEach(source => line(source));
    line(`Recipe status: ${record.status}; approver: ${record.approved_by || 'not recorded on this source record'}; approved at: ${record.approved_at || 'not recorded'}.`);
    nextPage(); heading(`Yield calculation / ${title}`);
    yieldLines(yieldReport).forEach(content => line(content));
    line('Recipe ingredients show usable demand in their recorded state. Purchasing conversion applies only the reviewed ingredient purchase-yield factor; do not apply the recipe yield percentage again.', { bold: true });
  });
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) { pdf.setPage(page); pdf.setTextColor(24, 55, 43); pdf.setFont(family, 'bold'); pdf.setFontSize(10); pdf.text('CABIJ / STANDARDISED RECIPE', margin, 13); pdf.setFont(family, 'normal'); pdf.setFontSize(8); pdf.setTextColor(90, 105, 96); pdf.text(`${text(plan.project.name).slice(0, 65)} | ${plan.status === 'approved' ? 'Approved snapshot' : 'Draft'} | ${page} / ${pdf.getNumberOfPages()}`, margin, 288); }
  return pdf;
}
let fontPromise;
export async function downloadRecipePdf(plan, recipeId = null) {
  fontPromise ||= fetch('/fonts/NotoSansKR.ttf').then(async response => {
    if (!response.ok) throw new Error('Could not load the recipe PDF font. Try again or use Print / save PDF.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  }).catch(error => { fontPromise = null; throw error; });
  standardRecipePdf(plan, recipeId, { fontData: await fontPromise }).save('cabij-standardised-recipes.pdf');
}
