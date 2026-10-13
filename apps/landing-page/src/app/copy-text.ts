/**
 * Menyalin teks ke papan klip dengan cadangan.
 *
 * `navigator.clipboard` tidak ada atau ditolak di sebagian peramban (peramban dalam aplikasi seperti
 * WhatsApp/Instagram, WebView, halaman tanpa izin). Cadangannya memakai kolom teks tersembunyi dan
 * `document.execCommand("copy")`, yang berjalan di dalam ketukan pengguna. Mengembalikan true bila salah
 * satu cara berhasil, supaya pemanggil dapat menampilkan pesan yang jujur saat gagal.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // jatuh ke cara cadangan di bawah
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.top = "0";
    field.style.left = "0";
    field.style.opacity = "0";
    // 16px mencegah iOS memperbesar halaman saat kolom difokuskan.
    field.style.fontSize = "16px";
    document.body.appendChild(field);
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

export const COPY_FAILED_HINT = "Tidak dapat menyalin otomatis. Tekan lama pada teksnya lalu pilih Salin.";
