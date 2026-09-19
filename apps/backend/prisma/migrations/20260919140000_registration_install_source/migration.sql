-- Sumber instalasi pada pendaftaran (dilaporkan klien): jenis build dan paket installer.
ALTER TABLE "registration_events" ADD COLUMN "distribution" VARCHAR(16);
ALTER TABLE "registration_events" ADD COLUMN "installer" VARCHAR(100);
