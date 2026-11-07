\set ON_ERROR_STOP on
BEGIN;
INSERT INTO cabij_private.owner_onboarding(email, client_id) VALUES ('owner@example.test','onboarding-test');
INSERT INTO auth.users(id,email) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','owner@example.test');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.kitchen_memberships WHERE client_id='onboarding-test') THEN RAISE EXCEPTION 'FAIL unconfirmed owner'; END IF; END $$;
UPDATE auth.users SET email_confirmed_at=now() WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.kitchen_memberships WHERE client_id='onboarding-test' AND user_id='dddddddd-dddd-dddd-dddd-dddddddddddd' AND role='owner') THEN RAISE EXCEPTION 'FAIL confirmed owner'; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','stranger@example.test',now());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.kitchen_memberships WHERE user_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') THEN RAISE EXCEPTION 'FAIL uninvited owner'; END IF; END $$;
UPDATE auth.users SET email='changed@example.test' WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd';
UPDATE auth.users SET email='owner@example.test' WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.kitchen_memberships WHERE user_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') THEN RAISE EXCEPTION 'FAIL claimed invitation reuse'; END IF; END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN SELECT * FROM cabij_private.owner_onboarding; RAISE EXCEPTION 'FAIL private invitation read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.kitchen_memberships(user_id,client_id,role) VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','onboarding-test','owner'); RAISE EXCEPTION 'FAIL browser self assignment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'verified owner, invitation isolation and claim reuse guards passed' AS result;
