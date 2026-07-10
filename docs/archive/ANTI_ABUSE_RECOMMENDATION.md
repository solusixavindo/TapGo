# Anti-Abuse Recommendation

Tanggal: 16 Juni 2026

Scope: rekomendasi anti-abuse TapGo tanpa deploy, migration, atau perubahan production DB.

## Level 1 — Aman Tanpa Migration

Status: **Sebagian sudah diterapkan**

| Rekomendasi | Status | Catatan |
| --- | --- | --- |
| Normalize nomor HP sebelum register/login | DONE | Patch `normalizePhoneNumber` dan `phoneLookupVariants`. |
| Rate limit registrasi berdasarkan IP | DONE basic | `authRateLimiter` aktif di register/login/refresh/OTP. |
| Rate limit registrasi berdasarkan phone | RECOMMENDED | Bisa dibuat in-memory/Redis key per normalized phone tanpa schema. |
| Block referral code milik akun sendiri | DONE | `ReferralService` blokir self-referral. |
| Logging suspicious registration | RECOMMENDED | Bisa log IP/userAgent/phone prefix tanpa menyimpan data sensitif berlebih. |
| Disable bonus register jika terindikasi duplikat | RECOMMENDED | Butuh risk signal; tanpa device/KYC hanya phone/IP. |
| Mask error response | DONE basic | Unknown error return generic `Unexpected server error`. |

## Level 2 — Butuh Perubahan Schema / Approval

| Rekomendasi | Tujuan |
| --- | --- |
| `device_fingerprint_hash` pada session/registration | Deteksi 1 HP banyak akun. |
| Batas 1 device untuk 1 akun aktif atau maksimal X akun | Menekan bonus farming. |
| Tabel `registration_events` | Audit IP/device/userAgent/phone hash saat daftar. |
| Tabel `abuse_flags` | Admin review user/device/IP mencurigakan. |
| Tabel `bonus_eligibility` | Pisahkan eligibility benefit dari user creation. |
| Index unique conditional untuk bonus Basic per phone/device | Mencegah double benefit dengan bukti DB. |
| Admin review untuk akun suspicious | Tahan withdraw/bonus sampai review. |

## Level 3 — Advanced

| Rekomendasi | Tujuan |
| --- | --- |
| OTP verification wajib register dan withdrawal | Mengurangi nomor palsu. |
| KYC untuk withdrawal | Mencegah cash-out oleh akun farm. |
| Device risk scoring | Deteksi emulator/root/high velocity. |
| Withdrawal hold period akun baru | Menahan abuse cash-out. |
| Bonus lock sampai membership/payment valid | Sudah sponsor/level paid-only; Basic PPOB bisa tetap lock jika perlu. |
| Velocity rule IP/device/referral | Deteksi satu sponsor membuat puluhan akun cepat. |

## Rekomendasi Minimum Sebelum Public Launch

1. Tambahkan phone-specific auth/register limiter.
2. Tambahkan device fingerprint hash dengan consent/privacy notice.
3. Tambahkan registration event log.
4. Tambahkan withdrawal hold/review untuk akun baru, akun multi-device, atau sponsor high velocity.
5. Jalankan production abuse snapshot: duplicate phone variant, same IP session burst, referral farm patterns.

## Catatan Compliance

Device fingerprint dan KYC harus selaras dengan Privacy Policy/Data Safety Google Play. Simpan hash, bukan raw fingerprint jika memungkinkan.

