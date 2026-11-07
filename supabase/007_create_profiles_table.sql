-- 1. Create the PROFILES table
-- This table links a Supabase Auth User ID to a specific Client ID.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  client_id TEXT NOT NULL,
  role TEXT DEFAULT 'staff', -- 'admin', 'chef', 'staff'
  full_name TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Allow users to read only their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid() = id);

-- 4. Automatically create a profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, client_id, role)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'client_id', 'kabile'), -- Extract from registration metadata
    CASE 
      WHEN new.email = 'teo@cabij.co' THEN 'admin' -- Change this to your actual email
      ELSE 'staff' 
    END
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
