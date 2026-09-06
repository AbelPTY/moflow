-- Receipt & Invoice Intelligence V1 — structured-extraction persistence.
--
-- Stores ONLY structured, non-sensitive receipt/invoice metadata (no raw image
-- or XML bytes; no customer identity; card digits are stripped before insert by
-- the client/server). References the LIVE public.transactions table. Per-owner
-- RLS. Additive and idempotent. PROPOSED — DO NOT APPLY until reviewed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.transaction_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  document_type text NOT NULL DEFAULT 'receipt' CHECK (document_type IN ('receipt', 'invoice')),
  source_type text NOT NULL DEFAULT 'image' CHECK (source_type IN ('image', 'xml')),
  merchant_name text,
  legal_entity_name text,
  tax_id text,
  transaction_date date,
  subtotal numeric,
  tax numeric,
  total numeric,
  currency text DEFAULT 'USD',
  payment_method text,
  fingerprint text,
  extracted_data jsonb,            -- structured normalized receipt (no raw bytes)
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transaction_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts_owner_select" ON public.transaction_receipts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "receipts_owner_insert" ON public.transaction_receipts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "receipts_owner_update" ON public.transaction_receipts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "receipts_owner_delete" ON public.transaction_receipts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_transaction_receipts_user ON public.transaction_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_txn ON public.transaction_receipts(transaction_id);
-- Duplicate-attachment safety: one receipt fingerprint per owner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_receipts_fp
  ON public.transaction_receipts(user_id, fingerprint) WHERE fingerprint IS NOT NULL;

COMMIT;
