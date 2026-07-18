
-- Move SECURITY DEFINER functions out of the exposed public schema
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Recreate has_role in private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Update policies to reference private.has_role
DROP POLICY IF EXISTS "Admins can view all ratings" ON public.app_ratings;
DROP POLICY IF EXISTS "Admins can delete ratings" ON public.app_ratings;

CREATE POLICY "Admins can view all ratings"
ON public.app_ratings FOR SELECT
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete ratings"
ON public.app_ratings FOR DELETE
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Drop the now-unused public.has_role
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- Also restrict the trigger function from being callable by API roles
REVOKE ALL ON FUNCTION public.grant_admin_for_seed_email() FROM PUBLIC, anon, authenticated;
