import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsPDF } from 'jspdf';
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentRecipe, preparationSteps } from '../documentRecipe.js';
import { workflowRecipe } from '../workflowRecipe.js';
import { standardRecipePdf } from '../recipePdf.js';
test('document intake preserves explicit rows, precision and full method',()=>{
 const text='Chicken sauce\nYield: 10 portions\nIngredients\n0.500 kg Chicken\nSoy sauce  20 ml\nSalt to taste\nMethod\n1. Mix thoroughly.\n2. Chill before service.';
 const s=documentRecipe(text,'recipe.docx');
 assert.equal(s.title,'Chicken sauce');assert.deepEqual(s.yield,{quantity:10,unit:'portion',basis:'finished'});
 assert.equal(s.ingredients[0].quantity,'0.500');assert.equal(s.ingredients[1].name,'Soy sauce');
 assert.equal(s.ingredients[2].quantity,null);assert.equal(s.instructions_raw,'1. Mix thoroughly.\n2. Chill before service.');assert.equal(s.source_text,text);
});
test('ambiguous document stays provisional without invented ingredients, method or yield',()=>{
 const s=documentRecipe('Recipe title\nA narrative with unspecified quantities.','recipe.pdf');
 const draft=workflowRecipe(s).draft;
 assert.equal(draft.yield.quantity,'');assert.equal(draft.ingredients.length,0);assert.equal(draft.method_text,'');assert.ok(s.validation_flags.warnings.length);
});
test('unrecognised ranges are not collapsed into a single quantity',()=>{
 const s=documentRecipe('Sauce\nIngredients\n10–20 g Salt\nMethod\nStir.','recipe.txt');assert.equal(s.ingredients[0].quantity,null);
 const trailing=documentRecipe('Sauce\nIngredients\nSalt 10–20 g\nMethod\nStir.','recipe.txt');assert.equal(trailing.ingredients[0].quantity,null);
});
test('uploaded recipe PDF renders with missing yield remaining unknown',()=>{
 const draft=workflowRecipe(documentRecipe('Sauce\nIngredients\n20 ml Soy\nMethod\nStir.','source.pdf')).draft;
 const pdf=standardRecipePdf({project:{name:'Uploaded recipe',yieldActuals:{}},status:'draft',recipes:[{id:'source',recipe_json:draft,status:'draft',version_number:1}],recipeTargets:[{id:'source',scale:1,quantity:''}]});
 const dir=mkdtempSync(join(tmpdir(),'cabij-pdf-test-'));
 try {const file=join(dir,'recipe.pdf');writeFileSync(file,Buffer.from(pdf.output('arraybuffer')));const text=execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});assert.match(text,/Source batch: not supplied/);}finally{rmSync(dir,{recursive:true,force:true});}
 assert.ok(pdf.output().startsWith('%PDF-'));
});

test('real PDF and Word table extraction feed the same standardisation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cabij-extract-test-'));
 try {
  const doc=join(dir,'recipe.docx');
  execFileSync('python3',['-c',`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Sauce</w:t></w:r></w:p><w:p><w:r><w:t>Ingredients</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Soy sauce</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>20 ml</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Method</w:t></w:r></w:p><w:p><w:r><w:t>Stir thoroughly.</w:t></w:r></w:p></w:body></w:document>')`,doc]);
  const text=execFileSync('python3',['server/extractRecipeDocument.py',doc,'docx'],{encoding:'utf8'});
  const source=documentRecipe(text,'recipe.docx');assert.equal(source.ingredients[0].name,'Soy sauce');assert.equal(source.ingredients[0].quantity,'20');assert.equal(source.instructions_raw,'Stir thoroughly.');
  const pdf=new jsPDF();pdf.text(['Sauce','Yield: 10 portions','Ingredients','20 ml Soy sauce','Method','Stir thoroughly.'],20,20);
  const pdfPath=join(dir,'source.pdf');writeFileSync(pdfPath,Buffer.from(pdf.output('arraybuffer')));
  const pdfText=execFileSync('python3',['server/extractRecipeDocument.py',pdfPath,'pdf'],{encoding:'utf8'});
  const pdfSource=documentRecipe(pdfText,'source.pdf');assert.equal(pdfSource.ingredients[0].name,'Soy sauce');assert.equal(pdfSource.yield.quantity,10);assert.equal(pdfSource.instructions_raw,'Stir thoroughly.');

 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('uploaded method becomes editable prep steps without inventing timings or staff roles',()=>{
 const steps=preparationSteps('1. Mix thoroughly.\n2. Chill before service.');assert.equal(steps.length,2);assert.equal(steps[1].description,'2. Chill before service.');assert.ok(steps.every(s=>s.active===''&&s.passive===''&&s.role===''&&!s.reviewed));
});

test('simple recipes without headings are extracted with explicit review evidence',()=>{
 const s=documentRecipe('Sesame dressing\n20 ml soy sauce\n½ cup tahini\n1. Whisk together.\n2. Chill before service.','recipe.txt');
 assert.equal(s.ingredients.length,2);assert.equal(s.ingredients[0].quantity,'20');assert.equal(s.ingredients[1].quantity,'0.5');
 assert.equal(s.ingredients[1].unit,'cup');assert.equal(s.ingredients[1].needs_review,true);assert.equal(s.ingredients[0].section_basis,'inferred');
 assert.ok(s.standardisation.needs_review);assert.ok(s.standardisation.issues.some(i=>i.code==='SECTION_INFERRED'));assert.ok(s.standardisation.issues.some(i=>i.code==='UNIT_CONVERSION_REQUIRED'));
 assert.equal(s.standardisation.handling_prompts[0].line_number,5);assert.equal(s.allergen_candidates[0].allergen,'wheat/gluten');
});

test('fractions and yield forms are parsed while ambiguous yields stay unresolved',()=>{
 const s=documentRecipe('Soup\nYield: 1.5 kg\nIngredients\n1 1/2 kg potatoes\n1/3 kg onions\nMethod\nSimmer.','recipe.txt');
 assert.deepEqual(s.yield,{quantity:1.5,unit:'kg',basis:'finished'});assert.equal(s.ingredients[0].quantity,'1.5');assert.equal(s.ingredients[1].quantity,String(1/3));
 const ambiguous=documentRecipe('Soup\nServes 4–6\nIngredients\n20 g salt\nMethod\nStir.','recipe.txt');assert.equal(ambiguous.yield,undefined);assert.ok(ambiguous.standardisation.issues.some(i=>i.code==='YIELD_REQUIRES_REVIEW'));
});

test('table extraction rejoins adjacent ingredient names and amount-only cells',()=>{
 const s=documentRecipe('Sauce\nIngredients\nChicken\n1 kg\nSoy sauce\n20 ml\nMethod\nMix.','recipe.txt');
 assert.deepEqual(s.ingredients.map(row=>[row.name,row.quantity,row.unit]),[['Chicken','1','kg'],['Soy sauce','20','ml']]);
 assert.ok(s.ingredients.every(row=>row.needs_review));
});
