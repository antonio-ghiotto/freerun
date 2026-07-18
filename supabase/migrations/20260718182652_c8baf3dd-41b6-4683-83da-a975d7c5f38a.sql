-- Tighten SECURITY DEFINER function permissions
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.grant_admin_for_seed_email() FROM PUBLIC, anon, authenticated;

-- Replace permissive INSERT policy with a validated one
DROP POLICY IF EXISTS "Anyone can submit a rating" ON public.app_ratings;
CREATE POLICY "Anyone can submit a valid rating"
ON public.app_ratings FOR INSERT
TO anon, authenticated
WITH CHECK (stars BETWEEN 1 AND 5);