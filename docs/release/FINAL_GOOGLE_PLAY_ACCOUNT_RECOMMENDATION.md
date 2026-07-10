# Final Google Play Account Recommendation

Tanggal: 2026-06-18  
Aplikasi: TapGo  
Package: `id.tapgolion.tapgo`

## 1. Final Decision

| Keputusan | Status |
|---|---:|
| ROOT CAUSE CONFIRMED | **CONFIRMED** |
| ORGANIZATION MIGRATION | **GO** |
| Recommended strategy | **Convert/correct current account to Organization first** |
| Transfer to new Organization account | **Fallback only** |
| Build/deploy needed now | **NO** |

## 2. Root Cause

Penolakan v3 hampir pasti terjadi karena TapGo diklasifikasikan sebagai app dengan financial products/services, sementara akun developer saat ini kemungkinan Personal.

Google secara eksplisit menyatakan dalam rejection:

> Financial products and services require organization accounts.

TapGo memiliki fitur:

- Paid membership.
- Wallet.
- PPOB.
- Referral commission.
- Sponsor bonus.
- Level bonus.
- Withdrawal payout.
- Midtrans payment.
- Profit sharing.

Fitur tersebut cukup untuk membuat reviewer mengklasifikasikan TapGo sebagai financial services/financial feature app.

## 3. Rekomendasi Operasional

### Langkah 1 — Jangan upload ulang dulu

Jangan upload AAB baru sebelum account issue selesai. Reupload tanpa memperbaiki account type kemungkinan akan ditolak lagi.

### Langkah 2 — Cek account type

Masuk Play Console sebagai account owner:

- Developer account
- Account details / About you
- Developer profile
- Cek Personal vs Organization

### Langkah 3 — Hubungi Play Support

Pesan yang disarankan:

```text
Hello Google Play Support,

Our app TapGo (package: id.tapgolion.tapgo) was rejected with the message:
"Financial products and services require organization accounts."

TapGo is owned and operated by PT TAPGO LION INDONESIA. We would like to comply with the Play Console Requirements by using an Organization developer account.

Please advise whether our current developer account can be converted/corrected to an Organization account, or whether we must create a new Organization account and transfer the app.

We prefer to keep the current app/package and closed testing continuity if possible.
```

### Langkah 4 — Siapkan Organization data

- D-U-N-S number.
- Legal name PT TAPGO LION INDONESIA.
- Legal address.
- Organization phone.
- Website `https://tapgolion.id`.
- Official email.
- Google Payments profile organization.
- Contact person.

### Langkah 5 — Perbaiki App Content

Sebelum resubmit:

1. Financial features declaration lengkap.
2. Data Safety lengkap.
3. App access credential.
4. Payment disclosure.
5. Store listing wording aman.
6. Account deletion instruction.
7. Content rating konsisten.

## 4. Recommended App Content Positioning

Gunakan posisi:

> TapGo adalah platform membership digital yang menyediakan membership benefit, wallet aplikasi, PPOB benefit, referral reward sesuai syarat, dan pembayaran membership melalui payment gateway.

Hindari posisi:

- investment app;
- lending app;
- guaranteed profit app;
- passive income app;
- MLM/money game app;
- crypto/trading app.

## 5. Transfer Decision

### Preferred: Current account menjadi Organization

**GO**

Paling aman untuk:

- Closed Testing.
- Tester opt-in.
- Package continuity.
- Release history.
- Midtrans document continuity.

### Fallback: New Organization account + transfer

**GO only if required by Google**

Risiko:

- Closed testing groups tidak ikut transfer.
- Tester mungkin perlu opt-in ulang.
- Integrated services perlu relink.
- Reports tertentu tidak ikut transfer.

## 6. Launch Impact

| Area | Impact | Action |
|---|---:|---|
| Closed Testing | Bisa lanjut setelah account issue fix | Jangan transfer kecuali perlu |
| Production Access | Tertahan sampai account dan App Content compliant | Organization verification |
| Midtrans Approval | Tetap lanjut, tapi update jika developer account berubah | Simpan dokumen package/app |
| Public Launch | NO-GO sampai Google account issue selesai | Re-submit setelah Organization |

## 7. Recommended Next Actions

1. Confirm account type di Play Console.
2. Jika Personal, buka Play Support ticket untuk convert/correct ke Organization.
3. Siapkan D-U-N-S dan data legal PT.
4. Audit ulang Financial features declaration.
5. Audit ulang Data Safety.
6. Isi App access credential untuk reviewer.
7. Setelah Organization verified, resubmit v3 atau build berikutnya.

## 8. Final Recommendation

**ORGANIZATION MIGRATION GO.**

Strategi final:

1. **Utamakan konversi/koreksi akun saat ini menjadi Organization.**
2. **Jangan buat app baru.**
3. **Transfer app ke akun Organization baru hanya jika Google menyatakan akun saat ini tidak bisa dikonversi.**
4. **Jangan upload ulang AAB sebelum account type dan Financial declaration selesai.**

## 9. Konfirmasi Scope

- Tidak deploy.
- Tidak build APK/AAB.
- Tidak mengubah source code.
- Tidak membuat migration database.
- Tidak menyentuh production DB.
- Hanya audit, analisis, dan dokumen.

