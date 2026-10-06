/**
 * Menyiapkan foto sebelum diunggah.
 *
 * Latar belakang (laporan pengguna 6 Okt 2026: "Failed to fetch" saat Lanjut ke
 * Pembayaran): server membatasi badan permintaan 1 MB di lapisan nginx, dan
 * foto kamera ponsel hampir selalu 2-8 MB. Permintaan yang melewati batas itu
 * ditolak nginx dengan halaman 413 TANPA header CORS, sehingga peramban hanya
 * melaporkan "Failed to fetch" — tanpa kode, tanpa petunjuk.
 *
 * Karena itu foto diperkecil di peramban: sisi terpanjang dibatasi, dikodekan
 * ulang sebagai JPEG, dan kualitas diturunkan bertahap sampai muat. Foto yang
 * sudah kecil tidak disentuh. Hasilnya tetap terbaca untuk KTP (1600 px).
 */

/** Batas badan unggahan di server (nginx bawaan 1 MB) dikurangi ruang aman. */
export const UPLOAD_TARGET_BYTES = 900 * 1024;

/** Batas ukuran berkas ASLI yang masih dicoba didekode (melindungi memori ponsel). */
export const RAW_IMAGE_LIMIT_BYTES = 25 * 1024 * 1024;

const MAX_EDGE_START = 1600;
const MIN_EDGE = 640;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg"];

export class ImagePrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePrepError";
  }
}

/** Ukuran baru dengan sisi terpanjang <= maxEdge; tidak pernah memperbesar. */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" menghormati orientasi EXIF: foto potret dari kamera tidak
      // boleh berubah menjadi miring setelah dikodekan ulang.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Jatuh ke jalur <img> di bawah.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url)
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImagePrepError("Foto tidak dapat dibaca. Coba pilih foto lain (JPG atau PNG).");
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function jpegName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "foto";
  return `${base}.jpg`;
}

/**
 * Mengembalikan berkas yang pasti muat di batas unggahan. Berkas yang sudah
 * cukup kecil dikembalikan apa adanya (objek yang sama).
 */
export async function prepareImageForUpload(
  file: File,
  targetBytes: number = UPLOAD_TARGET_BYTES
): Promise<File> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new ImagePrepError("Foto harus berformat JPG atau PNG.");
  }
  if (file.size <= targetBytes) return file;
  if (file.size > RAW_IMAGE_LIMIT_BYTES) {
    throw new ImagePrepError("Ukuran foto terlalu besar (maksimal 25 MB). Pilih foto lain.");
  }

  const decoded = await decode(file);
  try {
    let edge = MAX_EDGE_START;
    for (;;) {
      const size = fitWithin(decoded.width, decoded.height, edge);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new ImagePrepError("Foto tidak dapat diproses di peramban ini.");
      // JPEG tidak punya transparansi: PNG transparan dialasi putih, bukan hitam.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(decoded.source, 0, 0, size.width, size.height);

      for (const quality of QUALITIES) {
        const blob = await toBlob(canvas, quality);
        if (blob && blob.size <= targetBytes) {
          return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
        }
      }
      if (edge <= MIN_EDGE) break;
      edge = Math.max(MIN_EDGE, Math.round(edge * 0.8));
    }
  } finally {
    decoded.release();
  }
  throw new ImagePrepError("Foto tidak dapat diperkecil cukup kecil. Coba foto lain.");
}
