part of '../../../main.dart';

/// Unggah dokumen verifikasi mitra.
///
/// Keputusan Owner: berkas disimpan di server paling lama 24 jam, lalu admin
/// mencetaknya sebagai berkas administrasi dan isinya dihapus. Layar ini
/// menyampaikan hal itu apa adanya — termasuk hitungan mundurnya — supaya
/// driver tahu berkasnya tidak menumpuk di server tanpa batas waktu.
class DriverDocumentsSection extends ConsumerStatefulWidget {
  const DriverDocumentsSection({super.key});

  @override
  ConsumerState<DriverDocumentsSection> createState() =>
      _DriverDocumentsSectionState();
}

class _DriverDocumentsSectionState
    extends ConsumerState<DriverDocumentsSection> {
  final ImagePicker _picker = ImagePicker();

  @override
  void initState() {
    super.initState();
    // Dijadwalkan setelah frame pertama: memodifikasi state provider saat build
    // sedang berjalan akan dilempar Riverpod sebagai galat.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(driverControllerProvider.notifier).refreshDocuments();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(driverControllerProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _DocumentsHeader(),
        const SizedBox(height: 12),
        for (final kind in DriverDocumentKind.values) ...[
          _DocumentCard(
            kind: kind,
            summary: state.documentOf(kind),
            busy: state.uploadingDocument == kind,
            onPick: () => _pick(kind),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  Future<void> _pick(DriverDocumentKind kind) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_rounded),
              title: const Text('Ambil foto'),
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Pilih dari galeri'),
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    try {
      final picked = await _picker.pickImage(
        source: source,
        // Dikecilkan sebelum dikirim. Batas server 5 MB, dan foto ponsel modern
        // dengan mudah melewatinya — menolak di server setelah menghabiskan
        // kuota data driver adalah cara terburuk menyampaikan batas itu.
        imageQuality: 82,
        maxWidth: 1600,
      );
      if (!mounted) return;
      if (picked == null) return;

      final bytes = await picked.readAsBytes();
      if (!mounted) return;

      final contentType = _contentTypeFor(picked.name, bytes);
      if (contentType == null) {
        _notify('Berkas harus berupa foto JPG atau PNG.');
        return;
      }

      await ref.read(driverControllerProvider.notifier).uploadDocument(
            kind: kind,
            bytes: bytes,
            contentType: contentType,
          );
    } on MissingPluginException {
      _notify('Fitur kamera belum tersedia di perangkat ini.');
    } on PlatformException catch (error) {
      // Izin ditolak adalah kejadian normal, bukan kerusakan. Pesannya
      // menyebutkan jalan keluarnya alih-alih menampilkan kode galat.
      _notify(
        error.code == 'camera_access_denied' ||
                error.code == 'photo_access_denied'
            ? 'Izin akses kamera atau galeri belum diberikan. Aktifkan lewat pengaturan perangkat.'
            : 'Foto gagal diambil. Silakan coba lagi.',
      );
    } catch (_) {
      _notify('Foto gagal diambil. Silakan coba lagi.');
    }
  }

  void _notify(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

/// Menentukan content-type dari BYTE PERTAMA berkas, bukan dari namanya.
///
/// Nama berkas dapat menyesatkan, dan server memang memeriksa magic byte lalu
/// menolak yang tidak cocok. Memeriksanya lebih dulu di sini membuat penolakan
/// terjadi sebelum data terkirim, bukan sesudah.
String? _contentTypeFor(String name, Uint8List bytes) {
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4e &&
      bytes[3] == 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff) {
    return 'image/jpeg';
  }
  return null;
}

class _DocumentsHeader extends StatelessWidget {
  const _DocumentsHeader();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF061A2F),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.verified_user_rounded,
                  color: Color(0xFFFFC857), size: 20),
              SizedBox(width: 8),
              Text(
                'Dokumen Verifikasi',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
            ],
          ),
          SizedBox(height: 8),
          Text(
            'Berkas Anda dienkripsi dan otomatis dihapus dari server paling '
            'lama 24 jam setelah diunggah. Dalam rentang itu tim kami '
            'mencetaknya sebagai berkas administrasi.',
            style: TextStyle(color: Color(0xFF9DB3C9), fontSize: 12.5, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _DocumentCard extends StatelessWidget {
  const _DocumentCard({
    required this.kind,
    required this.summary,
    required this.busy,
    required this.onPick,
  });

  final DriverDocumentKind kind;
  final DriverDocumentSummary? summary;
  final bool busy;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    final review = summary?.review ?? DriverDocumentReview.notSubmitted;
    final remaining = summary?.remaining(DateTime.now());

    return Container(
      key: ValueKey('document-card-${kind.api}'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE3E9F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  kind.label,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                    color: Color(0xFF061A2F),
                  ),
                ),
              ),
              _ReviewChip(review: review),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            kind.hint,
            style: const TextStyle(fontSize: 12.5, color: Color(0xFF697386)),
          ),
          if (remaining != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.schedule_rounded,
                    size: 14, color: Color(0xFF697386)),
                const SizedBox(width: 6),
                // Expanded WAJIB: teksnya tumbuh mengikuti sisa waktu
                // ("6 jam 59 menit") dan tanpa batasan ini barisnya meluber
                // sampai 166 piksel di layar 390 dp.
                Expanded(
                  child: Text(
                    'Dihapus otomatis dalam ${_formatRemaining(remaining)}',
                    style: const TextStyle(
                        fontSize: 12, color: Color(0xFF697386)),
                  ),
                ),
              ],
            ),
          ],
          if (summary != null && !summary!.available) ...[
            const SizedBox(height: 8),
            const Text(
              'Berkas sudah dihapus sesuai kebijakan 24 jam. Unggah ulang bila '
              'tim kami memintanya.',
              style: TextStyle(fontSize: 12, color: Color(0xFF697386)),
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              key: ValueKey('document-upload-${kind.api}'),
              onPressed: busy ? null : onPick,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFFFC857),
                foregroundColor: const Color(0xFF061A2F),
                disabledBackgroundColor: const Color(0xFFE0AE3F),
                disabledForegroundColor: const Color(0xFF061A2F),
              ),
              icon: busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Color(0xFF061A2F)),
                    )
                  : const Icon(Icons.upload_rounded, size: 18),
              label: Text(
                busy
                    ? 'Mengirim…'
                    : summary == null
                        ? 'Unggah ${kind.label}'
                        : 'Ganti ${kind.label}',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReviewChip extends StatelessWidget {
  const _ReviewChip({required this.review});
  final DriverDocumentReview review;

  @override
  Widget build(BuildContext context) {
    late final String text;
    late final Color background;
    late final Color foreground;

    switch (review) {
      case DriverDocumentReview.approved:
        text = 'Disetujui';
        background = const Color(0xFFDCFCE7);
        foreground = const Color(0xFF166534);
      case DriverDocumentReview.rejected:
        text = 'Ditolak';
        background = const Color(0xFFFEE2E2);
        foreground = const Color(0xFF991B1B);
      case DriverDocumentReview.pending:
        text = 'Diperiksa';
        background = const Color(0xFFFEF3C7);
        foreground = const Color(0xFF92400E);
      case DriverDocumentReview.notSubmitted:
        text = 'Belum ada';
        background = const Color(0xFFEAF0F6);
        foreground = const Color(0xFF697386);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
          color: foreground,
        ),
      ),
    );
  }
}

String _formatRemaining(Duration value) {
  if (value.inMinutes < 1) return 'kurang dari satu menit';
  if (value.inHours < 1) return '${value.inMinutes} menit';
  final hours = value.inHours;
  final minutes = value.inMinutes % 60;
  return minutes == 0 ? '$hours jam' : '$hours jam $minutes menit';
}
