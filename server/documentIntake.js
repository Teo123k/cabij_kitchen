import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseCalculationContext } from './trustedCalculation.js';
import { documentRecipe } from '../src/operations/documentRecipe.js';
const exec = promisify(execFile);
export const DOCUMENT_EXTRACTOR_VERSION = 'python-document-v1';
const checked = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fields = (input, allowed) => { if (!input || Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Supply document bytes or source identifiers only.'); };

export async function extractArchivedDocument(bytes, extension) {
  const dir = await mkdtemp(join(tmpdir(), 'cabij-archived-document-'));
  try {
    const path = join(dir, `source.${extension}`); await writeFile(path, bytes, { mode: 0o600 });
    const { stdout } = await exec('python3', [fileURLToPath(new URL('./extractRecipeDocument.py', import.meta.url)), path, extension], { timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
    return stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  } catch (error) {
    throw new Error(error.stderr?.includes('No readable text') ? 'No readable text found. Scanned PDFs need OCR or manual transcription.' : 'Deterministic extraction failed. Review the archived original; encrypted or malformed documents need manual correction.');
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export function durableDocumentIntake({ authenticate, writer, extract = extractArchivedDocument }) {
  async function context(input, roles = ['owner', 'manager', 'chef', 'staff']) {
    if (!input.token || !input.clientId) throw new Error('An authenticated kitchen session is required.');
    const { db, user } = await authenticate(input.token);
    if (!user?.id) throw new Error('Sign in again before uploading documents.');
    const member = checked(await db.from('kitchen_memberships').select('role').eq('client_id', input.clientId).eq('user_id', user.id).maybeSingle());
    if (!roles.includes(member?.role)) throw new Error('Kitchen membership with the required role is required.');
    return { db, user };
  }
  async function document(db, input) {
    const row = checked(await db.from('recipe_documents_v1').select('*').eq('client_id', input.clientId).eq('id', input.documentId).single());
    if (!row) throw new Error('Archived document is not accessible in this kitchen.'); return row;
  }
  async function original(row) {
    const content = checked(await writer.rpc('read_recipe_document_original_v1', { p_document_id: row.id }));
    if (!content) throw new Error('Archived original is unavailable.');
    const bytes = Buffer.from(content, 'base64');
    if (bytes.length !== row.byte_length || digest(bytes) !== row.sha256) throw new Error('Archived original failed its checksum verification.');
    return bytes;
  }
  return {
    async upload(input) {
      fields(input, ['token', 'clientId', 'filename', 'content']);
      const { db, user } = await context(input, ['owner', 'manager', 'chef']);
      const filename = input.filename;
      if (typeof filename !== 'string' || !filename.trim() || filename.length > 200 || [...filename].some(character => ['/', String.fromCharCode(92), String.fromCharCode(0), '\r', '\n'].includes(character))) throw new Error('Use a filename of up to 200 characters without a directory path.');
      const extension = filename.split('.').pop().toLowerCase();
      if (!['pdf', 'docx', 'txt', 'md'].includes(extension)) throw new Error('Upload a PDF, Word (.docx), UTF-8 text or Markdown file.');
      if (typeof input.content !== 'string' || !input.content.length || input.content.length > 11184812 || input.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.content)) throw new Error('Supply a valid base64 document no larger than 8 MiB.');
      const bytes = Buffer.from(input.content, 'base64');
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Choose a document no larger than 8 MiB.');
      if (extension === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('The file is not a PDF document.');
      if (extension === 'docx' && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('The file is not a Word (.docx) document.');
      const archived = checked(await writer.rpc('archive_recipe_document_v1', { p_client_id: input.clientId, p_filename: filename, p_extension: extension, p_content: input.content, p_created_by: user.id, p_extractor_version: DOCUMENT_EXTRACTOR_VERSION }));
      const row = archived.document; let candidate = archived.candidate;
      if (row.client_id !== input.clientId || row.sha256 !== digest(bytes) || row.byte_length !== bytes.length) throw new Error('Archived document receipt failed verification.');
      if (candidate.status !== 'pending') return { ...archived, sourceRecipe: candidate.source_recipe };
      // Resume from retained evidence after interruption, rather than trusting a fresh browser payload.
      const retained = await original(row);
      let text = '', error = null, source;
      try { text = await extract(retained, row.extension); source = documentRecipe(text, row.filename); }
      catch (failure) { error = failure.message; source = { title: '', ingredients: [], instructions_raw: '', source_kind: 'document_upload', source_text: text, validation_flags: { instructions_generated: false, warnings: [error] } }; }
      const complete = !error && !!source.title && source.ingredients.length > 0 && source.ingredients.every(i => i.quantity !== null && Number(i.quantity) > 0) && !!source.instructions_raw.trim() && Number(source.yield?.quantity) > 0;
      const warnings = [...source.validation_flags.warnings];
      if (!error && !complete) warnings.push('Extraction is incomplete. Missing quantities, batch yield or method must be completed from the archived original.');
      source = { ...source, client_id: row.client_id, original_file_url: `document:${row.id}`, original_filename: row.filename, source_document_id: row.id, source_candidate_id: candidate.id, source_sha256: row.sha256, source_text: text, source_evidence_ids: [`document:${row.id}#sha256:${row.sha256}`, `extraction:${candidate.id}`], source_meta: { filename: row.filename, byte_length: row.byte_length, extension: row.extension, extractor_version: DOCUMENT_EXTRACTOR_VERSION, uploaded_by: row.created_by, uploaded_at: row.created_at }, validation_flags: { ...source.validation_flags, warnings } };
      const changed = checked(await writer.from('recipe_document_candidates_v1').update({ status: error ? 'failed' : complete ? 'extracted' : 'incomplete', extracted_text: text, source_recipe: source, warnings, error }).eq('id', candidate.id).eq('client_id', input.clientId).eq('status', 'pending').select('*').maybeSingle());
      candidate = changed || checked(await db.from('recipe_document_candidates_v1').select('*').eq('client_id', input.clientId).eq('id', candidate.id).single());
      return { document: row, candidate, duplicate: archived.duplicate, sourceRecipe: candidate.source_recipe };
    },
    async status(input) {
      fields(input, ['token', 'clientId', 'documentId']); const { db } = await context(input);
      const row = await document(db, input);
      const candidates = checked(await db.from('recipe_document_candidates_v1').select('*').eq('client_id', input.clientId).eq('document_id', row.id).order('created_at', { ascending: false }));
      return { document: row, candidates };
    },
    async download(input) {
      fields(input, ['token', 'clientId', 'documentId']); const { db } = await context(input);
      const row = await document(db, input); const bytes = await original(row);
      return { document: row, content: bytes.toString('base64') };
    }
  };
}

export function localDocumentIntakePlugin(env, adapter) {
  let worker = adapter;
  return { name: 'cabij-local-document-intake', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/local-documents', async (req, res) => {
      const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) return reply(403, { error: 'Use the local dashboard for document intake.' });
      if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { error: 'Use a same-origin dashboard request.' });
      const token = req.headers.authorization?.replace(/^Bearer /, ''); if (!token) return reply(401, { error: 'Sign in before accessing documents.' });
      try {
        const operation = { '/upload': 'upload', '/draft': 'draft', '/status': 'status', '/download': 'download' }[req.url];
        if (!operation) return reply(404, { error: 'Unknown document operation.' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 12000000) return reply(413, { error: 'Request too large.' }); }
        const body = JSON.parse(raw); if (Object.hasOwn(body, 'token')) throw new Error('Use the authenticated request header.');
        if (operation === 'draft') {
          if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('Connected Supabase authentication is required for local draft extraction.');
          const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
          const { data: { user }, error: authError } = await db.auth.getUser(token);
          if (authError || !user) throw new Error('Sign in again before uploading documents.');
          const member = checked(await db.from('kitchen_memberships').select('role').eq('client_id', body.clientId).eq('user_id', user.id).maybeSingle());
          if (!['owner', 'manager', 'chef'].includes(member?.role)) throw new Error('Kitchen membership with the required role is required.');
          if (typeof body.filename !== 'string' || !body.filename.trim() || body.filename.length > 200 || [...body.filename].some(character => ['/', String.fromCharCode(92), String.fromCharCode(0), '\r', '\n'].includes(character))) throw new Error('Use a filename of up to 200 characters without a directory path.');
          const extension = body.filename.split('.').pop().toLowerCase();
          if (!['pdf', 'docx', 'txt', 'md'].includes(extension)) throw new Error('Upload a PDF, Word (.docx), UTF-8 text or Markdown file.');
          if (typeof body.content !== 'string' || !body.content.length || body.content.length > 11184812 || body.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) throw new Error('Supply a valid base64 document no larger than 8 MiB.');
          const bytes = Buffer.from(body.content, 'base64');
          if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Choose a document no larger than 8 MiB.');
          if (extension === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('The file is not a PDF document.');
          if (extension === 'docx' && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('The file is not a Word (.docx) document.');
          const text = await extractArchivedDocument(bytes, extension);
          const extracted = documentRecipe(text, body.filename);
          const sourceRecipe = { ...extracted, client_id: body.clientId, source_kind: 'local_draft_upload', original_filename: body.filename, source_evidence_ids: [`local-draft:${digest(bytes)}`], validation_flags: { ...extracted.validation_flags, warnings: [...extracted.validation_flags.warnings, 'Local draft only. Configure durable document intake before treating this source as retained evidence.'] } };
          return reply(200, { durable: false, sourceRecipe, candidate: { id: null, status: 'local_draft', source_recipe: sourceRecipe } });
        }
        if (!worker) {
          let url; try { url = new URL(env.CABIJ_DOCUMENT_SUPABASE_URL); } catch { /* Explicit local configuration is required. */ }
          if (!url || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !env.CABIJ_DOCUMENT_PUBLISHABLE_KEY || !env.CABIJ_DOCUMENT_WORKER_KEY) return reply(503, { error: 'Durable document intake is not configured. Configure a disposable local Supabase archive; hosted integration is pending.' });
          worker = durableDocumentIntake({ authenticate: supabaseCalculationContext(url.href, env.CABIJ_DOCUMENT_PUBLISHABLE_KEY), writer: createClient(url.href, env.CABIJ_DOCUMENT_WORKER_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) });
        }
        reply(200, await worker[operation]({ ...body, token }));
      } catch (error) { reply(400, { error: error.message }); }
    });
  } };
}
