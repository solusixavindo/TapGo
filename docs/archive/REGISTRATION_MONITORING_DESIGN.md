# Registration Monitoring Design

Tanggal: 16 Juni 2026

Scope: desain Phase 2 anti-abuse device dan registration monitoring. Tidak ada deploy, tidak ada production migration execute, dan tidak ada perubahan production DB.

## Tujuan

Menurunkan risiko:

- 1 HP membuat banyak akun.
- 1 IP membuat banyak akun cepat.
- Referral farming.
- Basic PPOB bonus farming.
- Akun berantai untuk komisi/bonus.

Desain ini bersifat **monitoring dan flagging dulu**, bukan auto-block agresif, agar user valid tidak terblokir saat Closed Testing.

## Data yang Dicatat

Tabel baru: `registration_events`

| Field | Tujuan |
| --- | --- |
| `user_id` | Menghubungkan event dengan akun yang dibuat. |
| `normalized_phone` | Monitoring operasional dan audit nomor canonical. |
| `phone_hash` | Matching privasi-friendly untuk laporan. |
| `device_fingerprint_hash` | Deteksi 1 device banyak akun tanpa menyimpan raw ID. |
| `ip_address` | Deteksi high velocity dari IP sama. |
| `user_agent` | Indikator device/browser/app client. |
| `referral_code_used` | Deteksi referral code dipakai masif. |
| `suspicious` | Flag cepat untuk query admin. |
| `suspicious_reasons` | Alasan flag sebagai JSON. |
| `created_at` | Timestamp audit. |

Tabel baru: `abuse_flags`

| Field | Tujuan |
| --- | --- |
| `user_id` | Akun yang perlu review. |
| `registration_event_id` | Bukti event sumber flag. |
| `flag_type` | Contoh: `REGISTRATION_ABUSE_RISK`. |
| `severity` | LOW/MEDIUM/HIGH. |
| `status` | OPEN/REVIEWED/RESOLVED/DISMISSED. |
| `reason` | Alasan seperti `DEVICE_ALREADY_REGISTERED`. |
| `metadata` | Ringkasan non-secret. |

## Device Fingerprint

Backend menerima field optional:

- Body: `deviceId`
- Body: `deviceFingerprint`
- Header: `x-tapgo-device-id`
- Header: `x-tapgo-device-fingerprint`

Backend menyimpan **SHA-256 hash**, bukan raw identifier.

Jika mobile belum mengirim device ID, register tetap berjalan dan event tetap mencatat phone/IP/user-agent/referral.

## Suspicious Rules Saat Ini

| Rule | Severity | Efek |
| --- | --- | --- |
| Device fingerprint pernah dipakai akun lain | HIGH | Buat `abuse_flags`, user tetap dibuat. |
| IP sama >= 5 registrasi dalam 24 jam | MEDIUM | Buat `abuse_flags`, user tetap dibuat. |
| Referral code sama >= 10 registrasi dalam 24 jam | LOW | Buat `abuse_flags`, user tetap dibuat. |

## Rate Limit

Patch Phase 2 menambahkan:

- Auth IP/global limiter existing tetap aktif.
- Register phone limiter: maksimal 5 percobaan registrasi per normalized phone per jam.

Ini tidak memerlukan migration dan tidak mengubah business flow.

## Admin-Readable Queries

Disediakan file:

`scripts/anti-abuse-registration-monitoring.sql`

Isi query:

1. Banyak akun dari device sama.
2. Banyak akun dari IP sama.
3. Referral code dipakai berulang cepat.
4. Basic PPOB farming risk.
5. Open abuse flags.

## Privacy & Compliance

- Device raw ID tidak disimpan.
- Phone hash disimpan untuk audit.
- IP dan user agent disimpan untuk security monitoring.
- Privacy Policy/Data Safety perlu diperbarui sebelum public launch jika device fingerprint dikumpulkan dari mobile.

## Rollout Plan

1. Merge code dan migration ke branch release.
2. Jalankan migration di staging/test DB.
3. Retest register dengan/ tanpa device ID.
4. Verifikasi query read-only.
5. Update Privacy Policy/Data Safety bila device fingerprint akan dikirim mobile.
6. Setelah approval owner, deploy backend dan migrate production.

