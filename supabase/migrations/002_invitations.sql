-- ============================================================
-- Supplier Invitations
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS supplier_invitations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL,
  company_name_en   TEXT NOT NULL,
  company_name_zh   TEXT DEFAULT '',
  phone             TEXT DEFAULT '',
  contact_person_en TEXT,
  contact_person_zh TEXT,
  notes             TEXT,
  invite_token      TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  channel           TEXT DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp', 'wechat', 'manual')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_by        UUID REFERENCES admins(id) ON DELETE SET NULL,
  accepted_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE supplier_invitations ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated) can read pending, unexpired invites by token
-- This allows the register page to pre-fill form data from the invite
CREATE POLICY "invite_read_public" ON supplier_invitations
  FOR SELECT TO anon, authenticated
  USING (status = 'pending' AND expires_at > NOW());

-- Authenticated users can update their invite to accepted (when they complete registration)
CREATE POLICY "invite_accept_own" ON supplier_invitations
  FOR UPDATE TO authenticated
  USING (email = auth.email() AND status = 'pending')
  WITH CHECK (status = 'accepted');

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS supplier_invitations_token_idx ON supplier_invitations(invite_token);
CREATE INDEX IF NOT EXISTS supplier_invitations_email_idx ON supplier_invitations(email);

-- ── View for admin to see invite stats ────────────────────────
-- No extra policy needed — service role API handles admin reads
