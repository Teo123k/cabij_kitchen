import { createClient } from '@supabase/supabase-js';
import { buildReviewedPlan } from './reviewedCalculation.js';

const checked = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const fields = (input, allowed) => {
  if (!input || Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Supply source identifiers only; browser calculation output is not accepted.');
};

// authenticate verifies Auth and returns a caller-scoped client; writer stays server-only.
export function trustedCalculation({ authenticate, writer }) {
  async function context(input, roles = ['owner', 'manager', 'chef', 'staff']) {
    if (!input.token || !input.clientId) throw new Error('An authenticated kitchen session is required.');
    const { db, user } = await authenticate(input.token);
    if (!user?.id) throw new Error('Sign in again before calculating.');
    const member = checked(await db.from('kitchen_memberships').select('role').eq('user_id', user.id).eq('client_id', input.clientId).maybeSingle());
    if (!roles.includes(member?.role)) throw new Error('Kitchen membership with the required role is required.');
    return { db, user };
  }
  async function result(db, job) {
    const run = checked(await db.from('operations_calculation_runs_v1').select('*').eq('client_id', job.client_id).eq('job_id', job.id).maybeSingle());
    return { job, run };
  }
  return {
    async calculate(input) {
      fields(input, ['token', 'clientId', 'projectId', 'projectRevision', 'idempotencyKey']);
      if (!Number.isInteger(input.projectRevision) || input.projectRevision < 1 || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new Error('A saved project revision and idempotency key are required.');
      const { db, user } = await context(input, ['owner', 'manager', 'chef']);
      const project = checked(await db.from('operations_projects_v1').select('*').eq('client_id', input.clientId).eq('id', input.projectId).single());
      if (!project || project.revision !== input.projectRevision) throw new Error('Save and regenerate the current project revision.');
      const identity = { client_id: input.clientId, project_id: project.id, project_revision: project.revision, idempotency_key: input.idempotencyKey };
      const inserted = await writer.from('operations_calculation_jobs_v1').insert({ ...identity, requested_by: user.id }).select('*').single();
      if (inserted.error?.code === '23505') {
        const job = checked(await db.from('operations_calculation_jobs_v1').select('*').eq('client_id', identity.client_id).eq('project_id', identity.project_id).eq('project_revision', identity.project_revision).eq('idempotency_key', identity.idempotency_key).single());
        return { ...await result(db, job), duplicate: true };
      }
      const job = checked(inserted);
      try {
        const versions = checked(await db.from('recipe_versions_v1').select('*').eq('client_id', input.clientId).eq('status', 'approved'));
        const snapshot = await buildReviewedPlan(project.document, versions, input.clientId, db);
        const run = checked(await writer.from('operations_calculation_runs_v1').insert({ job_id: job.id, client_id: input.clientId, project_id: project.id, project_revision: project.revision, engine_version: String(snapshot.engineVersion), snapshot }).select('*').single());
        return { job: { ...job, status: 'completed', finished_at: run.completed_at }, run, duplicate: false };
      } catch (error) {
        // A lost completion response must not overwrite a committed completed job.
        await writer.from('operations_calculation_jobs_v1').update({ status: 'failed', error: String(error.message).slice(0, 1000) }).eq('id', job.id).eq('status', 'running');
        throw error;
      }
    },
    async status(input) {
      fields(input, ['token', 'clientId', 'jobId']);
      const { db } = await context(input);
      const job = checked(await db.from('operations_calculation_jobs_v1').select('*').eq('client_id', input.clientId).eq('id', input.jobId).single());
      return result(db, job);
    },
    async approve(input) {
      fields(input, ['token', 'clientId', 'runId']);
      const { db } = await context(input, ['owner', 'manager']);
      const run = checked(await db.from('operations_calculation_runs_v1').select('*').eq('client_id', input.clientId).eq('id', input.runId).single());
      if (!run?.snapshot.ready) throw new Error('Resolve blocking exceptions before approval.');
      return checked(await db.from('operations_packages_v1').insert({ client_id: input.clientId, project_id: run.project_id, project_revision: run.project_revision, calculation_run_id: run.id }).select('*').single());
    }
  };
}

export function supabaseCalculationContext(url, publishableKey) {
  return async token => {
    const db = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) throw new Error('Sign in again before calculating.');
    return { db, user: data.user };
  };
}

// The development seam cannot connect its privileged writer to a hosted kitchen.
export function localCalculationPlugin(env, adapter) {
  let worker = adapter;
  return { name: 'cabij-local-calculation', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/local-calculation', async (req, res) => {
      const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) return reply(403, { error: 'Use the local dashboard to calculate.' });
      if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { error: 'Use a same-origin dashboard request.' });
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (!token) return reply(401, { error: 'Sign in before calculating.' });
      try {
        if (!worker) {
          let localUrl;
          try { localUrl = new URL(env.CABIJ_CALCULATION_SUPABASE_URL); } catch { /* Disabled until explicitly configured. */ }
          if (!localUrl || localUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(localUrl.hostname) || !env.CABIJ_CALCULATION_PUBLISHABLE_KEY || !env.CABIJ_CALCULATION_WORKER_KEY) return reply(503, { error: 'Trusted calculation is not configured. Apply the migration and configure a disposable local Supabase worker; hosted approval integration is pending.' });
          worker = trustedCalculation({ authenticate: supabaseCalculationContext(localUrl.href, env.CABIJ_CALCULATION_PUBLISHABLE_KEY), writer: createClient(localUrl.href, env.CABIJ_CALCULATION_WORKER_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) });
        }
        const operation = { '/calculate': 'calculate', '/status': 'status', '/approve': 'approve' }[req.url];
        if (!operation) return reply(404, { error: 'Unknown calculation operation.' });
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 10000) return reply(413, { error: 'Request too large.' }); }
        const input = JSON.parse(body);
        if (Object.hasOwn(input, 'token')) throw new Error('Use the authenticated request header.');
        return reply(200, await worker[operation]({ ...input, token }));
      } catch (error) { return reply(400, { error: error.message }); }
    });
  } };
}
