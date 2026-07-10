# Mobile Device Fingerprint Plan

Tanggal: 17 Juni 2026

Scope: rencana implementasi mobile agar backend Phase 2 Anti-Abuse bisa menerima device signal. Dokumen ini tidak mengubah aplikasi mobile dan tidak build APK/AAB.

## Tujuan

Membantu backend mendeteksi:

- 1 device membuat banyak akun.
- Registrasi massal dari perangkat sama.
- Referral farming dari perangkat/IP yang sama.
- Reinstall app untuk klaim ulang benefit.

Pendekatan awal: **monitoring only**, bukan hard block.

## A. Data yang Dikirim Mobile

| Data | Wajib/Opsional | Catatan |
| --- | --- | --- |
| `deviceId` atau generated installId | Recommended | UUID random per install, bukan IMEI/serial |
| `deviceFingerprint` hash | Recommended | Bisa hash gabungan installId + app namespace |
| App version | Recommended | Contoh `1.0.0+12` |
| Platform | Recommended | `android` |
| Device model | Optional | Untuk risk analytics, jangan terlalu detail |
| OS version | Optional | Untuk risk analytics |
| FCM token | Optional | Jika push notification aktif |

## B. Privacy & Compliance

Larangan:

- Jangan kirim IMEI.
- Jangan kirim serial number.
- Jangan kirim Android ID raw jika tidak perlu.
- Jangan kirim data sensitif perangkat.
- Jangan gunakan fingerprint untuk tracking iklan.

Prinsip:

- Gunakan generated UUID per install.
- Simpan di `flutter_secure_storage`.
- Hash sebelum disimpan backend.
- Jelaskan di Privacy Policy/Data Safety sebagai security/fraud prevention.
- Jika user hapus akun, data operasional tertentu tetap bisa disimpan sesuai kebutuhan audit/legal.

## C. Flutter Implementation Plan

1. Saat first launch:
   - Cek secure storage key `tapgo_install_id`.
   - Jika belum ada, buat UUID v4.
   - Simpan di `flutter_secure_storage`.

2. Buat fingerprint:
   - `deviceFingerprint = sha256("tapgo:" + installId)`
   - Jangan pakai IMEI/serial.

3. Kirim header di semua auth request:

```text
X-TapGo-Device-Id: <installId>
X-TapGo-Device-Fingerprint: <hash>
X-TapGo-App-Version: <version>
X-TapGo-Platform: android
```

4. Tambahkan ke body register jika lebih mudah:

```json
{
  "phone": "081234567890",
  "password": "...",
  "deviceId": "<installId>",
  "deviceFingerprint": "<hash>"
}
```

5. Jangan blokir user jika header belum ada.
   - Backend sudah optional.
   - Missing device hanya mengurangi akurasi monitoring.

## D. Backend Integration

Status backend:

- Sudah menerima optional `deviceId`.
- Sudah menerima optional `deviceFingerprint`.
- Sudah menerima optional header `x-tapgo-device-id`.
- Sudah menerima optional header `x-tapgo-device-fingerprint`.
- `RegistrationEvent` menyimpan device hash.
- `AbuseFlag` dibuat jika device/IP/referral pattern suspicious.
- Query admin tersedia di `scripts/anti-abuse-registration-monitoring.sql`.

## E. Rollout Plan

### Phase 1 — Monitoring Only

- Mobile kirim install ID/fingerprint.
- Backend hanya flag suspicious.
- Tidak ada auto-block.
- Admin review manual.

### Phase 2 — Warning / Manual Review

- Tampilkan internal admin warning untuk device multi-account.
- Hold withdrawal untuk flagged account jika SOP disetujui.
- Review referral farm sebelum payout besar.

### Phase 3 — Hard Block

Hanya setelah data real cukup:

- Block device dengan abuse confirmed.
- Limit registrasi per device.
- Require OTP/KYC tambahan untuk flagged account.

## F. Testing Plan

| Test | Expected |
| --- | --- |
| 1 device 1 akun | Register sukses, no flag |
| 1 device 2 akun | Register sukses, abuse flag HIGH |
| Nomor sama beda format | Tidak bisa duplicate; normalized phone mendeteksi |
| Referral self-loop | Ditolak |
| Banyak registrasi IP sama | Abuse flag MEDIUM setelah threshold |
| Reinstall app | Install ID berubah; masih bisa dimonitor dengan IP/referral velocity |
| Ganti device | Device hash berbeda; no device duplicate flag |
| Header tidak dikirim | Register tetap sukses, event tanpa device hash |

## Rekomendasi Sebelum Public Launch

1. Implement mobile install ID.
2. Update Privacy Policy/Data Safety.
3. Deploy backend anti-abuse setelah migration sequence direview.
4. Jalankan query monitoring setiap hari selama 2 minggu pertama public launch.

