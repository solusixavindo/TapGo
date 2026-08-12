-- Role puncak pemilik sistem (SUPER_ADMIN_VIP).
--
-- Menambah nilai enum saja. Tidak ada akun yang dibuat, tidak ada akun yang
-- dinaikkan rolenya, dan tidak ada grant yang diberikan oleh migration ini —
-- pemegang pertama hanya lahir dari CLI bootstrap, sama seperti kebijakan
-- ADMIN_SCOPE_MANAGE.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN_VIP';
