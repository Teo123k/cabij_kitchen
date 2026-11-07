-- Administrators add explicit owner invitations here; signup metadata never grants membership.
CREATE SCHEMA IF NOT EXISTS cabij_private;
REVOKE ALL ON SCHEMA cabij_private FROM PUBLIC, anon, authenticated;
CREATE TABLE cabij_private.owner_onboarding (
  email text PRIMARY KEY CHECK (email = lower(email)),
  client_id text NOT NULL,
  claimed_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
ALTER TABLE cabij_private.owner_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cabij_private.owner_onboarding FROM PUBLIC, anon, authenticated;
CREATE FUNCTION cabij_private.provision_confirmed_kitchen_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE invitation cabij_private.owner_onboarding;
BEGIN
  IF NEW.email_confirmed_at IS NULL OR NEW.email IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO invitation FROM cabij_private.owner_onboarding
    WHERE email = lower(NEW.email) AND (claimed_user_id IS NULL OR claimed_user_id = NEW.id)
    FOR UPDATE;
  IF invitation.email IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.kitchen_memberships(user_id, client_id, role)
    VALUES (NEW.id, invitation.client_id, 'owner')
    ON CONFLICT (user_id, client_id) DO UPDATE SET role = 'owner';
  UPDATE cabij_private.owner_onboarding SET claimed_user_id = NEW.id, claimed_at = COALESCE(claimed_at, now())
    WHERE email = invitation.email;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION cabij_private.provision_confirmed_kitchen_owner() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cabij_confirmed_owner_onboarding AFTER INSERT OR UPDATE OF email, email_confirmed_at
ON auth.users FOR EACH ROW EXECUTE FUNCTION cabij_private.provision_confirmed_kitchen_owner();
