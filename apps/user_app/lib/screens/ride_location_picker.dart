part of '../main.dart';

/// Lembar pemilih lokasi ride: pencarian alamat (Nominatim) + pin tengah yang
/// diam sementara peta digeser di bawahnya (manual pin dropper, seperti
/// Grab/Gojek) + tombol lokasi saat ini.
///
/// Port-agnostik: semua panggilan geocoding lewat [LocationSelectionPort],
/// sehingga mode demo memakai data sintetis tanpa menyentuh jaringan.
class RideLocationPickerSheet extends StatefulWidget {
  const RideLocationPickerSheet({
    super.key,
    required this.port,
    required this.title,
    this.initial,
    this.near,
  });

  final LocationSelectionPort port;
  final String title;
  final RideLocation? initial;

  /// Titik acuan untuk membatasi hasil pencarian (mis. titik jemput yang
  /// sudah dipilih, saat sheet ini dibuka untuk mencari tujuan) DAN sebagai
  /// titik awal pin sebelum pengguna menggeser peta.
  final RideLocation? near;

  static Future<RideLocation?> show(
    BuildContext context, {
    required LocationSelectionPort port,
    required String title,
    RideLocation? initial,
    RideLocation? near,
  }) {
    return showModalBottomSheet<RideLocation>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => RideLocationPickerSheet(
        port: port,
        title: title,
        initial: initial,
        near: near,
      ),
    );
  }

  @override
  State<RideLocationPickerSheet> createState() =>
      _RideLocationPickerSheetState();
}

class _RideLocationPickerSheetState extends State<RideLocationPickerSheet> {
  static const _defaultCenter = LatLng(-6.1754, 106.8272); // Jakarta
  static const _tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  final _searchController = TextEditingController();
  final _mapController = MapController();
  Timer? _debounce;
  Timer? _centerDebounce;

