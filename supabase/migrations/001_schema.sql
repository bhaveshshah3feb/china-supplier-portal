-- ============================================================
-- China Supplier Portal — Full Schema
-- Run this once in Supabase SQL Editor
-- ============================================================

-- ── Main Categories ──────────────────────────────────────────
CREATE TABLE main_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en       TEXT NOT NULL,
  name_zh       TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected')),
  suggested_by  UUID,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sub Categories ────────────────────────────────────────────
CREATE TABLE sub_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  main_category_id  UUID NOT NULL REFERENCES main_categories(id) ON DELETE CASCADE,
  name_en           TEXT NOT NULL,
  name_zh           TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected')),
  suggested_by      UUID,
  display_order     INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Suppliers (linked to Supabase Auth) ───────────────────────
CREATE TABLE suppliers (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  company_name_en     TEXT NOT NULL,
  company_name_zh     TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  contact_person_en   TEXT,
  contact_person_zh   TEXT,
  supplier_code       TEXT UNIQUE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Admins (linked to Supabase Auth) ─────────────────────────
CREATE TABLE admins (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  last_login  TIMESTAMPTZ
);

-- ── Uploads ──────────────────────────────────────────────────
CREATE TABLE uploads (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id                   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  original_filename             TEXT NOT NULL,
  display_name                  TEXT,
  file_type                     TEXT CHECK (file_type IN ('video', 'image', 'pricelist', 'document', 'other')),
  mime_type                     TEXT,
  file_size                     BIGINT,
  storage_path                  TEXT NOT NULL,
  upload_status                 TEXT NOT NULL DEFAULT 'uploading' CHECK (upload_status IN ('uploading', 'completed', 'failed')),
  processing_status             TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  main_category_id              UUID REFERENCES main_categories(id),
  sub_category_id               UUID REFERENCES sub_categories(id),
  ai_main_category_id           UUID REFERENCES main_categories(id),
  ai_sub_category_id            UUID REFERENCES sub_categories(id),
  ai_confidence                 FLOAT,
  sales_path                    TEXT,
  error_message                 TEXT,
  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Processing Queue ─────────────────────────────────────────
CREATE TABLE processing_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id     UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  job_type      TEXT NOT NULL CHECK (job_type IN ('categorize', 'watermark')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts      INTEGER DEFAULT 0,
  max_attempts  INTEGER DEFAULT 3,
  error_log     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

-- ── Admin Logs ───────────────────────────────────────────────
CREATE TABLE admin_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID REFERENCES admins(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   UUID,
  details     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Auto-generate supplier_code ──────────────────────────────
CREATE OR REPLACE FUNCTION generate_supplier_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  code TEXT;
  taken BOOLEAN;
BEGIN
  LOOP
    code := 'SUP-' || upper(substring(md5(random()::text || clock_timestamp()::text), 1, 6));
    SELECT EXISTS(SELECT 1 FROM suppliers WHERE supplier_code = code) INTO taken;
    EXIT WHEN NOT taken;
  END LOOP;
  RETURN code;
END;
$$;

-- ── Auto-create supplier record on signup ────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only create supplier if not flagged as admin
  IF (NEW.raw_user_meta_data->>'role') IS DISTINCT FROM 'admin' THEN
    INSERT INTO suppliers (id, email, company_name_en, company_name_zh, phone, supplier_code)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'company_name_en', ''),
      COALESCE(NEW.raw_user_meta_data->>'company_name_zh', ''),
      COALESCE(NEW.raw_user_meta_data->>'phone', ''),
      generate_supplier_code()
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER suppliers_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER uploads_updated_at BEFORE UPDATE ON uploads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE suppliers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE main_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs       ENABLE ROW LEVEL SECURITY;

-- Suppliers: own row only
CREATE POLICY "supplier_own" ON suppliers FOR ALL USING (auth.uid() = id);

-- Admins: own row only
CREATE POLICY "admin_own" ON admins FOR ALL USING (auth.uid() = id);

-- Uploads: supplier manages own uploads
CREATE POLICY "upload_supplier_own" ON uploads FOR ALL USING (auth.uid() = supplier_id);

-- Processing queue: suppliers read their own jobs
CREATE POLICY "queue_supplier_read" ON processing_queue FOR SELECT
  USING (EXISTS (SELECT 1 FROM uploads u WHERE u.id = upload_id AND u.supplier_id = auth.uid()));

-- Categories: anyone authenticated reads active ones
CREATE POLICY "main_cat_read" ON main_categories FOR SELECT TO authenticated USING (status = 'active');
CREATE POLICY "sub_cat_read"  ON sub_categories  FOR SELECT TO authenticated USING (status = 'active');

-- Suppliers can suggest new categories (insert with pending status)
CREATE POLICY "main_cat_suggest" ON main_categories FOR INSERT TO authenticated
  WITH CHECK (status = 'pending' AND suggested_by = auth.uid());
CREATE POLICY "sub_cat_suggest" ON sub_categories FOR INSERT TO authenticated
  WITH CHECK (status = 'pending' AND suggested_by = auth.uid());

-- ── Storage Buckets ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('sales',   'sales',   true)  ON CONFLICT DO NOTHING;

-- Suppliers upload to their own folder
CREATE POLICY "storage_upload_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "storage_read_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "storage_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Sales bucket: public read
CREATE POLICY "sales_public_read" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'sales');

-- ── Seed: Main Categories ────────────────────────────────────
INSERT INTO main_categories (name_en, name_zh, slug, display_order) VALUES
  ('Arcade / Video Games',  '电玩游戏',     'arcade',      1),
  ('Redemption Games',      '兑奖游戏',     'redemption',  2),
  ('Kiddy Rides',           '儿童游乐设备', 'kiddy',       3),
  ('Shooting Games',        '射击游戏',     'shooting',    4),
  ('Simulators',            '模拟器',       'simulator',   5),
  ('Prize Machines',        '抓娃娃机',     'prize',       6);

-- ── Seed: Sub Categories ─────────────────────────────────────
INSERT INTO sub_categories (main_category_id, name_en, name_zh, slug, display_order)
SELECT id, 'Car Racing',   '赛车游戏',   'car-racing',   1 FROM main_categories WHERE slug = 'arcade'
UNION ALL
SELECT id, 'Bike Racing',  '摩托车游戏', 'bike-racing',  2 FROM main_categories WHERE slug = 'arcade'
UNION ALL
SELECT id, 'Sports',       '体育游戏',   'sports-arcade',3 FROM main_categories WHERE slug = 'arcade'
UNION ALL
SELECT id, 'Family Redemption',       '家庭兑奖',     'family-redemption',      1 FROM main_categories WHERE slug = 'redemption'
UNION ALL
SELECT id, 'High Ticket Redemption',  '高分兑奖',     'high-ticket-redemption', 2 FROM main_categories WHERE slug = 'redemption'
UNION ALL
SELECT id, 'Sports Redemption',       '运动兑奖',     'sports-redemption',      3 FROM main_categories WHERE slug = 'redemption'
UNION ALL
SELECT id, 'Carnival',                '嘉年华',       'carnival',               4 FROM main_categories WHERE slug = 'redemption'
UNION ALL
SELECT id, 'Baby / Toddler',   '婴幼儿',     'baby-toddler',  1 FROM main_categories WHERE slug = 'kiddy'
UNION ALL
SELECT id, 'Coin-op Rides',    '投币游乐',   'coinop-rides',  2 FROM main_categories WHERE slug = 'kiddy'
UNION ALL
SELECT id, 'Prize Claw',       '抓娃娃',     'prize-claw',    1 FROM main_categories WHERE slug = 'prize'
UNION ALL
SELECT id, 'Bulk Vending',     '自动贩卖',   'bulk-vending',  2 FROM main_categories WHERE slug = 'prize'
UNION ALL
SELECT id, 'Gun Shooting',     '枪击游戏',   'gun-shooting',  1 FROM main_categories WHERE slug = 'shooting'
UNION ALL
SELECT id, 'AR Shooting',      'AR射击',     'ar-shooting',   2 FROM main_categories WHERE slug = 'shooting'
UNION ALL
SELECT id, 'VR Simulator',     'VR模拟器',   'vr-simulator',  1 FROM main_categories WHERE slug = 'simulator'
UNION ALL
SELECT id, 'Motion Simulator', '动感模拟',   'motion-sim',    2 FROM main_categories WHERE slug = 'simulator';

-- ── Admin Setup Instructions ─────────────────────────────────
-- After deploying, create your admin account:
-- 1. Go to Supabase Dashboard > Authentication > Users > Add User
-- 2. Email: bhavesh@aryanamusements.com  Password: (your choice)
-- 3. Copy the new user's UUID, then run:
--
-- INSERT INTO admins (id, email, name, role)
-- VALUES ('<paste-uuid-here>', 'bhavesh@aryanamusements.com', 'Bhavesh', 'super_admin');
--
-- Then delete the auto-created supplier row for that user:
-- DELETE FROM suppliers WHERE id = '<paste-uuid-here>';
