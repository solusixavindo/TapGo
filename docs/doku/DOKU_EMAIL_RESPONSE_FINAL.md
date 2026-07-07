# Draft Email Response to DOKU

**To:** care@doku.com  
**Subject:** Klarifikasi Flow Bisnis dan Layanan DOKU - PT TAPGO LION INDONESIA - Ticket #1101182

Kepada Tim DOKU,

Terima kasih atas informasi dan permintaan klarifikasi terkait proses verifikasi merchant PT TAPGO LION INDONESIA untuk ticket #1101182.

Bersama email ini kami lampirkan dokumen **TapGo Merchant Verification Book - Business Flow & Payment Gateway Clarification** sebagai jawaban resmi atas poin yang diminta.

Secara ringkas, berikut klarifikasi dari kami:

1. **Flow bisnis TapGo**  
   Customer melakukan registrasi atau login ke aplikasi TapGo, memilih paket membership digital, masuk ke halaman checkout, sistem membuat invoice, lalu customer menekan tombol bayar dan diarahkan ke halaman pembayaran DOKU. Setelah pembayaran berhasil, DOKU mengirim payment notification/webhook ke backend TapGo. Backend TapGo memverifikasi pembayaran, mengubah invoice menjadi PAID, mengaktifkan membership, dan mengaktifkan benefit sesuai paket.

2. **Layanan DOKU yang digunakan**  
   TapGo menggunakan **DOKU Checkout** sebagai payment gateway utama. Customer diarahkan ke hosted payment page DOKU. Metode pembayaran yang ingin digunakan meliputi Virtual Account, QRIS, E-Wallet, Bank Transfer, serta Payment Link / Checkout Page apabila tersedia.

3. **Target pengguna TapGo**  
   Target pengguna TapGo adalah masyarakat umum pengguna aplikasi mobile, calon member TapGo, komunitas, mitra, dan pengguna layanan digital seperti membership, wallet, referral, PPOB, dan layanan digital TapGo lainnya.

4. **Status aplikasi TapGo**  
   Aplikasi TapGo saat ini berada pada tahap pre-production / release preparation. Google Play production release sedang disiapkan setelah verifikasi payment gateway dan production readiness selesai. Website resmi TapGo dapat diakses melalui https://tapgolion.id.

Sebagai tambahan, PT TAPGO LION INDONESIA siap memberikan akses demo/UAT apabila dibutuhkan oleh Tim DOKU untuk proses review lebih lanjut.

Demikian klarifikasi dari kami. Terima kasih atas bantuan dan arahan dari Tim DOKU.

Hormat kami,

**PT TAPGO LION INDONESIA**  
Ahmad Zulhi  
Direktur  
support@tapgolion.id  
https://tapgolion.id
