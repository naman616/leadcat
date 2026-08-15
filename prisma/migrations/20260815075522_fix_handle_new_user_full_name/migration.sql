-- ============================================================================
-- Bug fix: handle_new_user() only ever inserted id + email into public.users,
-- silently dropping full_name even though signUp() in src/lib/auth.server.ts
-- always passes it via options.data.full_name (stored by Supabase Auth in
-- auth.users.raw_user_meta_data). Every signup since the _init migration got
-- a NULL full_name regardless of what the user typed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');
  RETURN NEW;
END;
$$;

-- Backfill existing rows created before this fix.
UPDATE public.users u
SET full_name = a.raw_user_meta_data ->> 'full_name'
FROM auth.users a
WHERE u.id = a.id
  AND u.full_name IS NULL
  AND a.raw_user_meta_data ->> 'full_name' IS NOT NULL;
