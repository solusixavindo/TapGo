part of '../main.dart';

/// Lembar pemilih lokasi ride: pencarian alamat (Nominatim) + pin pada peta
/// OpenStreetMap + tombol lokasi saat ini.
///
/// Port-agnostik: semua panggilan geocoding lewat [LocationSelectionPort],
/// sehingga mode demo memakai data sintetis tanpa menyentuh jaringan.
class RideLocationPickerSheet extends StatefulWidget {
  const RideLocationPickerSheet({
    super.key,
    required this.port,
    required this.title,
    this.initial,
  });

  final LocationSelectionPort port;
  final String title;
  final RideLocation? initial;

  static Future<RideLocation?> show(
    BuildContext context, {
    required LocationSelectionPort port,
    required String title,
    RideLocation? initial,
  }) {
    return showModalBottomSheet<RideLocation>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => RideLocationPickerSheet(
        port: port,
        title: title,
        initial: initial,
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

  List<RideAddressCandidate> _results = const [];
  RideAddressCandidate? _selected;
  bool _searching = false;
  bool _locating = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    if (initial != null) {
      _selected = RideAddressCandidate(
        label: initial.label,
        address: initial.address,
        lat: initial.lat,
        lng: initial.lng,
      );
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
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
    final results = await widget.port.searchAddress(query);
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
      _selected = RideAddressCandidate(
        label: location.label,
        address: location.address,
        lat: location.lat,
        lng: location.lng,
      );
      _notice = null;
    });
    final loc = location;
    if (loc != null) _moveMap(LatLng(loc.lat, loc.lng), 16);
  }

  void _pickCandidate(RideAddressCandidate candidate) {
    setState(() => _selected = candidate);
    _moveMap(LatLng(candidate.lat, candidate.lng), 16);
  }

  Future<void> _pickFromMap(LatLng point) async {
    setState(() {
      _searching = true;
      _notice = null;
    });
    final address = await widget.port.reverseAddress(point.latitude, point.longitude);
    if (!mounted) return;
    setState(() {
      _searching = false;
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
                if (_results.isNotEmpty && selected == null)
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
                else
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: FlutterMap(
                      mapController: _mapController,
                      options: MapOptions(
                        initialCenter: selected != null
                            ? LatLng(selected.lat, selected.lng)
                            : _defaultCenter,
                        initialZoom: 14,
                        onTap: (_, point) => unawaited(_pickFromMap(point)),
                      ),
                      children: [
                        TileLayer(
                          urlTemplate: _tileUrl,
                          userAgentPackageName: 'com.xavindo.tapgo',
                        ),
                        if (selected != null)
                          MarkerLayer(
                            markers: [
                              Marker(
                                point: LatLng(selected.lat, selected.lng),
                                width: 44,
                                height: 44,
                                child: const Icon(
                                  Icons.location_on_rounded,
                                  size: 44,
                                  color: Color(0xFF0A84FF),
                                ),
                              ),
                            ],
                          ),
                        Align(
                          alignment: Alignment.bottomRight,
                          child: Padding(
                            padding: const EdgeInsets.all(6),
                            child: Text(
                              tapGoOsmAttribution,
                              style: TextStyle(
                                fontSize: 10,
                                color: Colors.black.withValues(alpha: 0.55),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
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
                  onPressed: selected == null
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