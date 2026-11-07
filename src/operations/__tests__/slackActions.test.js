import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createSlackActionHandler, verifySlackRequest, slackTaskBlocks } from '../../../server/slackActions.js';
import { sampleEvent } from '../fixtures/sample.js';
import { buildPlan, approvePlan } from '../engine.js';
const secret='fixture-secret', now=1794000000000, timestamp=String(now/1000);
function signed(payload) { const rawBody=Buffer.from(new URLSearchParams({payload:JSON.stringify(payload)}).toString()); return {rawBody,headers:{'x-slack-request-timestamp':timestamp,'x-slack-signature':`v0=${createHmac('sha256',secret).update(`v0:${timestamp}:`).update(rawBody).digest('hex')}`}}; }
const ref={clientId:'kitchen',projectId:'11111111-1111-1111-1111-111111111111',packageId:'22222222-2222-2222-2222-222222222222',revision:3,taskId:'task-1'};
const payload={type:'block_actions',team:{id:'T123'},user:{id:'U123'},actions:[{action_id:'cabij_task_complete_v1',action_ts:'123.123',value:JSON.stringify(ref)}]};
test('signed callbacks bind Slack identity, trusted task reference and completion status',async()=>{
 let received; const handler=createSlackActionHandler({secret,teamId:'T123',now:()=>now,applyAction:async a=>(received=a,{status:a.status})});
 const req=signed(payload); assert.equal(verifySlackRequest({...req.headers,timestamp,signature:req.headers['x-slack-signature'],secret,rawBody:req.rawBody,now}),true);
 assert.equal((await handler(req)).status,'completed'); assert.equal(received.slackUser,'U123'); assert.equal(received.packageId,ref.packageId);
 await assert.rejects(handler({...req,rawBody:Buffer.from('payload=bad')}),/signature/);
 await assert.rejects(createSlackActionHandler({secret,teamId:'T999',now:()=>now,applyAction:async()=>{}})(req),/action/);
 await assert.rejects(createSlackActionHandler({secret,teamId:'T123',now:()=>now+301000,applyAction:async()=>{}})(req),/signature/);
});
test('buttons carry stable task identity and reject samples',()=>{
 const f=sampleEvent(); f.project.reconciliations=[]; f.project.sample=false;
 const p=approvePlan(buildPlan(f.project,f.versions,'demo-kitchen'),{role:'manager',clientId:'demo-kitchen',id:'manager'});
 p.exportProvenance={calculationRunId:'run'};
 const records=[{plan:p,packageId:ref.packageId,projectId:ref.projectId,revision:3}];
 const blocks=slackTaskBlocks(records,{groupBy:'role'}); assert.ok(blocks.length); assert.deepEqual(JSON.parse(blocks[0].elements[0].value).packageId,ref.packageId);
 assert.equal(blocks[0].elements[0].action_id,'cabij_task_complete_v1');
 assert.deepEqual(slackTaskBlocks(records,{groupBy:'role'}),blocks);
 p.project.sample=true; assert.throws(()=>slackTaskBlocks(records,{groupBy:'role'}),/trusted/);
});
