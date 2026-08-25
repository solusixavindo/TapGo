part of '../main.dart';

/// Layar Ojek Online untuk penumpang.
///
/// Memakai design token, komponen loading, dan konvensi navigasi yang sudah
/// ada. Struktur Dashboard tidak diubah; entry point hanya mengarahkan ke sini.
///
/// Nol panggilan HTTP di dalam `build`. Seluruh aksi mutasi memiliki penjaga
/// single-flight, dan tidak ada exception mentah yang ditampilkan.

// ===========================================================================
// Komponen bersama
// ===========================================================================

/// Label kejujuran demo. Wajib tampil pada setiap layar saat demo aktif.
class RideDemoBadge extends StatelessWidget {
  const RideDemoBadge({super.key});

  @override
  Widget build(BuildContext context) {
    if (!tapGoRideDemoMode) {
      return const SizedBox.shrink();
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFF8A00).withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Row(
        children: [
          Icon(Icons.science_rounded, size: 16, color: Color(0xFFB45309)),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              '$tapGoRideDemoLabel — lokasi sintetis, bukan data nyata.',
              style: TextStyle(
                color: Color(0xFFB45309),
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Kartu informasi netral untuk state kosong, gagal, dan tidak tersedia.
class RideNoticeCard extends StatelessWidget {
  const RideNoticeCard({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
              color: Color(0x11000000), blurRadius: 14, offset: Offset(0, 6)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: _brandBlue, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontSize: 15.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: TextStyle(
              color: colorScheme.onSurfaceVariant,
              fontSize: 13.5,
              height: 1.4,
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                  onPressed: onAction, child: Text(actionLabel!)),
            ),
          ],
        ],
      ),
    );
  }
}

/// Tombol aksi utama dengan penjaga single-flight.
class RidePrimaryButton extends StatelessWidget {
  const RidePrimaryButton({
    super.key,
    required this.label,
    required this.isBusy,
    required this.onPressed,
  });

  final String label;
  final bool isBusy;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      // Dinonaktifkan selama permintaan berjalan: tap beruntun tidak
      // menghasilkan permintaan kedua.
      onPressed: isBusy ? null : onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: _brandBlue,
        foregroundColor: Colors.white,
        // 56 dp jauh di atas minimum 48 dp.
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      child: isBusy
          ? const _TapGoLoading(color: Colors.white)
          : Text(
              label,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
    );
  }
}

/// Satu baris label–nilai. Nilai dibungkus Expanded agar tidak meluber pada
/// layar sempit maupun saat text scaling besar.
class RideDetailRow extends StatelessWidget {
  const RideDetailRow(
      {super.key,
      required this.label,
      required this.value,
      this.emphasize = false});

  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 4,
            child: Text(
              label,
              style:
                  TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 13),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 5,
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: colorScheme.onSurface,
                fontSize: emphasize ? 16 : 13.5,
                fontWeight: emphasize ? FontWeight.w900 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ===========================================================================
// Layar 0 — gerbang: pulihkan perjalanan aktif sebelum menawarkan pemesanan
// ===========================================================================

/// Titik masuk tunggal Ojek Online.
///
/// Sebelum menawarkan pemesanan, layar ini SELALU bertanya ke server apakah
/// pengguna masih punya perjalanan berjalan. Ini yang membuat perjalanan tidak
/// hilang ketika aplikasi ditutup, process dimatikan, atau widget dibuat ulang:
/// tidak ada satu pun status perjalanan yang disimpan di perangkat, sehingga
/// tidak ada yang bisa basi. Server tetap satu-satunya sumber kebenaran.
///
/// Nol quote dan nol order dibuat di sini — layar ini hanya membaca.
class RideEntryScreen extends ConsumerStatefulWidget {
  const RideEntryScreen({
    super.key,
    required this.service,
    this.locationPort,
    this.historyRequest,
    this.quoteRequest,
    this.orderRequest,
    this.detailRequest,
    this.cancelRequest,
  });

  final RideServiceKind service;
  final LocationSelectionPort? locationPort;
  final RideHistoryRequest? historyRequest;
  final RideQuoteRequest? quoteRequest;
  final RideOrderRequest? orderRequest;
  final RideDetailRequest? detailRequest;
  final RideCancelRequest? cancelRequest;

