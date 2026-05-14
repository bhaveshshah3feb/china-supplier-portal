-- WhatsApp media upload queue — files Bhavesh sends via WA get processed here
CREATE TABLE pending_wa_uploads (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   UUID  NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_name TEXT  NOT NULL,
  supplier_code TEXT,
  media_id      TEXT  NOT NULL,
  media_type    TEXT  NOT NULL CHECK (media_type IN ('video','image','document')),
  mime_type     TEXT,
  status        TEXT  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','done','failed')),
  error_log     TEXT,
  admin_phone   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pending_wa_uploads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_key_unique'
  ) THEN
    ALTER TABLE settings ADD CONSTRAINT settings_key_unique UNIQUE (key);
  END IF;
END $$;
