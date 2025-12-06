-- Drop existing restrictive policies for authenticated users
DROP POLICY IF EXISTS "Authenticated users can insert fee_config" ON public.fee_config;
DROP POLICY IF EXISTS "Authenticated users can select fee_config" ON public.fee_config;
DROP POLICY IF EXISTS "Authenticated users can update fee_config" ON public.fee_config;

-- Create permissive policies for all roles (including anon)
CREATE POLICY "fee_config_select_any"
ON public.fee_config
FOR SELECT
TO public
USING (true);

CREATE POLICY "fee_config_insert_any"
ON public.fee_config
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "fee_config_update_any"
ON public.fee_config
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);