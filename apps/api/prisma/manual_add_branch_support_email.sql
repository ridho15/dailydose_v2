-- Migrasi Manual: Penambahan kolom email dukungan per cabang (opsional/nullable)
-- ponyail: field nullable agar kompatibel tanpa mengisi data lama, fallback otomatis ke kontak pusat
ALTER TABLE `cabang`
  ADD COLUMN `support_email` VARCHAR(128) NULL DEFAULT NULL AFTER `phone`;

