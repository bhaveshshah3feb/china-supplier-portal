-- ============================================================
-- Guest Upload Links — allow suppliers to upload without registering
-- ============================================================

-- Allow NULL on fields that are optional for guest links
ALTER TABLE supplier_invitations
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN company_name_en DROP NOT NULL,
  ALTER COLUMN expires_at DROP NOT NULL;

-- Add guest link columns
ALTER TABLE supplier_invitations
  ADD COLUMN IF NOT EXISTS link_type    TEXT NOT NULL DEFAULT 'specific'
    CHECK (link_type IN ('specific', 'open')),
  ADD COLUMN IF NOT EXISTS auth_email   TEXT,
  ADD COLUMN IF NOT EXISTS supplier_id  UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_signup  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS use_count    INTEGER NOT NULL DEFAULT 0;

-- Update public read policy to handle NULL expires_at (permanent links)
DROP POLICY IF EXISTS "invite_read_public" ON supplier_invitations;
CREATE POLICY "invite_read_public" ON supplier_invitations
  FOR SELECT TO anon, authenticated
  USING (status = 'pending' AND (expires_at IS NULL OR expires_at > NOW()));

-- Admin update policy for invitations
DROP POLICY IF EXISTS "invite_admin_update" ON supplier_invitations;
CREATE POLICY "invite_admin_update" ON supplier_invitations
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE id = auth.uid()));