  @override
  ConsumerState<RideEntryScreen> createState() => _RideEntryScreenState();
}

/// Hasil penyelesaian gerbang.
enum _RideEntryOutcome { loading, booking, restored, ambiguous, failed }

class _RideEntryScreenState extends ConsumerState<RideEntryScreen> {
  _RideEntryOutcome _outcome = _RideEntryOutcome.loading;
  List<RideOrderView> _activeOrders = const [];
  String? _errorMessage;
  bool _isBusy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_resolve());
  }

  Future<void> _resolve() async {
    if (_isBusy) {
      return;
    }
    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      final request = widget.historyRequest ??
          tapGoRideHistoryLoaderForTests ??
          _apiClient.rideHistory;
      final rows = await request();
      if (!mounted) {
        return;
      }
      final active = rows
          .map(RideOrderView.fromJson)
          .where((order) => order.isRestorableActive)
          .toList();
      setState(() {
        _activeOrders = active;
        _outcome = switch (active.length) {
          0 => _RideEntryOutcome.booking,
          1 => _RideEntryOutcome.restored,
          // Backend seharusnya menjamin satu perjalanan aktif per pengguna.
          // Bila ternyata lebih, memilih salah satu berarti menebak; jadi
          // gerbang berhenti dan menyerahkan pilihan kepada pengguna.
          _ => _RideEntryOutcome.ambiguous,
        };
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      if (tapGoRideIsSessionExpired(error)) {
        final outcome = await _resolveRideSessionExpired(context, ref);
        if (!mounted) {
          return;
        }
        if (outcome == TapGoSessionRefreshResult.refreshed) {
          await _resolve();
          return;
        }
        if (outcome == TapGoSessionRefreshResult.unreachable) {
          setState(() {
            _outcome = _RideEntryOutcome.failed;
            _errorMessage = 'Koneksi belum stabil. Silakan coba lagi.';
          });
        }
        return;
      }
      // Kegagalan jaringan tidak menghapus apa pun dan tidak memulai pemesanan
      // baru: pengguna diberi jalan mencoba lagi.
      setState(() {
        _outcome = _RideEntryOutcome.failed;
        _errorMessage = tapGoRideErrorMessage(error);
      });
    } finally {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    }
  }

  Widget _statusScreenFor(String reference) {
    return RideStatusScreen(
      reference: reference,
      detailRequest: widget.detailRequest,
      cancelRequest: widget.cancelRequest,
    );
  }

  @override
  Widget build(BuildContext context) {
    switch (_outcome) {
      case _RideEntryOutcome.booking:
        return RideBookingScreen(
          initialService: widget.service,
          locationPort: widget.locationPort,
          quoteRequest: widget.quoteRequest,
          orderRequest: widget.orderRequest,
          detailRequest: widget.detailRequest,
          cancelRequest: widget.cancelRequest,
        );

      case _RideEntryOutcome.restored:
        // Reference berasal dari server, bukan dari penyimpanan lokal. Layar
        // status akan memuat ulang detailnya lewat GET /rides/:reference dan
        // melanjutkan polling.
        return _statusScreenFor(_activeOrders.single.reference);

      case _RideEntryOutcome.loading:
      case _RideEntryOutcome.failed:
      case _RideEntryOutcome.ambiguous:
        return _gateScaffold(context);
    }
  }

  Widget _gateScaffold(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('TapGo ${widget.service.displayName}'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const RideDemoBadge(),
              if (_outcome == _RideEntryOutcome.loading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: _TapGoLoading(color: _brandBlue),
                  ),
                )
              else if (_outcome == _RideEntryOutcome.failed)
                RideNoticeCard(
                  icon: Icons.wifi_off_rounded,
                  title: 'Gagal memuat perjalanan',
                  message: _errorMessage ??
                      'Perjalanan belum dapat diproses. Silakan coba lagi.',
                  actionLabel: 'Coba lagi',
                  onAction: _isBusy ? null : () => unawaited(_resolve()),
                )
              else
                ..._ambiguousSection(context),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _ambiguousSection(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return [
      const RideNoticeCard(
        icon: Icons.warning_amber_rounded,
        title: 'Ada lebih dari satu perjalanan berjalan',
        message:
            'Kami tidak memilihkan secara otomatis agar tidak salah membuka. '
            'Pilih perjalanan yang ingin kamu lihat. Pemesanan baru ditutup '
            'sampai perjalanan berjalan selesai.',
      ),
      const SizedBox(height: 14),
      ..._activeOrders.map(
        (order) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: InkWell(
            onTap: () => Navigator.of(context).push(
              _tapGoPageRoute((_) => _statusScreenFor(order.reference)),
            ),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              constraints: const BoxConstraints(minHeight: 48),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: colorScheme.surface,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: colorScheme.outlineVariant),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    order.statusTitle,
                    style: TextStyle(
                      color: colorScheme.onSurface,
                      fontSize: 14.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    order.reference,
                    style: TextStyle(
                      color: colorScheme.onSurfaceVariant,
                      fontSize: 12,
                      letterSpacing: 0.4,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ];
  }
}

// ===========================================================================
// Layar 1 — pemesanan: pilih layanan, lokasi, estimasi, konfirmasi
// ===========================================================================

class RideBookingScreen extends ConsumerStatefulWidget {
  const RideBookingScreen({
    super.key,
    required this.initialService,
    this.locationPort,
    this.quoteRequest,
    this.orderRequest,
    this.detailRequest,
    this.cancelRequest,
  });

  final RideServiceKind initialService;

  /// Port lokasi. Bila null, dipilih dari flag compile-time — sehingga
  /// produksi selalu memakai adapter yang fail-closed.
  final LocationSelectionPort? locationPort;

  final RideQuoteRequest? quoteRequest;
  final RideOrderRequest? orderRequest;

  /// Diteruskan ke layar status setelah pemesanan berhasil.
  final RideDetailRequest? detailRequest;
  final RideCancelRequest? cancelRequest;

  @override
  ConsumerState<RideBookingScreen> createState() => _RideBookingScreenState();
}

class _RideBookingScreenState extends ConsumerState<RideBookingScreen> {
  late RideServiceKind _service;
  late final LocationSelectionPort _port;

  RideLocation? _pickup;
  RideLocation? _dropoff;
  RideQuoteView? _quote;

  bool _isBusy = false;
  String? _errorMessage;

  /// Kunci idempotency per percobaan. Nilainya TIDAK berubah saat percobaan
  /// ulang atas permintaan yang sama, sehingga retry tidak menggandakan order.
  String? _orderIdempotencyKey;

  @override
  void initState() {
    super.initState();
    _service = widget.initialService;
    _port = widget.locationPort ?? tapGoRideLocationPort();
  }

  bool get _providerReady => _port.status == RideLocationProviderStatus.ready;

  Future<void> _guarded(Future<void> Function() action) async {
    if (_isBusy) {
      return;
    }
    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      await action();
    } catch (error) {
      if (!mounted) {
        return;
      }
      if (tapGoRideIsSessionExpired(error)) {
        // 401 dicoba dipulihkan lewat refresh token lebih dulu; logout hanya
        // bila server menegas menolak.
        final outcome = await _resolveRideSessionExpired(context, ref);
        if (!mounted) {
          return;
        }
        if (outcome == TapGoSessionRefreshResult.refreshed) {
          try {
            await action();
          } catch (retryError) {
            if (!mounted) {
              return;
            }
            if (tapGoRideIsSessionExpired(retryError)) {
              _handleRideSessionExpired(context, ref);
              return;
            }
            setState(() => _errorMessage = tapGoRideErrorMessage(retryError));
          }
          return;
        }
        if (outcome == TapGoSessionRefreshResult.unreachable) {
          setState(
            () => _errorMessage = 'Koneksi belum stabil. Silakan coba lagi.',
          );
        }
        return;
      }
      setState(() => _errorMessage = tapGoRideErrorMessage(error));
    } finally {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    }
  }

  Future<void> _requestQuote() {
    return _guarded(() async {
      final pickup = _pickup;
      final dropoff = _dropoff;
      if (pickup == null || dropoff == null) {
        setState(() => _errorMessage = 'Pilih lokasi jemput dan tujuan dulu.');
        return;
      }
      if (pickup.id == dropoff.id) {
        setState(
            () => _errorMessage = 'Lokasi jemput dan tujuan tidak boleh sama.');
        return;
      }

      final request = widget.quoteRequest ?? _apiClient.createRideQuote;
      final data = await request(
        serviceType: _service.apiValue,
        pickup: pickup.toJson(),
        dropoff: dropoff.toJson(),
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _quote = RideQuoteView.fromJson(data);
        // Percobaan pemesanan baru dimulai: kunci baru dibuat sekali di sini.
        _orderIdempotencyKey =
            'ride-order-${DateTime.now().microsecondsSinceEpoch}';
      });
    });
  }

  Future<void> _confirmOrder() {
    return _guarded(() async {
      final quote = _quote;
      if (quote == null) {
        return;
      }
      if (quote.isExpired) {
        setState(() {
          _quote = null;
          _errorMessage = 'Estimasi sudah kedaluwarsa. Silakan cek harga lagi.';
        });
        return;
      }

      final request = widget.orderRequest ?? _apiClient.createRideOrder;
      final data = await request(
        quoteId: quote.quoteId,
        // Kunci yang sama dipakai ulang bila pengguna mencoba lagi.
        idempotencyKey: _orderIdempotencyKey,
      );
      if (!mounted) {
        return;
      }
      final order = RideOrderView.fromJson(data);
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => RideStatusScreen(
            reference: order.reference,
            initialOrder: order,
            detailRequest: widget.detailRequest,
            cancelRequest: widget.cancelRequest,
          ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text('TapGo ${_service.displayName}'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Riwayat perjalanan',
            icon: const Icon(Icons.receipt_long_rounded),
            onPressed: () => Navigator.of(context).push(
              _tapGoPageRoute((_) => const RideHistoryScreen()),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const RideDemoBadge(),
              _serviceSelector(colorScheme),
              const SizedBox(height: 18),
              if (!_providerReady)
                const RideNoticeCard(
                  icon: Icons.location_off_rounded,
                  title: tapGoRideLocationUnavailableMessage,
                  message:
                      'Pemesanan belum dapat dilanjutkan karena penyedia lokasi '
                      'belum terpasang. Kami tidak menggunakan lokasi perkiraan.',
                )
              else ...[
                _locationPicker(
                  colorScheme,
                  title: 'Titik jemput',
                  icon: Icons.my_location_rounded,
                  selected: _pickup,
                  onSelected: (value) => setState(() {
                    _pickup = value;
                    _quote = null;
                  }),
                ),
                const SizedBox(height: 12),
                _locationPicker(
                  colorScheme,
                  title: 'Tujuan',
                  icon: Icons.flag_rounded,
                  selected: _dropoff,
                  onSelected: (value) => setState(() {
                    _dropoff = value;
                    _quote = null;
                  }),
                ),
                const SizedBox(height: 18),
                RidePrimaryButton(
                  label: 'Cek Harga',
                  isBusy: _isBusy,
                  onPressed: _requestQuote,
                ),
                if (_quote != null) ...[
                  const SizedBox(height: 18),
                  _quoteCard(colorScheme, _quote!),
                ],
              ],
              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                RideNoticeCard(
                  icon: Icons.error_outline_rounded,
                  title: 'Belum berhasil',
                  message: _errorMessage!,
                  actionLabel: _providerReady ? 'Coba lagi' : null,
                  onAction: _providerReady ? _requestQuote : null,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _serviceSelector(ColorScheme colorScheme) {
    return Row(
      children: RideServiceKind.values.map((kind) {
        final selected = kind == _service;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(
                right: kind == RideServiceKind.motorcycle ? 10 : 0),
            child: InkWell(
              onTap: _isBusy
                  ? null
                  : () => setState(() {
                        _service = kind;
                        _quote = null;
                      }),
              borderRadius: BorderRadius.circular(16),
              child: Container(
                constraints: const BoxConstraints(minHeight: 56),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                decoration: BoxDecoration(
                  color: selected
                      ? _brandBlue.withValues(alpha: 0.10)
                      : colorScheme.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: selected ? _brandBlue : colorScheme.outlineVariant,
                    width: selected ? 1.6 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(kind.icon,
                        size: 22,
                        color: selected
                            ? _brandBlue
                            : colorScheme.onSurfaceVariant),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        kind.displayName,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: selected ? _brandBlue : colorScheme.onSurface,
                          fontSize: 14.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _locationPicker(
    ColorScheme colorScheme, {
    required String title,
    required IconData icon,
    required RideLocation? selected,
    required ValueChanged<RideLocation> onSelected,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
              color: Color(0x11000000), blurRadius: 12, offset: Offset(0, 5)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: _brandBlue),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          InkWell(
            onTap: _isBusy
                ? null
                : () async {
                    final picked = await RideLocationPickerSheet.show(
                      context,
                      port: _port,
                      title: title,
                      initial: selected,
                    );
                    if (picked != null) onSelected(picked);
                  },
            borderRadius: BorderRadius.circular(14),
            child: Container(
              constraints: const BoxConstraints(minHeight: 56),
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: colorScheme.outlineVariant),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      selected?.label ?? 'Pilih di peta atau cari alamat…',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: selected == null
                            ? colorScheme.onSurfaceVariant
                            : colorScheme.onSurface,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Icon(Icons.map_outlined,
                      size: 20, color: colorScheme.onSurfaceVariant),
                ],
              ),
            ),
          ),
          if (selected != null) ...[
            const SizedBox(height: 10),
            Text(
              selected.address,
              style: TextStyle(
                  color: colorScheme.onSurfaceVariant, fontSize: 12.5),
            ),
          ],
        ],
      ),
    );
  }

  Widget _quoteCard(ColorScheme colorScheme, RideQuoteView quote) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
              color: Color(0x14000000), blurRadius: 16, offset: Offset(0, 7)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Estimasi perjalanan',
            style: TextStyle(
              color: colorScheme.onSurface,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          RideDetailRow(label: 'Jenis layanan', value: _service.displayName),
          RideDetailRow(label: 'Jemput', value: _pickup?.label ?? '-'),
          RideDetailRow(label: 'Tujuan', value: _dropoff?.label ?? '-'),
          RideDetailRow(
              label: 'Jarak',
              value: tapGoFormatRideDistance(quote.distanceMeters)),
          RideDetailRow(
              label: 'Estimasi durasi',
              value: tapGoFormatRideDuration(quote.durationSeconds)),
          RideDetailRow(
              label: 'ETA driver',
              value: tapGoFormatRideDuration(quote.etaSeconds)),
          const Divider(height: 22),
          RideDetailRow(
              label: 'Tarif dasar',
              value: tapGoFormatRideRupiah(quote.baseFare)),
          RideDetailRow(
              label: 'Tarif jarak',
              value: tapGoFormatRideRupiah(quote.distanceFare)),
          RideDetailRow(
              label: 'Biaya layanan',
              value: tapGoFormatRideRupiah(quote.serviceFee)),
          const Divider(height: 22),
          RideDetailRow(
            label: 'Total estimasi',
            value: tapGoFormatRideRupiah(quote.totalFare),
            emphasize: true,
          ),
          const SizedBox(height: 6),
          Text(
            'Tarif dihitung server TapGo. Pembayaran tunai kepada driver.',
            style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 12),
          ),
          if (quote.expiresAt != null) ...[
            const SizedBox(height: 4),
            Text(
              quote.isExpired
                  ? 'Estimasi sudah kedaluwarsa.'
                  : 'Estimasi berlaku sampai ${_formatClock(quote.expiresAt!)}.',
              style: TextStyle(
                color: quote.isExpired
                    ? const Color(0xFFB3261E)
                    : colorScheme.onSurfaceVariant,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          const SizedBox(height: 16),
          RidePrimaryButton(
            label: 'Pesan Sekarang',
            isBusy: _isBusy,
            onPressed: quote.isExpired ? null : _confirmOrder,
          ),
        ],
      ),
    );
  }
}

String _formatClock(DateTime value) {
  final local = value.toLocal();
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}

/// Menangani sesi tidak sah dengan konvensi logout yang sudah ada.
///
/// Tidak mengubah implementasi Auth Session Persistence — hanya memakai jalur
/// pembersihan yang sama dengan logout manual, lalu mengembalikan pengguna ke
/// AuthScreen dengan pesan yang jujur.
void _handleRideSessionExpired(BuildContext context, WidgetRef ref) {
  _apiClient.setAccessToken(null);
  unawaited(_persistentStore.clearSession());
  ref.read(_demoSessionProvider.notifier).state = DemoClientSession.initial();
  ref.read(_isAuthenticatedProvider.notifier).state = false;

  if (!context.mounted) {
    return;
  }
  Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
    _tapGoPageRoute((_) => const AuthScreen()),
    (_) => false,
  );
  _TapGoSnackbar.warning(
    context,
    'Sesi kamu sudah berakhir. Silakan masuk kembali.',
  );
}

/// Gerbang pemulihan sesi untuk alur ride ketika server menjawab 401.
///
/// Access token hanya hidup ~15 menit, jadi 401 belum berarti sesi mati:
/// refresh token dicoba lebih dulu. Hasil:
/// - `refreshed`  -> token baru aktif, pemanggil BOLEH mengulang aksinya;
/// - `unreachable`-> jaringan/5xx, sesi DIPERTAHANKAN, tampilkan pesan
///   "koneksi belum stabil" (pengguna tidak dipaksa login ulang);
/// - `rejected`   -> server menegas menolak (dicabut / ganti password),
///   baru di sinilah logout dipaksa lewat [_handleRideSessionExpired].
Future<TapGoSessionRefreshResult> _resolveRideSessionExpired(
  BuildContext context,
  WidgetRef ref,
) async {
  final refreshToken = ref.read(_demoSessionProvider).refreshToken ?? '';
  final (result, refreshed) = await _apiClient.refreshSession(refreshToken);
  if (result == TapGoSessionRefreshResult.refreshed && refreshed != null) {
    _apiClient.setAccessToken(refreshed.accessToken);
    final next = ref.read(_demoSessionProvider).copyWith(
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        );
    ref.read(_demoSessionProvider.notifier).state = next;
    unawaited(_persistentStore.saveSession(next));
    return result;
  }
  if (result == TapGoSessionRefreshResult.rejected && context.mounted) {
    _handleRideSessionExpired(context, ref);
  }
  return result;
}

// ===========================================================================
// Layar 2 — status perjalanan
// ===========================================================================

class RideStatusScreen extends ConsumerStatefulWidget {
  const RideStatusScreen({
    super.key,
    required this.reference,
    this.initialOrder,
    this.pollInterval = const Duration(seconds: 4),
    this.autoStart = true,
    this.detailRequest,
    this.cancelRequest,
  });

  final String reference;
  final RideOrderView? initialOrder;
  final Duration pollInterval;

  /// Test merender layar tanpa menyalakan polling.
  final bool autoStart;

  final RideDetailRequest? detailRequest;
  final RideCancelRequest? cancelRequest;

  @override
  ConsumerState<RideStatusScreen> createState() => _RideStatusScreenState();
}

class _RideStatusScreenState extends ConsumerState<RideStatusScreen>
    with WidgetsBindingObserver {
  RideStatusPoller? _poller;
  RideOrderView? _order;
  String? _errorMessage;
  bool _isCancelling = false;

  @override
  void initState() {
    super.initState();
    _order = widget.initialOrder;
    WidgetsBinding.instance.addObserver(this);
    if (widget.autoStart) {
      _poller = RideStatusPoller(
        reference: widget.reference,
        interval: widget.pollInterval,
        fetch: widget.detailRequest ?? tapGoRideDetailLoaderForTests,
        onUpdate: (order) {
          if (mounted) {
            setState(() {
              _order = order;
              _errorMessage = null;
            });
          }
        },
        onError: (error) {
          if (!mounted) {
            return;
          }
          if (tapGoRideIsSessionExpired(error)) {
            // Poller berjalan berkala: bila refresh berhasil, tick berikutnya
            // otomatis memakai token baru; bila jaringan putus sesi dijaga;
            // logout hanya bila server menolak refresh token.
            unawaited(_resolveRideSessionExpired(context, ref).then((outcome) {
              if (!mounted) {
                return;
              }
              if (outcome == TapGoSessionRefreshResult.unreachable) {
                setState(() => _errorMessage =
                    'Koneksi belum stabil. Silakan coba lagi.');
              }
            }));
            return;
          }
          setState(() => _errorMessage = tapGoRideErrorMessage(error));
        },
      )..start();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // Polling berhenti bersama widget: tidak ada timer yang menggantung.
    _poller?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final poller = _poller;
    if (poller == null) {
      return;
    }
    if (state == AppLifecycleState.resumed) {
      // start() sendiri sudah menembak satu permintaan langsung sebelum memulai
      // timer berkala, jadi resume menghasilkan TEPAT satu refresh. Memanggil
      // refreshNow() di sini akan bergantung pada penjaga overlap untuk
      // meredam permintaan kedua — dan benar karena kebetulan bukan jaminan.
      poller.start();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      poller.pause();
    }
  }

  Future<void> _cancel(String reasonCode, String? note) async {
    if (_isCancelling) {
      return;
    }
    setState(() {
      _isCancelling = true;
      _errorMessage = null;
    });
    try {
      final request = widget.cancelRequest ?? _apiClient.cancelRide;
      final data = await request(
        reference: widget.reference,
        reasonCode: reasonCode,
        note: note,
      );
      if (!mounted) {
        return;
      }
      final order = RideOrderView.fromJson(data);
      setState(() => _order = order);
      if (order.isFinal) {
        _poller?.stop();
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      if (tapGoRideIsSessionExpired(error)) {
        final outcome = await _resolveRideSessionExpired(context, ref);
        if (!mounted) {
          return;
        }
        if (outcome == TapGoSessionRefreshResult.refreshed) {
          await _cancel(reasonCode, note);
          return;
        }
        if (outcome == TapGoSessionRefreshResult.unreachable) {
          setState(() => _errorMessage =
              'Koneksi belum stabil. Silakan coba lagi.');
        }
        return;
      }
      setState(() => _errorMessage = tapGoRideErrorMessage(error));
    } finally {
      if (mounted) {
        setState(() => _isCancelling = false);
      }
    }
  }

  Future<void> _openCancelSheet() async {
    final choice = await showModalBottomSheet<RideCancellationChoice>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => const RideCancellationSheet(),
    );
    if (choice != null) {
      await _cancel(choice.reasonCode, choice.note);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final order = _order;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Perjalanan'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const RideDemoBadge(),
              // Spinner hanya ditampilkan selama memang masih memuat. Bila
              // pemuatan pertama gagal, yang tampil adalah kartu error di
              // bawah — bukan spinner yang berputar tanpa akhir.
              if (order == null && _errorMessage == null)
                const Center(
                    child: Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: _TapGoLoading(color: _brandBlue),
                ))
              else if (order != null) ...[
                _statusCard(colorScheme, order),
                const SizedBox(height: 14),
                if (order.phase == RideUiPhase.searching ||
                    order.phase == RideUiPhase.created)
                  _searchingCard(colorScheme),
                if (order.driver != null && order.vehicle != null) ...[
                  _driverCard(colorScheme, order.driver!, order.vehicle!),
                  const SizedBox(height: 14),
                ],
                _tripCard(colorScheme, order),
                if (order.canCancel) ...[
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      // Penjaga single-flight: tap beruntun tidak mengirim dua
                      // permintaan pembatalan.
                      onPressed: _isCancelling ? null : _openCancelSheet,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                      ),
                      child: _isCancelling
                          ? const _TapGoLoading(color: _brandBlue)
                          : const Text('Batalkan perjalanan'),
                    ),
                  ),
                ],
                if (order.isFinal) ...[
                  const SizedBox(height: 16),
                  RidePrimaryButton(
                    label: 'Kembali ke Dashboard',
                    isBusy: false,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ],
              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                RideNoticeCard(
                  icon: Icons.wifi_off_rounded,
                  title: 'Gagal memuat status',
                  message: _errorMessage!,
                  actionLabel: 'Coba lagi',
                  onAction: () =>
                      unawaited(_poller?.refreshNow() ?? Future.value()),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusCard(ColorScheme colorScheme, RideOrderView order) {
    final isUnknown = order.phase == RideUiPhase.unknown;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isUnknown
            ? const Color(0x14B3261E)
            : _brandBlue.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            order.statusTitle,
            style: TextStyle(
              color:
                  isUnknown ? const Color(0xFFB3261E) : colorScheme.onSurface,
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Kode perjalanan ${order.reference}',
            style:
                TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 12.5),
          ),
        ],
      ),
    );
  }

  Widget _searchingCard(ColorScheme colorScheme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          const _TapGoLoading(color: _brandBlue),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              'Menghubungkan dengan driver terdekat…',
              style: TextStyle(
                  color: colorScheme.onSurfaceVariant, fontSize: 13.5),
            ),
          ),
        ],
      ),
    );
  }

  /// Kartu driver — TEPAT sesuai kontrak frozen R2.4A.
  ///
  /// Nol rating, nol nomor telepon, nol tombol chat/telepon, nol UUID internal.
  /// Plat ditampilkan apa adanya dari server yang sudah me-masking-nya.
  Widget _driverCard(
    ColorScheme colorScheme,
    RideDriverView driver,
    RideVehicleView vehicle,
  ) {
    final descriptor = [
      vehicle.serviceType == 'CAR' ? 'Mobil' : 'Motor',
      if (vehicle.model != null) vehicle.model!,
      if (vehicle.color != null) vehicle.color!,
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
              color: Color(0x11000000), blurRadius: 14, offset: Offset(0, 6)),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: _brandBlue.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.person_rounded, color: _brandBlue),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  driver.displayName,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontSize: 15.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  descriptor,
                  style: TextStyle(
                      color: colorScheme.onSurfaceVariant, fontSize: 12.5),
                ),
                const SizedBox(height: 6),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    vehicle.maskedPlate,
                    style: TextStyle(
                      color: colorScheme.onSurface,
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.6,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _tripCard(ColorScheme colorScheme, RideOrderView order) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
              color: Color(0x11000000), blurRadius: 14, offset: Offset(0, 6)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          RideDetailRow(label: 'Jemput', value: order.pickupAddress),
          RideDetailRow(label: 'Tujuan', value: order.dropoffAddress),
          RideDetailRow(
              label: 'Jarak',
              value: tapGoFormatRideDistance(order.distanceMeters)),
          RideDetailRow(
              label: 'Durasi',
              value: tapGoFormatRideDuration(order.durationSeconds)),
          const Divider(height: 22),
          RideDetailRow(
            label: order.phase == RideUiPhase.completed
                ? 'Total dibayar'
                : 'Estimasi total',
            value: tapGoFormatRideRupiah(order.totalFare),
            emphasize: true,
          ),
          if (order.cancellationReason != null) ...[
            const Divider(height: 22),
            RideDetailRow(
              label: 'Alasan',
              value: tapGoRideCancellationReasons[order.cancellationReason] ??
                  'Dibatalkan',
            ),
            if ((order.cancellationFee ?? 0) > 0)
              RideDetailRow(
                label: 'Biaya pembatalan',
                value: tapGoFormatRideRupiah(order.cancellationFee!),
              ),
          ],
          const SizedBox(height: 6),
          Text(
            'Pembayaran tunai kepada driver.',
            style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

// ===========================================================================
// Lembar alasan pembatalan
// ===========================================================================

/// Lembar pemilihan alasan pembatalan.
///
/// Alasan hanya berasal dari [tapGoRideCancellationReasons] — cermin allowlist
/// backend. Tidak ada field bebas untuk kode alasan, sehingga mustahil
/// mengirim kode yang tidak dikenal server.
class RideCancellationSheet extends StatefulWidget {
  const RideCancellationSheet({super.key});

  @override
  State<RideCancellationSheet> createState() => _RideCancellationSheetState();
}

class _RideCancellationSheetState extends State<RideCancellationSheet> {
  String? _reasonCode;
  final _noteController = TextEditingController();

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  void _submit() {
    final code = _reasonCode;
    if (code == null) {
      return;
    }
    final note = _noteController.text.trim();
    Navigator.of(context).pop(
      RideCancellationChoice(
        reasonCode: code,
        note: note.isEmpty ? null : note,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          // Menyisakan ruang untuk keyboard saat catatan diisi.
          bottom: 20 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Alasan pembatalan',
                style: TextStyle(
                  color: colorScheme.onSurface,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 12),
              ...tapGoRideCancellationReasons.entries.map((entry) {
                final selected = _reasonCode == entry.key;
                return ListTile(
                  minTileHeight: 48,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    selected
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_unchecked_rounded,
                    color: selected ? _brandBlue : colorScheme.outline,
                  ),
                  title: Text(entry.value),
                  onTap: () => setState(() => _reasonCode = entry.key),
                );
              }),
              const SizedBox(height: 8),
              TextField(
                controller: _noteController,
                maxLines: 3,
                // Batas keras mengikuti validator backend, sehingga catatan
                // panjang ditolak di sini alih-alih menjadi error 400.
                maxLength: tapGoRideCancellationNoteMaxLength,
                decoration: const InputDecoration(
                  labelText: 'Catatan (opsional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                // Nonaktif sampai satu alasan dari allowlist dipilih.
                onPressed: _reasonCode == null ? null : _submit,
                style: FilledButton.styleFrom(
                  backgroundColor: _brandBlue,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(52),
                ),
                child: const Text('Kirim pembatalan'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ===========================================================================
// Layar 3 — riwayat
// ===========================================================================

class RideHistoryScreen extends ConsumerStatefulWidget {
  const RideHistoryScreen({super.key, this.initialItems, this.historyRequest});

  /// Diisi test agar dapat merender tanpa jaringan.
  final List<RideOrderView>? initialItems;

  final RideHistoryRequest? historyRequest;

  @override
  ConsumerState<RideHistoryScreen> createState() => _RideHistoryScreenState();
}

class _RideHistoryScreenState extends ConsumerState<RideHistoryScreen> {
  List<RideOrderView>? _items;
  String? _errorMessage;
  bool _isBusy = false;

  @override
  void initState() {
    super.initState();
    _items = widget.initialItems;
    if (widget.initialItems == null) {
      unawaited(_load());
    }
  }

  Future<void> _load() async {
    if (_isBusy) {
      return;
    }
    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      final request = widget.historyRequest ?? _apiClient.rideHistory;
      final rows = await request();
      if (!mounted) {
        return;
      }
      setState(() => _items = rows.map(RideOrderView.fromJson).toList());
    } catch (error) {
      if (!mounted) {
        return;
      }
      if (tapGoRideIsSessionExpired(error)) {
        final outcome = await _resolveRideSessionExpired(context, ref);
        if (!mounted) {
          return;
        }
        if (outcome == TapGoSessionRefreshResult.refreshed) {
          await _load();
          return;
        }
        if (outcome == TapGoSessionRefreshResult.unreachable) {
          setState(() => _errorMessage =
              'Koneksi belum stabil. Silakan coba lagi.');
        }
        return;
      }
      setState(() => _errorMessage = tapGoRideErrorMessage(error));
    } finally {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final items = _items;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Riwayat Perjalanan'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const RideDemoBadge(),
              if (_errorMessage != null)
                RideNoticeCard(
                  icon: Icons.wifi_off_rounded,
                  title: 'Gagal memuat riwayat',
                  message: _errorMessage!,
                  actionLabel: 'Coba lagi',
                  onAction: _load,
                )
              else if (items == null)
                const Center(
                    child: Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: _TapGoLoading(color: _brandBlue),
                ))
              else if (items.isEmpty)
                const RideNoticeCard(
                  icon: Icons.receipt_long_rounded,
                  title: 'Belum ada perjalanan',
                  message: 'Perjalanan yang kamu pesan akan muncul di sini.',
                )
              else
                ...items.map((order) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: colorScheme.surface,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: const [
                            BoxShadow(
                                color: Color(0x11000000),
                                blurRadius: 12,
                                offset: Offset(0, 5)),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    order.statusTitle,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: colorScheme.onSurface,
                                      fontSize: 14.5,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  tapGoFormatRideRupiah(order.totalFare),
                                  style: TextStyle(
                                    color: colorScheme.onSurface,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${order.pickupAddress} → ${order.dropoffAddress}',
                              style: TextStyle(
                                color: colorScheme.onSurfaceVariant,
                                fontSize: 12.5,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              order.reference,
                              style: TextStyle(
                                color: colorScheme.onSurfaceVariant,
                                fontSize: 11.5,
                                letterSpacing: 0.4,
                              ),
                            ),
                          ],
                        ),
                      ),
                    )),
            ],
          ),
        ),
      ),
    );
  }
}
