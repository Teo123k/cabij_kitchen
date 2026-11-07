import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { localN8nRecipePlugin } from '../../../server/n8nRecipeBridge.js';
const env={VITE_SUPABASE_URL:'https://upload-test.supabase.co',VITE_SUPABASE_ANON_KEY:'test-only-key'};
async function request({body, token='fixture', host='127.0.0.1:5174', origin='http://127.0.0.1:5174'}) {
 let middleware;
 localN8nRecipePlugin(env).configureServer({middlewares:{use:(_path,handler)=>{middleware=handler;}}});
 const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{url:'/upload',method:'POST',headers:{host,origin,'content-type':'application/json',authorization:token?`Bearer ${token}`:''},socket:{remoteAddress:'127.0.0.1'}});
 let result;const res={setHeader(){},end(body){result={status:this.statusCode,body:JSON.parse(body)};}};
 await middleware(req,res);return result;
}
test('upload authenticates membership and extracts a real document without n8n or Drive',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('/auth/v1/user')?{id:'test-user',aud:'authenticated',role:'authenticated'}:{client_id:'kitchen',role:'chef'}),{status:200,headers:{'Content-Type':'application/json'}});
 try {
  const response=await request({body:{clientId:'kitchen',filename:'recipe.txt',content:Buffer.from('Sauce\nIngredients\n20 ml Soy sauce\nMethod\nStir thoroughly.').toString('base64')}});
  assert.equal(response.status,200);assert.equal(response.body.sourceRecipe.ingredients[0].quantity,'20');assert.equal(response.body.sourceRecipe.instructions_raw,'Stir thoroughly.');
  assert.equal((await request({token:'',body:{}})).status,401);
  assert.equal((await request({origin:'http://evil.invalid',body:{}})).status,403);
  assert.equal((await request({body:{clientId:'kitchen',filename:'bad.exe',content:'YWJj'}})).status,400);
  globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('/auth/v1/user')?{id:'test-user'}:null),{status:200,headers:{'Content-Type':'application/json'}});
  assert.equal((await request({body:{clientId:'other',filename:'recipe.txt',content:'YWJj'}})).status,403);
 }finally{globalThis.fetch=previous;}
});
