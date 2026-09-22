import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

export const DRIVER_FACE_EMBEDDING_MODEL_UNAVAILABLE = "DRIVER_FACE_EMBEDDING_MODEL_UNAVAILABLE";

/**
 * Versi model embedding yang harus SAMA PERSIS dengan yang dibundel di
 * driver_app (lihat face_check_pipeline.dart) — embedding dari model berbeda
 * tidak sebanding secara matematis, jadi perubahan versi ini HARUS dirilis
 * berbarengan dengan update aplikasi yang membundel model barunya.
 */
export const DRIVER_FACE_EMBEDDING_MODEL_VERSION = "mobilefacenet-v1";

/**
 * Menghasilkan vektor embedding wajah dari byte gambar swafoto.
 *
 * BELUM DIIMPLEMENTASIKAN. Ini fail-closed dengan sengaja, bukan placeholder
 * yang "kelihatan jalan": menjalankan model embedding di server (Node)
 * membutuhkan runtime inferensi ML (mis. onnxruntime-node atau TFLite Node
 * binding) dan berkas model dengan lisensi yang sudah dipastikan boleh
 * diredistribusikan — keduanya BELUM ada di repo ini dan tidak aman ditebak
 * begitu saja. DriverFaceCheckService dan DriverApplicationService.approve()
 * sudah dikabelkan memanggil computeEmbedding() di titik yang benar; begitu
 * runtime dan berkas model tersedia, satu-satunya yang perlu diganti adalah
 * isi method ini.
 *
 * Selama method ini melempar, DRIVER_FACE_CHECK_ENABLED HARUS tetap false —
 * approve() akan gagal (lihat pemanggilnya) daripada diam-diam menyimpan
 * profil driver tanpa referensi wajah.
 */
export class DriverFaceEmbeddingService {
  computeEmbedding(_imageBytes: Buffer): Promise<Float32Array> {
    return Promise.reject(
      new AppError(
        "Model embedding wajah belum dikonfigurasi di server.",
        StatusCodes.SERVICE_UNAVAILABLE,
        DRIVER_FACE_EMBEDDING_MODEL_UNAVAILABLE
      )
    );
  }
}
