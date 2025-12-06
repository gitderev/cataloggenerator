-- Function to add current authenticated user as admin
CREATE OR REPLACE FUNCTION public.add_self_as_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_users (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN true;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.add_self_as_admin() TO authenticated;