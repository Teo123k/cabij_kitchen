import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documentRecipe } from '../src/operations/documentRecipe.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'flatted';
import { createClient } from '@supabase/supabase-js';
import { executionRecipes, workflowRecipe } from '../src/operations/workflowRecipe.js';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('./readN8nRecipes.py', import.meta.url));
export async function localWorkflowResults(env, clientId, executionId) {
  if (!env.CABIJ_N8N_DB_PATH || !env.CABIJ_N8N_WORKFLOW_ID) throw new Error('The local n8n recipe connection is not configured.');
  if (executionId && !/^\d+$/.test(executionId)) throw new Error('Invalid n8n execution ID.');
  const { stdout } = await exec('python3', [script, env.CABIJ_N8N_DB_PATH, env.CABIJ_N8N_WORKFLOW_ID, ...(executionId ? [executionId] : [])], { timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  const stored = JSON.parse(stdout);
  const recipes = [];
  for (const execution of stored.executions) {
    let data; try { data = parse(execution.data); } catch { continue; }
    executionRecipes(data).forEach((source, recipeIndex) => {
      if (source.client_id !== clientId) return;
      recipes.push({ executionId: execution.id, recipeIndex, startedAt: execution.startedAt, executionStatus: execution.status, sourceRecipe: source });
    });
  }
  return { workflow: stored.workflow, recipes };
}
export function localN8nRecipePlugin(env) {
  return { name: 'cabij-local-n8n-recipes', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/local-n8n', async (req, res) => {
      const reply = (status, body) => { res.statusCode=status; res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body)); };
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) return reply(403,{error:'Use this integration from the local dashboard.'});
      try {
        const url = new URL(req.url,'http://localhost');
        const token = req.headers.authorization?.replace(/^Bearer /,'');
        if (!token || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return reply(401,{error:'Sign in to your kitchen first.'});
        const db=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
        const {data:{user},error:authError}=await db.auth.getUser(token);
        if(authError||!user) return reply(401,{error:'Sign in again before loading workflow results.'});
        let body = {};
        if(req.method==='POST') {
          if(req.headers.origin!==`http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return reply(403,{error:'Use the dashboard to import recipes.'});
          let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>(url.pathname==='/upload'?12000000:10000))return reply(413,{error:'Request too large.'});}body=JSON.parse(raw);
        }
        const clientId = req.method==='GET'?url.searchParams.get('clientId'):body.clientId;
        const {data:member}=await db.from('kitchen_memberships').select('role').eq('user_id',user.id).eq('client_id',clientId).maybeSingle();
        if(!['owner','manager','chef'].includes(member?.role))return reply(403,{error:'A chef or manager membership in this kitchen is required.'});
        if(req.method==='POST' && url.pathname==='/upload') {
          const filename=String(body.filename || '').slice(0,200);
          const ext=filename.split('.').pop().toLowerCase();
          if(!['pdf','docx','txt','md'].includes(ext))throw new Error('Upload a PDF, Word (.docx) or text file.');
          if(typeof body.content!=='string'||!body.content.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.content))throw new Error('Invalid document upload.');
          const bytes=Buffer.from(body.content,'base64');
          if(bytes.length>8*1024*1024)throw new Error('Choose a document smaller than 8 MB.');
          const dir=await mkdtemp(join(tmpdir(),'cabij-recipe-'));
          try {
            const path=join(dir,`source.${ext}`);await writeFile(path,bytes,{mode:0o600});
            const {stdout}=await exec('python3',[fileURLToPath(new URL('./extractRecipeDocument.py',import.meta.url)),path,ext],{timeout:25000,maxBuffer:2*1024*1024});
            return reply(200,{sourceRecipe:documentRecipe(stdout,filename)});
          } catch(error) {
            throw new Error(error.stderr?.includes('No readable text')?'No readable text found. Upload a text PDF or Word document; scanned PDFs need OCR.':'Could not extract this document. Use a text PDF, unencrypted .docx, or paste the recipe into a text file.');
          } finally {await rm(dir,{recursive:true,force:true});}
        }
        if(req.method==='GET' && url.pathname==='/recipes') return reply(200,await localWorkflowResults(env,clientId));
        if(req.method==='POST' && url.pathname==='/import') {
          const results=await localWorkflowResults(env,clientId,String(body.executionId));
          const item=results.recipes.find(r=>r.executionId===String(body.executionId)&&r.recipeIndex===body.recipeIndex);
          if(!item)throw new Error('This recipe result is not available for your kitchen.');
          workflowRecipe(item.sourceRecipe);
          const row={client_id:clientId,workflow_id:results.workflow.id,execution_id:item.executionId,recipe_index:item.recipeIndex,source_recipe:item.sourceRecipe,source_fingerprint:createHash('sha256').update(JSON.stringify(item.sourceRecipe)).digest('hex'),created_by:user.id};
          const result=await db.from('recipe_workflow_imports_v1').insert(row).select('*').single();
          if(!result.error)return reply(200,{record:result.data});
          if(result.error.code==='23505') {
            const prior=await db.from('recipe_workflow_imports_v1').select('*').eq('client_id',clientId).eq('workflow_id',row.workflow_id).eq('execution_id',row.execution_id).eq('recipe_index',row.recipe_index).single();
            if(prior.data?.source_fingerprint===row.source_fingerprint)return reply(200,{record:prior.data,duplicate:true});
            throw new Error('This saved run has changed. Existing source evidence has not been overwritten.');
          }
          throw new Error(result.error.message);
        }
        reply(404,{error:'Unknown workflow operation.'});
      }catch(error){reply(400,{error:error.message.startsWith('Command failed')?'The local n8n recipe store could not be read. Check the n8n connection.':error.message});}
    });
  } };
}
