part of '../main.dart';

/// Lapisan peta: posisi pengguna secara langsung — titik biru dengan cincin
/// putih dan lingkaran akurasi (skala meter), seperti Gojek/Grab.
///
/// Dipasang sebagai anak [FlutterMap]. Mengikuti aliran posisi dari
/// [LiveLocationSource]; bila port tidak menyediakan aliran (mode demo, izin
/// ditolak, GPS mati) lapisan ini tidak menggambar apa pun.
class TapGoUserLocationLayer extends StatefulWidget {
  const TapGoUserLocationLayer({super.key, required this.source});

  final Object source;

  @override
  State<TapGoUserLocationLayer> createState() => _TapGoUserLocationLayerState();
}

class _TapGoUserLocationLayerState extends State<TapGoUserLocationLayer> {
  StreamSubscription<RideLocationFix>? _subscription;
  RideLocationFix? _fix;

  @override
  void initState() {
    super.initState();
    final source = widget.source;
    if (source is LiveLocationSource) {
      _subscription = source.watchPosition().listen(
        (fix) {
          if (mounted) setState(() => _fix = fix);
        },
        onError: (_) {},
        cancelOnError: false,
      );
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fix = _fix;
    if (fix == null) {
      return const SizedBox.shrink();
    }
    final point = LatLng(fix.lat, fix.lng);
    const blue = Color(0xFF2563EB);
    return Stack(
      key: const ValueKey('tapgo-user-location'),
      children: [
        // Lingkar akurasi dalam meter; dibatasi agar tidak menutupi seluruh peta
        // saat sinyal GPS buruk.
        CircleLayer(
          circles: [
            CircleMarker(
              point: point,
              radius: fix.accuracyMeters.clamp(6, 250).toDouble(),
              useRadiusInMeter: true,
              color: blue.withValues(alpha: 0.14),
              borderColor: blue.withValues(alpha: 0.35),
              borderStrokeWidth: 1,
            ),
          ],
        ),
        MarkerLayer(
          markers: [
            Marker(
              point: point,
              width: 24,
              height: 24,
              child: Container(
                decoration: BoxDecoration(
                  color: blue,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 3),
                  boxShadow: const [
                    BoxShadow(color: Color(0x55000000), blurRadius: 4),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Tombol kecil "i" untuk atribusi peta. Lisensi OpenStreetMap mewajibkan
/// atribusi tetap dapat dicapai; di peta ia disembunyikan di balik satu ketukan
/// alih-alih teks permanen di atas peta.
class TapGoMapAttributionButton extends StatelessWidget {
  const TapGoMapAttributionButton({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Atribusi peta',
      child: GestureDetector(
        key: const ValueKey('tapgo-map-attribution'),
        behavior: HitTestBehavior.opaque,
        onTap: () => showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Atribusi peta'),
            content: const Text('Data peta $tapGoOsmAttribution.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Tutup'),
              ),
            ],
          ),
        ),
        child: Container(
          width: 22,
          height: 22,
          margin: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.85),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.info_outline_rounded,
              size: 15, color: Color(0xFF475569)),
        ),
      ),
    );
  }
}
