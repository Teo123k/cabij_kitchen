ALTER TABLE public.slack_kitchen_members_v1 ADD COLUMN created_by uuid REFERENCES auth.users(id);
ALTER TABLE public.slack_kitchen_members_v1 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- The local server verifies the session before passing its actor ID to this service-only function.
CREATE FUNCTION public.manage_slack_binding_v1(p_actor uuid, p_client text, p_team text, p_operation text, p_slack_user text DEFAULT NULL, p_member uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE bindings jsonb; members jsonb; existing uuid;
BEGIN
  IF p_actor IS NULL OR p_client IS NULL OR length(p_client) NOT BETWEEN 1 AND 200 OR p_team IS NULL OR p_team !~ '^T[A-Z0-9]{1,30}$' OR p_operation IS NULL OR p_operation NOT IN ('list','create','revoke') THEN
    RAISE EXCEPTION 'Invalid binding request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.user_id=p_actor AND m.client_id=p_client AND m.role IN ('owner','manager')) THEN
    RAISE EXCEPTION 'An owner or manager in this kitchen is required' USING ERRCODE='42501';
  END IF;
  IF p_operation = 'list' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('slackUserId',b.slack_user_id,'memberId',b.user_id,'createdBy',b.created_by,'createdAt',b.created_at) ORDER BY b.slack_user_id),'[]'::jsonb) INTO bindings
      FROM public.slack_kitchen_members_v1 b WHERE b.client_id=p_client AND b.slack_team_id=p_team;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'email',u.email,'role',m.role) ORDER BY u.email NULLS LAST,m.user_id),'[]'::jsonb) INTO members
      FROM public.kitchen_memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.client_id=p_client;
    RETURN jsonb_build_object('teamId',p_team,'bindings',bindings,'members',members);
  END IF;
  IF p_slack_user IS NULL OR p_slack_user !~ '^[UW][A-Z0-9]{1,30}$' THEN RAISE EXCEPTION 'A valid Slack user ID is required'; END IF;
  IF p_operation = 'create' THEN
    IF p_member IS NULL OR NOT EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id=p_client AND m.user_id=p_member) THEN RAISE EXCEPTION 'Select an existing member of this kitchen'; END IF;
    SELECT user_id INTO existing FROM public.slack_kitchen_members_v1 WHERE slack_team_id=p_team AND slack_user_id=p_slack_user AND client_id=p_client;
    IF existing IS NOT NULL THEN RAISE EXCEPTION 'This Slack user already has a binding; revoke it before changing the member'; END IF;
    INSERT INTO public.slack_kitchen_members_v1(slack_team_id,slack_user_id,client_id,user_id,created_by) VALUES (p_team,p_slack_user,p_client,p_member,p_actor);
    RETURN jsonb_build_object('created',true);
  END IF;
  DELETE FROM public.slack_kitchen_members_v1 WHERE slack_team_id=p_team AND slack_user_id=p_slack_user AND client_id=p_client;
  IF NOT FOUND THEN RAISE EXCEPTION 'Binding not found'; END IF;
  RETURN jsonb_build_object('revoked',true);
END $$;
REVOKE ALL ON FUNCTION public.manage_slack_binding_v1(uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_slack_binding_v1(uuid,text,text,text,text,uuid) TO service_role;
