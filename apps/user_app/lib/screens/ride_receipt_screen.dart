part of '../main.dart';

/// Detail dan struk perjalanan dari riwayat, dengan "Pesan lagi" ke rute yang
/// sama dan salin ringkasan. Semua isi berasal dari data server yang sudah
/// dimuat; layar ini tidak memanggil jaringan.
class RideReceiptScreen extends StatelessWidget {
  const RideReceiptScreen({super.key, required this.order});

  final RideOrderView order;

  bool get _isCar => order.serviceType == 'CAR';

  String get _serviceLabel => _isCar ? 'Ojek Mobil' : 'Ojek Motor';

  String get _paymentLabel => order.isDigitalPayment ? 'TapGoPay' : 'Tunai';

  String get _distanceLabel =>
      '${(order.distanceMeters / 1000).toStringAsFixed(1).replaceAll('.', ',')} km';

  String get _durationLabel => '${(order.durationSeconds / 60).round()} menit';

  String get _dateLabel => tapGoActivityDateLabel(order.createdAt);

  /// Ringkasan teks untuk disalin/dibagikan. Tanpa data driver.
  String get summary {
    final buffer = StringBuffer()
      ..writeln('TapGo $_serviceLabel • $_dateLabel')
      ..writeln('Dari: ${order.pickupAddress}')
      ..writeln('Ke: ${order.dropoffAddress}')
      ..writeln('Jarak $_distanceLabel • $_durationLabel');
    if (order.phase == RideUiPhase.completed) {
      buffer.writeln(
        'Tarif ${tapGoFormatRideRupiah(order.totalFare)} ($_paymentLabel)',
      );
    } else {
      buffer.writeln(order.statusTitle);
    }
    buffer.write('Kode: ${order.reference}');
    return buffer.toString();
  }

  void _reorder(BuildContext context) {
    RideLocation place(String id, String address, double lat, double lng) {
      final short = address.split(',').first.trim();
      return RideLocation(
        id: id,
        label: short.isEmpty ? address : short,
        address: address,
        lat: lat,
        lng: lng,
      );
    }

    Navigator.of(context).push(
      _tapGoPageRoute(
        (_) => RideBookingScreen(
          initialService:
              _isCar ? RideServiceKind.car : RideServiceKind.motorcycle,
          initialPickup: place(
            'reorder-pickup',
            order.pickupAddress,
            order.pickupLat!,
            order.pickupLng!,
          ),
          initialDropoff: place(
            'reorder-dropoff',
            order.dropoffAddress,
            order.dropoffLat!,
            order.dropoffLng!,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final completed = order.phase == RideUiPhase.completed;
    final cancelled = order.phase == RideUiPhase.cancelled;
    final accent = cancelled ? const Color(0xFFB3261E) : _brandBlue;
    final driver = order.driver;
    final vehicle = order.vehicle;
    final reason = order.cancellationReason;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Struk Perjalanan'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: accent.withValues(alpha: 0.14),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        completed
                            ? Icons.check_circle_rounded
                            : cancelled
                                ? Icons.cancel_rounded
                                : (_isCar
                                    ? Icons.local_taxi_rounded
                                    : Icons.two_wheeler_rounded),
                        color: accent,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            order.statusTitle,
                            style: TextStyle(
                              color: scheme.onSurface,
                              fontSize: 17,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '$_serviceLabel • $_dateLabel',
                            style: TextStyle(
                              color: scheme.onSurfaceVariant,
                              fontSize: 12.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _card(scheme, [
                _routePoint(
                  scheme,
                  icon: Icons.circle,
                  color: _brandBlue,
                  title: 'Titik jemput',
                  address: order.pickupAddress,
                  showLine: true,
                ),
                _routePoint(
                  scheme,
                  icon: Icons.flag_rounded,
                  color: const Color(0xFFFF8A00),
                  title: 'Tujuan',
                  address: order.dropoffAddress,
                  showLine: false,
                ),
              ]),
              const SizedBox(height: 14),
              _card(scheme, [
                RideDetailRow(label: 'Jarak', value: _distanceLabel),
                RideDetailRow(label: 'Durasi', value: _durationLabel),
                RideDetailRow(label: 'Pembayaran', value: _paymentLabel),
                if (completed)
                  RideDetailRow(
                    label: 'Tarif',
                    value: tapGoFormatRideRupiah(order.totalFare),
                    emphasize: true,
                  ),
                if (cancelled && (order.cancellationFee ?? 0) > 0)
                  RideDetailRow(
                    label: 'Biaya pembatalan',
                    value: tapGoFormatRideRupiah(order.cancellationFee!),
                  ),
                if (cancelled && reason != null && reason.isNotEmpty)
                  RideDetailRow(
                    label: 'Alasan',
                    value: tapGoRideCancellationReasons[reason] ?? reason,
                  ),
                RideDetailRow(label: 'Kode perjalanan', value: order.reference),
              ]),
              if (driver != null) ...[
                const SizedBox(height: 14),
                _card(scheme, [
                  RideDetailRow(label: 'Driver', value: driver.displayName),
                  if (vehicle != null)
                    RideDetailRow(
                      label: 'Kendaraan',
                      value: [
                        if ((vehicle.model ?? '').isNotEmpty) vehicle.model!,
                        if ((vehicle.color ?? '').isNotEmpty) vehicle.color!,
                        vehicle.maskedPlate,
                      ].join(' • '),
                    ),
                ]),
              ],
              const SizedBox(height: 18),
              if (order.hasRouteCoordinates)
                RidePrimaryButton(
                  label: 'Pesan lagi',
                  isBusy: false,
                  onPressed: () => _reorder(context),
                ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: summary));
                  if (context.mounted) {
                    _TapGoHaptic.light();
                    _TapGoSnackbar.success(context, 'Ringkasan disalin.');
                  }
                },
                icon: const Icon(Icons.copy_rounded),
                label: const Text('Salin ringkasan'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(50),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _card(ColorScheme scheme, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(children: children),
    );
  }

  Widget _routePoint(
    ColorScheme scheme, {
    required IconData icon,
    required Color color,
    required String title,
    required String address,
    required bool showLine,
  }) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 24,
            child: Column(
              children: [
                Icon(icon, size: icon == Icons.circle ? 12 : 20, color: color),
                if (showLine)
                  Expanded(
                    child: Container(width: 2, color: scheme.outlineVariant),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: showLine ? 14 : 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: scheme.onSurfaceVariant,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    address,
                    style: TextStyle(
                      color: scheme.onSurface,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
