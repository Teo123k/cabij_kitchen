import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { standardRecipePdf } from '../recipePdf.js';
import { sampleEvent } from '../fixtures/sample.js';
import { buildPlan } from '../engine.js';
test('standard recipe PDF contains cards and yield pages, with embedded Korean font', () => { const f = sampleEvent(); f.versions[0].recipe_json.title = '닭고기 / Chicken'; const p = buildPlan(f.project, f.versions, 'demo-kitchen'); const pdf = standardRecipePdf(p, null, { fontData: fs.readFileSync(new URL('../../../public/fonts/NotoSansKR.ttf', import.meta.url)).toString('base64') }); assert.equal(pdf.getNumberOfPages(), 2); assert.ok(pdf.output().startsWith('%PDF-')); assert.ok(pdf.output('arraybuffer').byteLength > 10000); });
test('recipe PDF refuses an empty menu instead of an empty document', () => { const f = sampleEvent(); f.project.menu = []; assert.throws(() => standardRecipePdf(buildPlan(f.project, f.versions, 'demo-kitchen')), /approved recipe/); });
