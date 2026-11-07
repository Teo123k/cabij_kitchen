const checked = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
export function slackBindingAdmin({ authenticate, writer, teamId }) {
  return async ({ token, clientId, operation, slackUserId, memberId }) => {
    if (!token || typeof clientId !== 'string' || !clientId || clientId.length > 200 || !/^T[A-Z0-9]{1,30}$/.test(teamId || '') || !['list','create','revoke'].includes(operation)) throw new Error('A valid kitchen and configured Slack workspace are required.');
    if (operation !== 'list' && !/^[UW][A-Z0-9]{1,30}$/.test(slackUserId || '')) throw new Error('Enter a valid Slack user ID.');
    if (operation === 'create' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId || '')) throw new Error('Select an existing kitchen member.');
    const { db, user } = await authenticate(token);
    if (!user?.id) throw new Error('Sign in before managing Slack links.');
    const member = checked(await db.from('kitchen_memberships').select('role').eq('user_id', user.id).eq('client_id', clientId).maybeSingle());
    if (!['owner','manager'].includes(member?.role)) throw new Error('An owner or manager in this kitchen is required.');
    return checked(await writer.rpc('manage_slack_binding_v1', { p_actor:user.id, p_client:clientId, p_team:teamId, p_operation:operation, p_slack_user:slackUserId || null, p_member:memberId || null }));
  };
}
