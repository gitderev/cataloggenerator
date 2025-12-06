-- Enable RLS on admin_users table
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to check if they are admins (needed for the fee_config policies)
CREATE POLICY "admin_users_select_self"
ON public.admin_users
FOR SELECT
TO authenticated
USING (true);