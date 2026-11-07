import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { prepRows, groupPrep } from '../src/operations/prepPresentation.js';

export function verifySlackRequest({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret || !/^\d{1,12}$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^v0=[0-9a-f]{64}$/.test(signature || '')) return false;
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:`).update(rawBody).digest('hex')}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export function slackTaskBlocks(records, options) {
  const rows = records.flatMap(r => prepRows(r.plan, r.packageId)).filter(t => !options.startDate || (t.date >= options.startDate && t.date <= options.endDate));
  const tasks = groupPrep(rows, options).flatMap(group => group.tasks);
  if (!tasks.length || tasks.length > 20) throw new Error('Select a view with 1–20 tasks for interactive Slack buttons.');
  return tasks.map(task => {
    const record = records.find(r => r.packageId === task.projectId);
    if (!record?.plan.exportProvenance?.calculationRunId || record.plan.project.sample) throw new Error('Interactive tasks require a trusted approved package.');
    const value = JSON.stringify({ clientId: record.plan.clientId, projectId: record.projectId, packageId: record.packageId, revision: record.revision, taskId: task.id });
    if (value.length > 2000) throw new Error('Task reference is too long for Slack.');
    return { type: 'actions', block_id: `cabij_${createHash('sha256').update(value).digest('hex').slice(0, 30)}`, elements: [
      { type: 'button', action_id: 'cabij_task_complete_v1', text: { type:'plain_text', text:`Complete: ${task.description}`.slice(0,75) }, value },
      { type: 'button', action_id: 'cabij_task_reopen_v1', text: { type:'plain_text', text:'Reopen task' }, value }
    ] };
  });
}
export function createSlackActionHandler({ secret, teamId, applyAction, now = () => Date.now() }) {
  return async ({ headers, rawBody }) => {
    if (!verifySlackRequest({ secret, timestamp: headers['x-slack-request-timestamp'], signature: headers['x-slack-signature'], rawBody, now: now() })) throw new Error('Invalid Slack signature.');
    const params = new URLSearchParams(rawBody.toString('utf8'));
    if (params.getAll('payload').length !== 1) throw new Error('Invalid Slack payload.');
    let payload, ref; try { payload = JSON.parse(params.get('payload')); ref = JSON.parse(payload.actions?.[0]?.value); } catch { throw new Error('Invalid Slack payload.'); }
    const action = payload.actions?.[0], id = action?.action_id;
    if (payload.type !== 'block_actions' || payload.actions.length !== 1 || payload.team?.id !== teamId || !/^[UW][A-Z0-9]+$/.test(payload.user?.id || '') || !/^\d{1,20}\.\d{1,12}$/.test(action?.action_ts || '') || !['cabij_task_complete_v1','cabij_task_reopen_v1'].includes(id)) throw new Error('Invalid Slack action.');
    if (!ref || typeof ref.clientId !== 'string' || !ref.clientId || ref.clientId.length > 200 || !/^[0-9a-f-]{36}$/i.test(ref.projectId || '') || !/^[0-9a-f-]{36}$/i.test(ref.packageId || '') || !Number.isSafeInteger(ref.revision) || ref.revision < 1 || typeof ref.taskId !== 'string' || !ref.taskId || ref.taskId.length > 500) throw new Error('Invalid task reference.');
    return applyAction({ team: teamId, slackUser: payload.user.id, actionTs: action.action_ts, actionId: id, ...ref, status: id === 'cabij_task_complete_v1' ? 'completed' : 'pending' });
  };
}
