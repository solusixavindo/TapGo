/**
 * QRIS resmi perusahaan: TAPGO LION INDO TRANS (NMID ID1026632896191), QRIS statis (tanpa nominal) penyelenggara BRI.
 * Berkas gambar `public/images/qris-tapgo.jpeg` adalah lembar QRIS asli yang diberikan Owner (sha256 diawali 09a7834a);
 * isi QR-nya sudah dibaca ulang dan checksum EMV-nya valid. Jangan diganti dengan QR buatan sendiri.
 *
 * Karena statis, pembayar mengetik nominalnya sendiri: nominal TEPAT (termasuk kode unik) itulah yang dicocokkan admin
 * dengan mutasi QRIS sebelum mengonfirmasi.
 */
export const OFFICIAL_QRIS = {
  imageSrc: "/images/qris-tapgo.jpeg",
  merchantName: "TAPGO LION INDO TRANS",
  nmid: "ID1026632896191"
} as const;
