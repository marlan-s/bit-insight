
CREATE TABLE public.datasets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  detected_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingest_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ingested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO anon, authenticated;
GRANT ALL ON public.datasets TO service_role;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "datasets open access" ON public.datasets FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.transactions (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ,
  txid TEXT NOT NULL,
  source_ip TEXT,
  source_port INTEGER,
  destination_ip TEXT,
  destination_port INTEGER,
  input_wallet TEXT,
  output_wallet TEXT,
  input_amount DOUBLE PRECISION,
  output_amount DOUBLE PRECISION,
  fee DOUBLE PRECISION,
  script_type TEXT,
  scenario TEXT
);
CREATE INDEX transactions_dataset_idx ON public.transactions(dataset_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.transactions_id_seq TO anon, authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transactions open access" ON public.transactions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.entities (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  anomaly_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  primary_reason TEXT,
  tx_count INTEGER NOT NULL DEFAULT 0,
  ip_count INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation JSONB NOT NULL DEFAULT '[]'::jsonb,
  scenario TEXT
);
CREATE INDEX entities_dataset_idx ON public.entities(dataset_id, risk_score DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entities TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.entities_id_seq TO anon, authenticated;
GRANT ALL ON public.entities TO service_role;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entities open access" ON public.entities FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.model_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX model_runs_dataset_idx ON public.model_runs(dataset_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_runs TO anon, authenticated;
GRANT ALL ON public.model_runs TO service_role;
ALTER TABLE public.model_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model_runs open access" ON public.model_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
