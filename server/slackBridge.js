import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { scheduleMessages, scheduleOptions, slackArguments } from '../src/operations/slackSchedule.js';
import { exportSource } from '../src/operations/exportSource.js';
import { slackTaskBlocks, createSlackActionHandler } from './slackActions.js';
import { slackBindingAdmin } from './slackBindings.js';
import { supabaseCalculationContext } from './trustedCalculation.js';
const exec = promisify(execFile);
export async function composioTool(slug, data, account) {
  const args = ['execute', slug, '-d', JSON.stringify(data)];
  if (account) args.push('--account', account);
  const { stdout } = await exec('composio', args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (!result.successful || result.data?.ok === false) throw new Error(`Slack request failed: ${result.data?.error || result.error || 'connection unavailable'}`);
  return result.data;
}
export async function slackStatus(run) {
  const auth = await run('SLACK_TEST_AUTH', {});
  const channels = []; let cursor;
  do {
    const page = await run('SLACK_LIST_ALL_CHANNELS', { limit: 200, types: 'public_channel,private_channel', exclude_archived: true, ...(cursor ? { cursor } : {}) });
    channels.push(...(page.channels || []).filter(c => c.is_member && !c.is_archived).map(c => ({ id: c.id, name: c.name, private: !!c.is_private })));
    cursor = page.response_metadata?.next_cursor;
  } while (cursor);
  return { connected: true, workspace: auth.team, workspaceId: auth.team_id, channels: [...new Map(channels.map(c => [c.id, c])).values()] };
}
export function createSlackDelivery({ run, loadPackage, readJournal, writeJournal, interactiveEnabled = false, interactiveTeamId = '' }) {
  let locked = false;
  return async ({ packageId, packageIds, channelId, token, view, interactive = false }) => {
    if (locked) throw new Error('Another Slack delivery is in progress. Wait before sharing again.');
    locked = true;
    try {
      const ids=packageIds?.length?[...new Set(packageIds)].sort():[packageId];
      if(ids.length>31)throw new Error('Choose up to 31 approved packages.');
      const records=[];for(const id of ids)records.push(await loadPackage(id,token));
      if(new Set(records.map(r=>r.client_id)).size>1)throw new Error('Share packages from one kitchen at a time.');
      const options=scheduleOptions(view);
      if (records.some(r=>r.snapshot.project.sample)) throw new Error('Sample packages are preview-only and cannot be sent to Slack.');
      const taskRecords = records.map((r,i)=>({plan:r.snapshot,packageId:ids[i],projectId:r.project_id,revision:r.project_revision}));
      const text = scheduleMessages(taskRecords, options);
      if (interactive && !interactiveEnabled) throw new Error('Interactive Slack completion is not configured on this local server.');
      const args = slackArguments(channelId, text);
      if (interactive) { args.blocks.push(...slackTaskBlocks(taskRecords, options)); if (args.blocks.length > 50) throw new Error('Select fewer tasks for an interactive handoff.'); }
      const status = await slackStatus(run);
      if (interactive && status.workspaceId !== interactiveTeamId) throw new Error('The connected Slack workspace does not match the configured app.');
      if (!status.channels.some(c => c.id === channelId)) throw new Error('Choose an accessible channel where the connected account is a member.');
      const defaultView=options.groupBy==='person'&&!options.selection&&!options.urgentOnly&&!options.startDate;
      const key = createHash('sha256').update(`${status.workspaceId}:${ids.join(',')}:${channelId}${defaultView?'':`:${JSON.stringify(options)}`}${interactive?':interactive-v1':''}`).digest('hex');
      const journal = await readJournal();
      if (journal[key]?.state === 'sent') return { ...journal[key], duplicate: true };
      if (journal[key]) throw new Error('An earlier delivery has an unresolved outcome. Check Slack before attempting another send.');
      journal[key] = { state: 'pending', packageId:ids[0], packageIds:ids, view:options, channelId, startedAt: new Date().toISOString() };
      await writeJournal(journal);
      try {
        const result = await run('SLACK_SEND_MESSAGE', args);
        if (!result.ts || !result.channel) throw new Error('Slack did not return a delivery receipt.');
        journal[key] = { ...journal[key], state: 'sent', ts: result.ts, channelId: result.channel, sentAt: new Date().toISOString() };
        await writeJournal(journal);
        return journal[key];
      } catch {
        journal[key].state = 'uncertain';
        await writeJournal(journal);
        throw new Error('Delivery could not be confirmed. Check the selected Slack channel before retrying; automatic retries are blocked.');
      }
    } finally { locked = false; }
  };
}
export function localSlackPlugin(env) {
  const run = (slug, data) => composioTool(slug, data, env.CABIJ_SLACK_ACCOUNT);
  const journalPath = '.cabij-local/slack-deliveries.json';
  const localUrl = (() => { try { const url = new URL(env.CABIJ_CALCULATION_SUPABASE_URL); return url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? url.href : ''; } catch { return ''; } })();
  const bindingEnabled = !!(localUrl && env.CABIJ_CALCULATION_PUBLISHABLE_KEY && env.CABIJ_CALCULATION_WORKER_KEY && env.CABIJ_SLACK_TEAM_ID);
  const bindingAdmin = bindingEnabled ? slackBindingAdmin({ authenticate: supabaseCalculationContext(localUrl, env.CABIJ_CALCULATION_PUBLISHABLE_KEY), writer: createClient(localUrl, env.CABIJ_CALCULATION_WORKER_KEY, { auth: { persistSession:false, autoRefreshToken:false } }), teamId: env.CABIJ_SLACK_TEAM_ID }) : null;
  const interactiveEnabled = !!(localUrl && env.CABIJ_CALCULATION_WORKER_KEY && env.CABIJ_SLACK_SIGNING_SECRET && env.CABIJ_SLACK_TEAM_ID);
  const actionHandler = createSlackActionHandler({ secret: env.CABIJ_SLACK_SIGNING_SECRET, teamId: env.CABIJ_SLACK_TEAM_ID, async applyAction(a) {
    if (!interactiveEnabled) throw new Error('Interactive Slack completion is not configured.');
    const db = createClient(localUrl, env.CABIJ_CALCULATION_WORKER_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('slack_complete_task_v1', { p_team:a.team, p_slack_user:a.slackUser, p_action_ts:a.actionTs, p_action_id:a.actionId, p_client:a.clientId, p_project:a.projectId, p_package:a.packageId, p_revision:a.revision, p_task:a.taskId, p_status:a.status });
    if (error) throw new Error('Task update rejected. Check the package and linked kitchen membership.');
    return data;
  } });
  const deliver = createSlackDelivery({ run, interactiveEnabled, interactiveTeamId: env.CABIJ_SLACK_TEAM_ID,
    async loadPackage(id, token) {
      if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY || !token) throw new Error('Sign in to a connected kitchen to share a real approved package.');
      const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: { user }, error: authError } = await db.auth.getUser(token);
      if (authError || !user) throw new Error('Sign in again before sharing.');
      const { data: record, error } = await db.from('operations_packages_v1').select('*').eq('id', id).single();
      if (error || !record) throw new Error('Approved package not accessible.');
      const { data: membership } = await db.from('kitchen_memberships').select('role').eq('user_id', user.id).eq('client_id', record.client_id).maybeSingle();
      if (!['owner', 'manager'].includes(membership?.role)) throw new Error('A manager in this kitchen must share the schedule.');
      const { data: project, error: projectError } = await db.from('operations_projects_v1').select('id,revision').eq('id', record.project_id).eq('client_id', record.client_id).single();
      if (projectError || !project) throw new Error('Approved project not accessible.');
      return { ...record, snapshot: exportSource({ packageRecord: record, project, clientId: record.client_id }) };
    },
    async readJournal() { try { return JSON.parse(await readFile(journalPath, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } },
    async writeJournal(journal) { await mkdir('.cabij-local', { recursive: true, mode: 0o700 }); await writeFile(`${journalPath}.tmp`, JSON.stringify(journal), { mode: 0o600 }); await rename(`${journalPath}.tmp`, journalPath); }
  });
  return { name: 'cabij-local-slack', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/local-slack', async (req, res, next) => {
      const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
      const address = req.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return reply(403, { error: 'This integration is available on this computer only.' });
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) return reply(403, { error: 'Invalid local host.' });
      try {
        if (req.method === 'POST' && req.url === '/actions') {
          if (!interactiveEnabled || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return reply(403, { error: 'Interactive completion unavailable.' });
          const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 100000) return reply(413, { error: 'Request too large.' }); chunks.push(chunk); }
          const result = await actionHandler({ headers: req.headers, rawBody: Buffer.concat(chunks) });
          return reply(200, { text: result.duplicate ? 'This action was already recorded.' : `Task ${result.status === 'completed' ? 'completed' : 'reopened'}. Refresh the dashboard to see the update.`, response_type: 'ephemeral' });
        }
        if (req.method === 'POST' && ['/bindings/list','/bindings/create','/bindings/revoke'].includes(req.url)) {
          if (!bindingAdmin) return reply(503, { error: 'Slack user linking is not configured for the local worker.' });
          if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { error: 'Use the local dashboard to manage Slack links.' });
          const token = req.headers.authorization?.replace(/^Bearer /, '');
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 10000) return reply(413, { error: 'Request too large.' }); }
          const input = JSON.parse(body);
          if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['clientId','slackUserId','memberId'].includes(k))) throw new Error('Only kitchen and member identifiers are accepted.');
          return reply(200, await bindingAdmin({ ...input, token, operation:req.url.split('/').at(-1) }));
        }
        if (req.method === 'GET' && req.url === '/status') return reply(200, await slackStatus(run));
        if (req.method === 'POST' && req.url === '/send') {
          if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { error: 'Use the local dashboard to share schedules.' });
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 10000) return reply(413, { error: 'Request too large.' }); }
          const input = JSON.parse(body);
          const ids=input.packageIds?.length?input.packageIds:[input.packageId];
          if(!Array.isArray(ids)||ids.length>31||ids.some(id=>!/^[0-9a-f-]{36}$/i.test(id||''))) throw new Error('Select an approved package.');
          return reply(200, await deliver({ packageId: input.packageId, packageIds:input.packageIds, view:input.view, channelId: input.channelId, interactive: input.interactive === true, token: req.headers.authorization?.replace(/^Bearer /, '') }));
        }
        next();
      } catch (error) { reply(400, { error: error.message.startsWith('Command failed') ? 'Slack connection unavailable. Check Composio authorization on this computer.' : error.message }); }
    });
  } };
}