  List<RideAddressCandidate> _results = const [];
  RideAddressCandidate? _selected;
  bool _searching = false;
  bool _locating = false;
  bool _resolvingCenter = false;
  bool _userMovedMap = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    final near = widget.near;
    if (initial != null) {
      _selected = RideAddressCandidate(
        label: initial.label,
        address: initial.address,
        lat: initial.lat,
        lng: initial.lng,
      );
    } else if (near != null) {
      _selected = RideAddressCandidate(
        label: near.label,
        address: near.address,
        lat: near.lat,
        lng: near.lng,
      );
    } else {
      // Belum ada acuan sama sekali (mis. field Jemput dibuka duluan) — pin
      // tampil dulu di titik default sambil menunggu GPS terakhir, supaya
      // "Pakai lokasi ini" tidak nonaktif menunggu jaringan.
      _selected = RideAddressCandidate(
        label: 'Titik pilihan',
        address: 'Geser peta untuk memilih titik jemput/tujuan',
        lat: _defaultCenter.latitude,
        lng: _defaultCenter.longitude,
      );
      unawaited(_recenterToFallbackNear());
    }
  }

  /// Pindah otomatis ke GPS terakhir HANYA bila pengguna belum menggeser peta
  /// sendiri — laporan Owner: field Jemput masih menampilkan daerah jauh dari
  /// user karena sebelumnya tidak ada acuan sama sekali di kasus ini.
  Future<void> _recenterToFallbackNear() async {
    final location = await widget.port.lastKnownLocation();
    if (!mounted || location == null || _userMovedMap) {
      return;
    }
    _moveMap(LatLng(location.lat, location.lng), 15);
    await _resolveCenter(LatLng(location.lat, location.lng));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _centerDebounce?.cancel();
    _searchController.dispose();
    _mapController.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), () => _search(value));
  }

  Future<void> _search(String query) async {
    if (query.trim().length < 3) {
      setState(() => _results = const []);
      return;
    }
    setState(() {
      _searching = true;
      _notice = null;
    });
    final results = await widget.port.searchAddress(
      query,
      near: widget.near ?? _selected?.toRideLocation(),
    );
    if (!mounted) return;
    setState(() {
      _searching = false;
      _results = results;
      _notice = results.isEmpty ? 'Alamat tidak ditemukan. Coba kata kunci lain.' : null;
    });
  }

  Future<void> _useCurrentLocation() async {
    setState(() {
      _locating = true;
      _notice = null;
    });
    final location = await widget.port.currentLocation();
    if (!mounted) return;
    setState(() {
      _locating = false;
      if (location == null) {
        _notice =
            'Lokasi perangkat tidak tersedia. Periksa izin lokasi dan GPS.';
        return;
      }
      _userMovedMap = true;
      _notice = null;
    });
    if (location != null) {
      _selectAndCenter(
        RideAddressCandidate(
          label: location.label,
          address: location.address,
          lat: location.lat,
          lng: location.lng,
        ),
      );
    }
  }

  void _pickCandidate(RideAddressCandidate candidate) {
    _userMovedMap = true;
    _selectAndCenter(candidate);
  }

  void _selectAndCenter(RideAddressCandidate candidate, {double zoom = 16}) {
    setState(() {
      _selected = candidate;
      _results = const [];
    });
    _moveMap(LatLng(candidate.lat, candidate.lng), zoom);
  }

  /// Reverse-geocode titik tengah peta saat ini — dipanggil setelah pin
  /// (diam di tengah layar) berhenti bergerak karena peta digeser pengguna.
  Future<void> _resolveCenter(LatLng point) async {
    setState(() => _resolvingCenter = true);
    final address = await widget.port.reverseAddress(
      point.latitude,
      point.longitude,
    );
    if (!mounted) return;
    setState(() {
      _resolvingCenter = false;
      _selected = RideAddressCandidate(
        label: address != null ? _shortLabelForUi(address) : 'Titik pilihan',
        address: address ??
            'Koordinat ${point.latitude.toStringAsFixed(5)}, '
                '${point.longitude.toStringAsFixed(5)}',
        lat: point.latitude,
        lng: point.longitude,
      );
    });
  }

  /// Dipicu tiap kamera peta bergerak. Hanya gerakan dari GESTURE pengguna
  /// (geser jari) yang memicu reverse-geocode — perpindahan programatik
  /// (mis. dari memilih hasil pencarian) sudah punya alamat sendiri, tidak
  /// perlu ditimpa.
  void _onMapPositionChanged(MapCamera camera, bool hasGesture) {
    if (!hasGesture) return;
    _userMovedMap = true;
    _centerDebounce?.cancel();
    _centerDebounce = Timer(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      unawaited(_resolveCenter(_mapController.camera.center));
    });
  }

  /// Pin jemput hijau, pin tujuan merah — beda jelas dari titik biru posisi pengguna.
  Color get _pinColor => widget.title.toLowerCase().contains('jemput')
      ? const Color(0xFF16A34A)
      : const Color(0xFFEC3F54);

  void _moveMap(LatLng center, double zoom) {
    try {
      _mapController.move(center, zoom);
    } catch (_) {
      // Controller belum siap (peta belum dirender) — aman diabaikan.
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final media = MediaQuery.of(context);
    final height = media.size.height * 0.92;
    final selected = _selected;
    return SizedBox(
      height: height,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 10),
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: const TextStyle(
                        fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                ),
                IconButton(
                  tooltip: 'Tutup',
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _searchController,
              onChanged: _onQueryChanged,
              textInputAction: TextInputAction.search,
              onSubmitted: _search,
              decoration: InputDecoration(
                hintText: 'Cari alamat atau nama tempat…',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Bersihkan',
                        icon: const Icon(Icons.clear_rounded),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _results = const []);
                        },
                      ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(
              onPressed: _locating ? null : _useCurrentLocation,
              icon: _locating
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.my_location_rounded),
              label: Text(_locating ? 'Mencari lokasi…' : 'Gunakan lokasi saya'),
            ),
          ),
          if (_notice != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(
                _notice!,
                style: TextStyle(
                    color: colorScheme.onSurfaceVariant, fontSize: 12.5),
              ),
            ),
          const SizedBox(height: 8),
          Expanded(
            child: Stack(
              children: [
                if (_results.isNotEmpty)
                  ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    itemCount: _results.length,
                    itemBuilder: (_, index) {
                      final candidate = _results[index];
                      return ListTile(
                        leading: const Icon(Icons.place_outlined),
                        title: Text(
                          candidate.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        subtitle: Text(
                          candidate.address,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12),
                        ),
                        onTap: () => _pickCandidate(candidate),
                      );
                    },
                  )
                else ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: FlutterMap(
                      mapController: _mapController,
                      options: MapOptions(
                        initialCenter: selected != null
                            ? LatLng(selected.lat, selected.lng)
                            : _defaultCenter,
                        initialZoom: 16,
                        onPositionChanged: _onMapPositionChanged,
                      ),
                      children: [
                        TileLayer(
                          urlTemplate: _tileUrl,
                          userAgentPackageName: 'com.xavindo.tapgo',
                        ),
                        // Titik biru posisi pengguna + lingkar akurasi.
                        TapGoUserLocationLayer(source: widget.port),
                      ],
                    ),
                  ),
                  // Atribusi peta (OSM) — di balik satu ketukan, bukan teks permanen.
                  const Positioned(
                    left: 0,
                    bottom: 0,
                    child: TapGoMapAttributionButton(),
                  ),
                  // Tombol "lokasi saya": pusatkan peta + pin ke posisi pengguna.
                  // Dibangun dari Material+InkResponse (bukan IconButton) agar tidak
                  // mewarisi bingkai tombol dari tema aplikasi.
                  Positioned(
                    right: 10,
                    bottom: 10,
                    child: Semantics(
                      button: true,
                      label: 'Lokasi saya',
                      child: DecoratedBox(
                        key: const ValueKey('picker-recenter'),
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: Color(0x33000000),
                              blurRadius: 6,
                              offset: Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Material(
                          type: MaterialType.transparency,
                          child: InkResponse(
                            onTap: _locating ? null : _useCurrentLocation,
                            customBorder: const CircleBorder(),
                            child: SizedBox(
                              width: 44,
                              height: 44,
                              child: Center(
                                child: _locating
                                    ? const SizedBox(
                                        width: 18,
                                        height: 18,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2),
                                      )
                                    : const Icon(Icons.my_location_rounded,
                                        size: 22, color: Color(0xFF334155)),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  // Pin diam di tengah layar — peta yang bergerak di
                  // bawahnya, bukan pin yang berpindah (Manual Pin Dropper,
                  // pola Grab/Gojek). Koordinat presisi diambil dari
                  // center-point kamera peta, bukan dari posisi ikon ini.
                  IgnorePointer(
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 36),
                        child: Icon(
                          Icons.location_on_rounded,
                          size: 44,
                          color: _resolvingCenter
                              ? _pinColor.withValues(alpha: 0.55)
                              : _pinColor,
                        ),
                      ),
                    ),
                  ),
                  if (_resolvingCenter)
                    Positioned(
                      top: 12,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: colorScheme.surface,
                            borderRadius: BorderRadius.circular(999),
                            boxShadow: const [
                              BoxShadow(
                                  color: Color(0x22000000),
                                  blurRadius: 8,
                                  offset: Offset(0, 3)),
                            ],
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const SizedBox(
                                width: 14,
                                height: 14,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'Mencari alamat…',
                                style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                  color: colorScheme.onSurface,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
                if (_searching)
                  const Positioned(
                    top: 12,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(
                16, 10, 16, 12 + media.viewInsets.bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (selected != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text(
                      selected.address,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color: colorScheme.onSurfaceVariant, fontSize: 12.5),
                    ),
                  ),
                FilledButton(
                  onPressed: selected == null || _resolvingCenter
                      ? null
                      : () => Navigator.of(context)
                          .pop(selected.toRideLocation()),
                  child: const Text('Pakai lokasi ini'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _shortLabelForUi(String displayName) {
  final parts = displayName.split(',').map((p) => p.trim()).toList();
  return parts.take(2).join(', ');
}
