-- Prevent duplicate processing of the same WhatsApp media
ALTER TABLE pending_wa_uploads ADD CONSTRAINT pending_wa_uploads_media_id_unique UNIQUE (media_id);
