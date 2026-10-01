-- migration_v12.sql
-- Images ab Cloudinary par save ho sakti hain. Neon SQL Editor mein ek baar run karein (deploy se PEHLE).
-- Dobara run karna safe hai. Purani images (data wali) pehle ki tarah chalti rehti hain.
ALTER TABLE images ALTER COLUMN data DROP NOT NULL;
ALTER TABLE images ADD COLUMN IF NOT EXISTS remote_url TEXT;   -- Cloudinary ka https link (is surat mein data khali hota hai)
