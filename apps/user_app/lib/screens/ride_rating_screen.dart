part of '../main.dart';

/// Halaman penilaian penuh yang langsung dibuka begitu perjalanan selesai (gaya
/// aplikasi ojek): bintang besar, tag cepat, catatan opsional, Kirim dan Lewati.
/// Kembali dengan [RideRatingView] (terkirim atau menunggu dikirim) atau null
/// bila dilewati.
class RideRatingScreen extends ConsumerStatefulWidget {
  const RideRatingScreen({
    super.key,
    required this.order,
    this.request,
  });

  final RideOrderView order;

  /// Pengirim penilaian; null = API sungguhan.
  final RideRatingRequest? request;

  @override
  ConsumerState<RideRatingScreen> createState() => _RideRatingScreenState();
}

class _RideRatingScreenState extends ConsumerState<RideRatingScreen> {
  int _stars = 0;
  final _tags = <String>{};
  final _noteController = TextEditingController();
  bool _sending = false;
  String? _error;

  static const _starLabels = ['', 'Buruk', 'Kurang', 'Cukup', 'Baik', 'Luar biasa!'];

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  void _pickStars(int stars) {
    if (_sending) return;
    _TapGoHaptic.tap();
    setState(() {
      // Tag positif dan keluhan berbeda: berganti kelompok mengosongkan pilihan.
      if ((_stars >= 4) != (stars >= 4)) _tags.clear();
      _stars = stars;
    });
  }

  Future<void> _submit() async {
    if (_stars < 1 || _sending) return;
    final note = tapGoComposeRatingNote(_tags, _noteController.text);
    setState(() {
      _sending = true;
      _error = null;
    });
    final reference = widget.order.reference;
    try {
      final send = widget.request ?? _apiClient.rateRide;
      final data = await send(reference: reference, stars: _stars, note: note);
      if (!mounted) return;
      _TapGoHaptic.success();
      Navigator.of(context).pop(
        RideRatingView.fromJson(data) ?? RideRatingView(stars: _stars, note: note),
      );
    } catch (error) {
      if (!mounted) return;
      switch (tapGoRatingFailureOf(error)) {
        case TapGoRatingFailure.alreadyDone:
          // Sudah dinilai (mis. dari perangkat lain): layar status mengambil
          // penilaian tersimpan dari server.
          Navigator.of(context).pop(RideRatingView(stars: _stars, note: note));
        case TapGoRatingFailure.retryLater:
        case TapGoRatingFailure.sessionExpired:
          // Server belum dapat menerimanya sekarang: simpan di perangkat dan
          // kirim otomatis. Penumpang tidak melihat galat.
          await _pendingRatingsStore.enqueue(
            TapGoPendingRating(reference: reference, stars: _stars, note: note),
          );
          if (!mounted) return;
          Navigator.of(context).pop(
            RideRatingView(stars: _stars, note: note, pending: true),
          );
        case TapGoRatingFailure.drop:
          setState(() {
            _sending = false;
            _error = tapGoRatingErrorMessage(error);
          });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final order = widget.order;
    final driverName = order.driver?.displayName;
    final tags = tapGoRatingTags(_stars);
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          TextButton(
            key: const ValueKey('rating-skip'),
            onPressed: _sending ? null : () => Navigator.of(context).pop(),
            child: const Text('Lewati'),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                width: 64,
                height: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFF16A34A).withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.check_rounded, size: 36, color: Color(0xFF16A34A)),
              ),
              const SizedBox(height: 14),
              Text(
                'Perjalanan selesai',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colorScheme.onSurface,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                formatRupiah(order.totalFare),
                key: const ValueKey('rating-fare'),
                textAlign: TextAlign.center,
                style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 15),
              ),
              const SizedBox(height: 28),
              if (driverName != null) ...[
                CircleAvatar(
                  radius: 34,
                  backgroundColor: _brandBlue.withValues(alpha: 0.12),
                  child: const Icon(Icons.person_rounded, size: 38, color: _brandBlue),
                ),
                const SizedBox(height: 10),
                Text(
                  driverName,
                  key: const ValueKey('rating-driver'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 20),
              ],
              Text(
                'Bagaimana perjalananmu?',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colorScheme.onSurface,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var star = 1; star <= 5; star++)
                    IconButton(
                      key: ValueKey('rating-star-$star'),
                      tooltip: '$star bintang',
                      onPressed: _sending ? null : () => _pickStars(star),
                      iconSize: 44,
                      icon: Icon(
                        star <= _stars ? Icons.star_rounded : Icons.star_outline_rounded,
                        color: star <= _stars
                            ? const Color(0xFFF59E0B)
                            : colorScheme.outline,
                      ),
                    ),
                ],
              ),
              SizedBox(
                height: 24,
                child: Text(
                  _starLabels[_stars],
                  key: const ValueKey('rating-label'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              if (tags.isNotEmpty) ...[
                const SizedBox(height: 14),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final tag in tags)
                      FilterChip(
                        key: ValueKey('rating-tag-$tag'),
                        label: Text(tag),
                        selected: _tags.contains(tag),
                        onSelected: _sending
                            ? null
                            : (on) => setState(() => on ? _tags.add(tag) : _tags.remove(tag)),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              TextField(
                key: const ValueKey('rating-note'),
                controller: _noteController,
                enabled: !_sending,
                maxLength: 200,
                maxLines: 2,
                decoration: const InputDecoration(
                  hintText: 'Tulis catatan untuk driver (opsional)',
                  border: OutlineInputBorder(),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 4),
                Text(
                  _error!,
                  key: const ValueKey('rating-error'),
                  style: const TextStyle(color: Color(0xFFB3261E), fontSize: 13),
                ),
              ],
              const SizedBox(height: 12),
              FilledButton(
                key: const ValueKey('rating-submit'),
                onPressed: _stars == 0 || _sending ? null : _submit,
                style: FilledButton.styleFrom(
                  backgroundColor: _brandBlue,
                  minimumSize: const Size.fromHeight(52),
                ),
                child: _sending
                    ? const _TapGoLoading(size: 18, strokeWidth: 2)
                    : const Text('Kirim penilaian'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
