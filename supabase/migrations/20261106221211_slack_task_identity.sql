-- Slack identity bindings are provisioned by an administrator, never by a Slack payload.
CREATE TABLE public.slack_kitchen_members_v1 (
  slack_team_id text NOT NULL,
  slack_user_id text NOT NULL,
  client_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (slack_team_id, slack_user_id, client_id)
);
CREATE TABLE public.slack_task_actions_v1 (
  slack_team_id text NOT NULL,
  slack_user_id text NOT NULL,
  action_ts text NOT NULL,
  action_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slack_team_id, slack_user_id, action_ts, action_id)
);
ALTER TABLE public.slack_kitchen_members_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_task_actions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slack_kitchen_members_v1, public.slack_task_actions_v1 FROM PUBLIC, anon, authenticated, service_role;

-- This is reachable only by a server holding the service key, after Slack signature verification.
CREATE FUNCTION public.slack_complete_task_v1(p_team text, p_slack_user text, p_action_ts text, p_action_id text, p_client text, p_project uuid, p_package uuid, p_revision integer, p_task text, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; result public.operations_task_completion_v1; inserted integer;
BEGIN
  IF p_action_id NOT IN ('cabij_task_complete_v1','cabij_task_reopen_v1') OR
     (p_action_id = 'cabij_task_complete_v1' AND p_status <> 'completed') OR
     (p_action_id = 'cabij_task_reopen_v1' AND p_status <> 'pending') OR
     p_action_ts !~ '^[0-9]{1,20}[.][0-9]{1,12}$' OR p_status NOT IN ('completed','pending') THEN
    RAISE EXCEPTION 'Invalid Slack action';
  END IF;
  SELECT b.user_id INTO actor FROM public.slack_kitchen_members_v1 b
    JOIN public.kitchen_memberships m ON m.user_id=b.user_id AND m.client_id=b.client_id
    WHERE b.slack_team_id=p_team AND b.slack_user_id=p_slack_user AND b.client_id=p_client;
  IF actor IS NULL THEN RAISE EXCEPTION 'Slack user is not linked to this kitchen' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.operations_packages_v1 p WHERE p.id=p_package AND p.project_id=p_project AND p.client_id=p_client AND p.project_revision=p_revision) THEN
    RAISE EXCEPTION 'Invalid package reference';
  END IF;
  INSERT INTO public.slack_task_actions_v1(slack_team_id,slack_user_id,action_ts,action_id) VALUES (p_team,p_slack_user,p_action_ts,p_action_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted=0 THEN RETURN jsonb_build_object('duplicate',true); END IF;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor::text,'role','authenticated')::text,true);
  INSERT INTO public.operations_task_completion_v1(client_id,project_id,package_id,task_id,status)
    VALUES (p_client,p_project,p_package,p_task,p_status)
    ON CONFLICT (package_id,task_id) DO UPDATE SET status=EXCLUDED.status
    RETURNING * INTO result;
  RETURN jsonb_build_object('duplicate',false,'status',result.status,'updated_at',result.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.slack_complete_task_v1(text,text,text,text,text,uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slack_complete_task_v1(text,text,text,text,text,uuid,uuid,integer,text,text) TO service_role;
