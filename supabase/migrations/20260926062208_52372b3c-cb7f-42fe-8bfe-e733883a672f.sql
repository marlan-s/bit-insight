DROP POLICY IF EXISTS "datasets open access" ON public.datasets;
DROP POLICY IF EXISTS "transactions open access" ON public.transactions;
DROP POLICY IF EXISTS "entities open access" ON public.entities;
DROP POLICY IF EXISTS "model_runs open access" ON public.model_runs;

CREATE POLICY "datasets public read" ON public.datasets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "transactions public read" ON public.transactions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "entities public read" ON public.entities FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "model_runs public read" ON public.model_runs FOR SELECT TO anon, authenticated USING (true);